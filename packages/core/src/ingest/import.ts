import {
  agentJob,
  candidate,
  candidateSourceLink,
  emailVerification,
  event,
  identifier,
  importBatch,
  sourceRecord,
} from "@athena/db/schema";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { EmitTx } from "../events/emit.js";
import { contentHash } from "./normalize.js";
import { PARSERS } from "./parsers/index.js";
import type { ParsedRecord } from "./types.js";

type Db = EmitTx & {
  transaction: <T>(fn: (tx: EmitTx) => Promise<T>) => Promise<T>;
};

export interface ImportFileArgs {
  orgId: string;
  sourceType: string;
  filename: string;
  rows: Record<string, unknown>[];
}

/** Stored on import_batch.report — import-time facts. Verification facts are
 *  async and merged in by batchReport(). */
export interface ImportReport {
  totalRows: number;
  acceptedRows: number;
  rejectedRows: number;
  duplicateRows: number;
  newCandidates: number;
  matchedExistingCandidates: number;
  deterministicConflicts: number;
  newIdentifiers: number;
  verificationJobsQueued: number;
  missingCriticalFields: number;
  normalizationErrors: number;
  parserErrors: { row: number; error: string }[];
  processingMs: number;
}

const CHUNK = 500;
const MAX_STORED_PARSER_ERRORS = 50;

function rawHasEmailish(raw: Record<string, unknown>): boolean {
  return Object.entries(raw).some(
    ([k, v]) => /email/i.test(k) && typeof v === "string" && v.trim() !== "",
  );
}

/**
 * Idempotent, deterministic-only import (Phase 1 guardrail):
 * - source_record dedupes on (org_id, content_hash); raw payload preserved verbatim
 * - identity is exact normalized email/phone only — no fuzzy, no AI
 * - every new candidate/identifier traces to its batch and raw source record
 * - one transaction per chunk: records + candidates + identifiers + links +
 *   verification outbox jobs + events commit together
 */
export async function importFile(
  db: Db,
  args: ImportFileArgs,
): Promise<{ batchId: string; report: ImportReport }> {
  const started = Date.now();
  const parser = PARSERS[args.sourceType];
  if (!parser) throw new Error(`no parser for source type '${args.sourceType}'`);

  const [batch] = await db
    .insert(importBatch)
    .values({ orgId: args.orgId, sourceType: args.sourceType, filename: args.filename })
    .returning({ id: importBatch.id });
  const batchId = batch!.id;

  const report: ImportReport = {
    totalRows: args.rows.length,
    acceptedRows: 0,
    rejectedRows: 0,
    duplicateRows: 0,
    newCandidates: 0,
    matchedExistingCandidates: 0,
    deterministicConflicts: 0,
    newIdentifiers: 0,
    verificationJobsQueued: 0,
    missingCriticalFields: 0,
    normalizationErrors: 0,
    parserErrors: [],
    processingMs: 0,
  };

  try {
    for (let offset = 0; offset < args.rows.length; offset += CHUNK) {
      const slice = args.rows.slice(offset, offset + CHUNK);
      const rows = slice.map((raw, i) => {
        try {
          const parsed = parser(raw);
          if (!parsed.email && rawHasEmailish(raw)) report.normalizationErrors += 1;
          return { raw, parsed: parsed as ParsedRecord | null, hash: contentHash(args.sourceType, raw), error: null as string | null };
        } catch (err) {
          const error = String(err);
          report.rejectedRows += 1;
          if (report.parserErrors.length < MAX_STORED_PARSER_ERRORS) {
            report.parserErrors.push({ row: offset + i, error });
          }
          return { raw, parsed: null, hash: contentHash(args.sourceType, raw), error };
        }
      });
      report.acceptedRows += rows.filter((r) => r.parsed).length;

      await db.transaction(async (tx) => {
        // 1. Source records — raw truth for every row, including rejects.
        const inserted = await tx
          .insert(sourceRecord)
          .values(
            rows.map((r) => ({
              orgId: args.orgId,
              sourceType: args.sourceType,
              sourceBatchId: batchId,
              contentHash: r.hash,
              payload: r.raw,
              normalized: r.parsed ? { ...r.parsed, raw: undefined } : null,
            })),
          )
          .onConflictDoNothing({ target: [sourceRecord.orgId, sourceRecord.contentHash] })
          .returning({ id: sourceRecord.id, contentHash: sourceRecord.contentHash });
        const newByHash = new Map(inserted.map((r) => [r.contentHash, r.id]));
        report.duplicateRows += rows.length - inserted.length;

        // 2. Bulk-load existing identifiers for this chunk's emails/phones.
        const emails = [...new Set(rows.flatMap((r) => (r.parsed?.email ? [r.parsed.email] : [])))];
        const phones = [...new Set(rows.flatMap((r) => (r.parsed?.phone ? [r.parsed.phone] : [])))];
        const lookup = async (type: "email" | "phone", values: string[]) =>
          values.length === 0
            ? []
            : tx
                .select({
                  id: identifier.id,
                  type: identifier.type,
                  valueNormalized: identifier.valueNormalized,
                  candidateId: identifier.candidateId,
                })
                .from(identifier)
                .where(
                  and(
                    eq(identifier.orgId, args.orgId),
                    eq(identifier.type, type),
                    inArray(identifier.valueNormalized, values),
                  ),
                );
        const existing = [...(await lookup("email", emails)), ...(await lookup("phone", phones))];
        const known = new Map(existing.map((r) => [`${r.type}:${r.valueNormalized}`, { id: r.id, candidateId: r.candidateId }]));

        const events: (typeof event.$inferInsert)[] = [];
        const verifyJobs: { identifierId: string; email: string }[] = [];

        // 3. Deterministic identity, row by row (in-chunk matches included).
        for (const r of rows) {
          const recordId = newByHash.get(r.hash);
          if (!recordId) continue; // duplicate row — already imported earlier
          if (!r.parsed) continue; // parser error — raw stored, nothing else
          const p = r.parsed;
          if (!p.email && !p.phone) {
            report.missingCriticalFields += 1;
            continue;
          }

          const emailKey = p.email ? `email:${p.email}` : null;
          const phoneKey = p.phone ? `phone:${p.phone}` : null;
          const emailHit = emailKey ? known.get(emailKey) : undefined;
          const phoneHit = phoneKey ? known.get(phoneKey) : undefined;

          // Email outranks phone; a disagreement is a Phase 2 signal, never a merge.
          let candidateId = emailHit?.candidateId ?? phoneHit?.candidateId ?? null;
          if (
            emailHit?.candidateId && phoneHit?.candidateId &&
            emailHit.candidateId !== phoneHit.candidateId
          ) {
            report.deterministicConflicts += 1;
          }

          if (candidateId) {
            report.matchedExistingCandidates += 1;
            events.push({
              orgId: args.orgId,
              type: "identity.matched",
              entityType: "candidate",
              entityId: candidateId,
              payload: { sourceRecordId: recordId, method: "exact" },
            });
          } else {
            const [c] = await tx
              .insert(candidate)
              .values({
                orgId: args.orgId,
                fullName: p.fullName,
                primaryEmail: p.email,
                primaryPhone: p.phone,
                city: p.city,
                state: p.state,
              })
              .returning({ id: candidate.id });
            candidateId = c!.id;
            report.newCandidates += 1;
            events.push({
              orgId: args.orgId,
              type: "candidate.imported",
              entityType: "candidate",
              entityId: candidateId,
              payload: { sourceRecordId: recordId, sourceType: args.sourceType },
            });
          }

          for (const [key, type, value] of [
            [emailKey, "email", p.email],
            [phoneKey, "phone", p.phone],
          ] as const) {
            if (!key || !value) continue;
            const hit = known.get(key);
            if (!hit) {
              const [row] = await tx
                .insert(identifier)
                .values({
                  orgId: args.orgId,
                  candidateId,
                  type,
                  valueNormalized: value,
                  valueRaw: value,
                  firstSourceRecordId: recordId,
                })
                .returning({ id: identifier.id });
              known.set(key, { id: row!.id, candidateId });
              report.newIdentifiers += 1;
              if (type === "email") verifyJobs.push({ identifierId: row!.id, email: value });
            } else if (!hit.candidateId) {
              // identifier existed unlinked — link it; never relink a linked one
              await tx
                .update(identifier)
                .set({ candidateId })
                .where(and(eq(identifier.id, hit.id), isNull(identifier.candidateId)));
              hit.candidateId = candidateId;
            }
          }

          await tx
            .insert(candidateSourceLink)
            .values({
              orgId: args.orgId,
              candidateId,
              sourceRecordId: recordId,
              confidence: "1.0",
              method: "exact",
            })
            .onConflictDoNothing();
        }

        // 4. Verification outbox + events, same transaction.
        if (verifyJobs.length > 0) {
          await tx.insert(agentJob).values(
            verifyJobs.map((v) => ({
              orgId: args.orgId,
              type: "verify.email",
              payload: v,
            })),
          );
          report.verificationJobsQueued += verifyJobs.length;
        }
        if (events.length > 0) await tx.insert(event).values(events);
      });
    }

    report.processingMs = Date.now() - started;
    await db.transaction(async (tx) => {
      await tx
        .update(importBatch)
        .set({ status: "completed", report, finishedAt: new Date() })
        .where(eq(importBatch.id, batchId));
      await tx.insert(event).values({
        orgId: args.orgId,
        type: "import.batch_completed",
        entityType: "import_batch",
        entityId: batchId,
        payload: report as unknown as Record<string, unknown>,
      });
    });
    return { batchId, report };
  } catch (err) {
    report.processingMs = Date.now() - started;
    await db
      .update(importBatch)
      .set({
        status: "failed",
        report: { ...report, fatalError: String(err) },
        finishedAt: new Date(),
      })
      .where(eq(importBatch.id, batchId));
    throw err;
  }
}

/**
 * The full batch report for the UI/CLI: stored import-time facts merged with
 * live verification results and verification spend for the batch's identifiers.
 */
export async function batchReport(db: Db, orgId: string, batchId: string) {
  const [batch] = await db.select().from(importBatch).where(eq(importBatch.id, batchId));
  if (!batch) throw new Error(`no import_batch ${batchId}`);

  const verification = await db
    .select({
      result: emailVerification.result,
      count: sql<number>`count(distinct ${emailVerification.identifierId})::int`,
    })
    .from(emailVerification)
    .innerJoin(identifier, eq(identifier.id, emailVerification.identifierId))
    .innerJoin(sourceRecord, eq(sourceRecord.id, identifier.firstSourceRecordId))
    .where(and(eq(emailVerification.orgId, orgId), eq(sourceRecord.sourceBatchId, batchId)))
    .groupBy(emailVerification.result);

  const [unverified] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(identifier)
    .innerJoin(sourceRecord, eq(sourceRecord.id, identifier.firstSourceRecordId))
    .leftJoin(emailVerification, eq(emailVerification.identifierId, identifier.id))
    .where(
      and(
        eq(identifier.orgId, orgId),
        eq(identifier.type, "email"),
        eq(sourceRecord.sourceBatchId, batchId),
        isNull(emailVerification.id),
      ),
    );

  const [cost] = await db
    .select({ usd: sql<string>`coalesce(sum(cr.amount_usd), 0)::text` })
    .from(sql`cost_record cr
      join agent_job aj on aj.id = cr.agent_job_id
      join identifier i on i.id = (aj.payload->>'identifierId')::uuid
      join source_record sr on sr.id = i.first_source_record_id`)
    .where(sql`cr.org_id = ${orgId} and cr.category = 'verification' and sr.source_batch_id = ${batchId}`);

  const byResult = Object.fromEntries(verification.map((v) => [v.result, v.count]));
  return {
    batchId,
    filename: batch.filename,
    sourceType: batch.sourceType,
    status: batch.status,
    startedAt: batch.startedAt,
    finishedAt: batch.finishedAt,
    ...(batch.report as ImportReport | null),
    verification: {
      valid: byResult["valid"] ?? 0,
      invalid: byResult["invalid"] ?? 0,
      risky: byResult["risky"] ?? 0,
      unknown: byResult["unknown"] ?? 0,
      unverified: unverified?.n ?? 0,
    },
    verificationCostUsd: Number(cost?.usd ?? 0),
  };
}

/** Org-wide counts by source and validity (the CLAUDE.md Phase 1 report). */
export async function importReport(db: Db, orgId: string) {
  const bySource = await db
    .select({ sourceType: sourceRecord.sourceType, records: sql<number>`count(*)::int` })
    .from(sourceRecord)
    .where(eq(sourceRecord.orgId, orgId))
    .groupBy(sourceRecord.sourceType);
  const byValidity = await db
    .select({
      result: emailVerification.result,
      count: sql<number>`count(distinct ${emailVerification.identifierId})::int`,
    })
    .from(emailVerification)
    .where(eq(emailVerification.orgId, orgId))
    .groupBy(emailVerification.result);
  return { bySource, byValidity };
}

/** Queued verification jobs (used by the worker task and the CLI). */
export async function pendingVerificationJobs(db: Db, orgId: string, limit = 1000) {
  return db
    .select({ id: agentJob.id, payload: agentJob.payload })
    .from(agentJob)
    .where(
      and(eq(agentJob.orgId, orgId), eq(agentJob.type, "verify.email"), eq(agentJob.status, "queued")),
    )
    .limit(limit);
}
