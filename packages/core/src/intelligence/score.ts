import {
  candidate,
  candidateAttribute,
  candidateSourceLink,
  emailVerification,
  event,
  financialProfile,
  identifier,
  interaction,
  questionnaire,
  scoreSnapshot,
  sourceRecord,
  suppression,
} from "@athena/db/schema";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { EmitTx } from "../events/emit.js";
import { FACTORS } from "./factors/index.js";
import type { FactorResult, ScoringContext } from "./types.js";

type Db = EmitTx & {
  transaction: <T>(fn: (tx: EmitTx) => Promise<T>) => Promise<T>;
};

/** Bump when factor logic or weights change; forces new snapshots everywhere. */
export const SCORE_VERSION = 1;

/** Pure: run every factor, sum, clamp to 0–100. */
export function computeScore(ctx: ScoringContext): { score: number; factors: FactorResult[] } {
  const factors = FACTORS.map((f) => f(ctx));
  const raw = factors.reduce((sum, f) => sum + f.points, 0);
  return { score: Math.max(0, Math.min(100, raw)), factors };
}

const VERIFICATION_RANK = { valid: 3, risky: 2, unknown: 1, invalid: 0 } as const;

/** Assemble scoring contexts for a set of candidates in a handful of bulk queries. */
export async function buildContexts(
  db: Db,
  orgId: string,
  candidateIds: string[],
  now = new Date(),
): Promise<Map<string, ScoringContext>> {
  if (candidateIds.length === 0) return new Map();

  const [cands, idents, interactions, questionnaires, financials, attributes, sources] =
    await Promise.all([
      db.select().from(candidate).where(inArray(candidate.id, candidateIds)),
      db
        .select({
          candidateId: identifier.candidateId,
          type: identifier.type,
          value: identifier.valueNormalized,
          verification: emailVerification.result,
        })
        .from(identifier)
        .leftJoin(emailVerification, eq(emailVerification.identifierId, identifier.id))
        .where(inArray(identifier.candidateId, candidateIds)),
      db.select().from(interaction).where(inArray(interaction.candidateId, candidateIds)),
      db.select().from(questionnaire).where(inArray(questionnaire.candidateId, candidateIds)),
      db.select().from(financialProfile).where(inArray(financialProfile.candidateId, candidateIds)),
      db
        .select()
        .from(candidateAttribute)
        .where(
          and(
            inArray(candidateAttribute.candidateId, candidateIds),
            isNull(candidateAttribute.supersededById),
          ),
        ),
      db
        .select({
          candidateId: candidateSourceLink.candidateId,
          sourceType: sourceRecord.sourceType,
        })
        .from(candidateSourceLink)
        .innerJoin(sourceRecord, eq(sourceRecord.id, candidateSourceLink.sourceRecordId))
        .where(inArray(candidateSourceLink.candidateId, candidateIds)),
    ]);

  const suppressed = await db
    .select({ candidateId: identifier.candidateId })
    .from(suppression)
    .innerJoin(
      identifier,
      and(
        eq(identifier.valueNormalized, suppression.identifier),
        sql`(${suppression.channel} = 'email' and ${identifier.type} = 'email')
          or (${suppression.channel} = 'sms' and ${identifier.type} = 'phone')`,
      ),
    )
    .where(and(eq(suppression.orgId, orgId), inArray(identifier.candidateId, candidateIds)));
  const suppressedSet = new Set(suppressed.map((s) => s.candidateId));

  const contexts = new Map<string, ScoringContext>();
  for (const c of cands) {
    const myIdents = idents.filter((i) => i.candidateId === c.id);
    const myInteractions = interactions
      .filter((i) => i.candidateId === c.id)
      .map((i) => ({
        type: i.type,
        direction: i.direction,
        occurredAt: i.occurredAt,
        payload: (i.payload ?? {}) as Record<string, unknown>,
      }));
    const emails = myIdents.filter((i) => i.type === "email");
    const bestVerification = emails
      .map((e) => e.verification)
      .filter((v): v is NonNullable<typeof v> => v != null)
      .sort((a, b) => VERIFICATION_RANK[b] - VERIFICATION_RANK[a])[0];
    const myQs = questionnaires.filter((q) => q.candidateId === c.id);
    const fin = financials.find((f) => f.candidateId === c.id);
    const latest = myInteractions.reduce<Date | null>(
      (acc, i) => (acc === null || i.occurredAt > acc ? i.occurredAt : acc),
      null,
    );

    contexts.set(c.id, {
      candidate: { id: c.id, fullName: c.fullName, city: c.city, state: c.state },
      latestActivityAt: latest,
      sourceTypes: [...new Set(sources.filter((s) => s.candidateId === c.id).map((s) => s.sourceType))],
      interactions: myInteractions,
      hasCqComplete: myQs.some((q) => q.kind === "cq_complete"),
      hasCqPartial: myQs.some((q) => q.kind === "cq_partial"),
      liquidityUsd: fin?.liquidityUsd != null ? Number(fin.liquidityUsd) : null,
      attributes: Object.fromEntries(
        attributes.filter((a) => a.candidateId === c.id).map((a) => [a.key, a.value]),
      ),
      emailVerification: bestVerification ?? null,
      hasEmail: emails.length > 0,
      hasPhone: myIdents.some((i) => i.type === "phone"),
      suppressed: suppressedSet.has(c.id),
      now,
    });
  }
  return contexts;
}

export interface ScoreRunResult {
  scored: number;
  unchanged: number;
}

/**
 * Score candidates (all unmerged ones by default). Idempotent: a candidate
 * whose latest snapshot has the same version, score, and factor table gets
 * no new snapshot. Changes write snapshot + candidate.current_score + a
 * candidate.scored event in one transaction.
 */
export async function scoreCandidates(
  db: Db,
  orgId: string,
  opts: { candidateIds?: string[]; now?: Date } = {},
): Promise<ScoreRunResult> {
  const ids =
    opts.candidateIds ??
    (
      await db
        .select({ id: candidate.id })
        .from(candidate)
        .where(and(eq(candidate.orgId, orgId), isNull(candidate.mergedIntoId)))
    ).map((r) => r.id);

  const result: ScoreRunResult = { scored: 0, unchanged: 0 };
  const CHUNK = 500;

  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const contexts = await buildContexts(db, orgId, chunk, opts.now);

    const latest = await db
      .select({
        candidateId: scoreSnapshot.candidateId,
        score: scoreSnapshot.score,
        version: scoreSnapshot.version,
        factors: scoreSnapshot.factors,
        createdAt: scoreSnapshot.createdAt,
      })
      .from(scoreSnapshot)
      .where(inArray(scoreSnapshot.candidateId, chunk))
      .orderBy(desc(scoreSnapshot.createdAt));
    const latestByCandidate = new Map<string, (typeof latest)[number]>();
    for (const row of latest) {
      if (!latestByCandidate.has(row.candidateId)) latestByCandidate.set(row.candidateId, row);
    }

    await db.transaction(async (tx) => {
      for (const [candidateId, ctx] of contexts) {
        const { score, factors } = computeScore(ctx);
        const prev = latestByCandidate.get(candidateId);
        if (
          prev &&
          prev.version === SCORE_VERSION &&
          prev.score === score &&
          JSON.stringify(prev.factors) === JSON.stringify(factors)
        ) {
          result.unchanged += 1;
          continue;
        }
        await tx.insert(scoreSnapshot).values({
          orgId,
          candidateId,
          score,
          version: SCORE_VERSION,
          factors,
        });
        await tx.update(candidate).set({ currentScore: score }).where(eq(candidate.id, candidateId));
        await tx.insert(event).values({
          orgId,
          type: "candidate.scored",
          entityType: "candidate",
          entityId: candidateId,
          payload: { score, version: SCORE_VERSION, previous: prev?.score ?? null },
        });
        result.scored += 1;
      }
    });
  }
  return result;
}

/** "Why is Robert a 91" — the latest snapshot's factor table. */
export async function explainScore(db: Db, orgId: string, candidateId: string) {
  const [snapshot] = await db
    .select()
    .from(scoreSnapshot)
    .where(and(eq(scoreSnapshot.orgId, orgId), eq(scoreSnapshot.candidateId, candidateId)))
    .orderBy(desc(scoreSnapshot.createdAt))
    .limit(1);
  return snapshot ?? null;
}
