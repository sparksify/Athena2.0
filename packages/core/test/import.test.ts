import type { EmailVerifier } from "@athena/contracts";
import { count, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  agentJob,
  candidate,
  candidateSourceLink,
  emailVerification,
  identifier,
  importBatch,
  org,
  sourceRecord,
} from "@athena/db/schema";
import { batchReport, importFile, pendingVerificationJobs } from "../src/ingest/import.js";
import { PARSERS } from "../src/ingest/parsers/index.js";
import { runVerificationJob } from "../src/ingest/verification.js";
import { testDb } from "./helpers.js";

const resumeRows = [
  { Name: "ROBERT SMITH", Email: "robert@gmail.com", Phone: "(214) 555-0101", City: "Plano", State: "Texas" },
  { Name: "Jane Roe", Email: "jane.roe@example.com", Phone: "214-555-0102", City: "Dallas", State: "TX" },
  { Name: "No Contact Info", Email: "", Phone: "", City: "Austin", State: "TX" },
  { Name: "Bad Email", Email: "not-an-email", Phone: "", City: "Waco", State: "TX" },
];

async function freshOrg() {
  const { db, client } = await testDb();
  const [o] = await db.insert(org).values({ name: "Test" }).returning();
  return { db, client, orgId: o!.id };
}

describe("importFile — Phase 1 proofs", () => {
  it("1+2: first import produces expected records; identical re-import produces zero duplicates", async () => {
    const { db, client, orgId } = await freshOrg();

    const first = await importFile(db, {
      orgId, sourceType: "resume", filename: "resumes.csv", rows: resumeRows,
    });
    expect(first.report.totalRows).toBe(4);
    expect(first.report.acceptedRows).toBe(4);
    expect(first.report.newCandidates).toBe(2);           // Robert + Jane
    expect(first.report.missingCriticalFields).toBe(2);   // no-contact + bad-email rows
    expect(first.report.normalizationErrors).toBe(1);     // "not-an-email" present but unusable
    expect(first.report.newIdentifiers).toBe(4);          // 2 emails + 2 phones
    expect(first.report.verificationJobsQueued).toBe(2);
    expect((await db.select({ n: count() }).from(sourceRecord))[0]!.n).toBe(4);

    const second = await importFile(db, {
      orgId, sourceType: "resume", filename: "resumes.csv", rows: resumeRows,
    });
    expect(second.report.duplicateRows).toBe(4);
    expect(second.report.newCandidates).toBe(0);
    expect(second.report.newIdentifiers).toBe(0);
    expect(second.report.verificationJobsQueued).toBe(0);
    expect((await db.select({ n: count() }).from(sourceRecord))[0]!.n).toBe(4);
    expect((await db.select({ n: count() }).from(candidate))[0]!.n).toBe(2);
    expect((await db.select({ n: count() }).from(identifier))[0]!.n).toBe(4);
    await client.close();
  });

  it("3: a modified file containing old + new rows adds only the new rows", async () => {
    const { db, client, orgId } = await freshOrg();
    await importFile(db, { orgId, sourceType: "resume", filename: "v1.csv", rows: resumeRows });

    const modified = [
      ...resumeRows,
      { Name: "Newman Newguy", Email: "newman@example.com", Phone: "469-555-0100", City: "Frisco", State: "TX" },
    ];
    const res = await importFile(db, { orgId, sourceType: "resume", filename: "v2.csv", rows: modified });
    expect(res.report.duplicateRows).toBe(4);
    expect(res.report.newCandidates).toBe(1);
    expect((await db.select({ n: count() }).from(sourceRecord))[0]!.n).toBe(5);
    expect((await db.select({ n: count() }).from(candidate))[0]!.n).toBe(3);
    await client.close();
  });

  it("4: the same person arriving via deterministic identifiers matches, never duplicates", async () => {
    const { db, client, orgId } = await freshOrg();
    await importFile(db, { orgId, sourceType: "resume", filename: "resumes.csv", rows: resumeRows });

    // Same email, different source type and casing → match by normalized email.
    // Same phone, no email → match by normalized phone. Plus an in-file pair
    // sharing one email → one candidate from two rows.
    const tradeshowRows = [
      { Attendee: "Bob Smith", "Email Address": "ROBERT@GMAIL.COM", Cell: "", City: "Plano", State: "TX", Show: "IFA" },
      { Attendee: "J. Roe", "Email Address": "", Cell: "12145550102", City: "Dallas", State: "TX", Show: "IFA" },
      { Attendee: "Twin One", "Email Address": "twin@example.com", Cell: "972-555-0199", City: "Allen", State: "TX", Show: "IFA" },
      { Attendee: "Twin Two", "Email Address": "twin@example.com", Cell: "", City: "Allen", State: "TX", Show: "MBE" },
    ];
    const res = await importFile(db, { orgId, sourceType: "tradeshow", filename: "show.csv", rows: tradeshowRows });
    expect(res.report.newCandidates).toBe(1);              // only Twin (once)
    expect(res.report.matchedExistingCandidates).toBe(3);  // Robert, Jane, Twin Two
    expect((await db.select({ n: count() }).from(candidate))[0]!.n).toBe(3);
    // Robert's candidate now links to two source records across two sources
    const robert = await db.select().from(identifier)
      .where(eq(identifier.valueNormalized, "robert@gmail.com"));
    const links = await db.select({ n: count() }).from(candidateSourceLink)
      .where(eq(candidateSourceLink.candidateId, robert[0]!.candidateId!));
    expect(links[0]!.n).toBe(2);
    await client.close();
  });

  it("5: a row that crashes its parser is stored as raw source truth and doesn't kill the batch", async () => {
    const { db, client, orgId } = await freshOrg();
    PARSERS["boom"] = (row) => {
      if (row["explode"]) throw new Error("parser blew up");
      return PARSERS["purchased"]!({ ...row });
    };
    try {
      const res = await importFile(db, {
        orgId, sourceType: "boom", filename: "mixed.csv",
        rows: [
          { first_name: "Ok", last_name: "Row", email: "ok@example.com", phone: "", city: "", state: "TX" },
          { explode: 1, first_name: "Bad", last_name: "Row" },
        ],
      });
      expect(res.report.acceptedRows).toBe(1);
      expect(res.report.rejectedRows).toBe(1);
      expect(res.report.parserErrors[0]!.error).toContain("parser blew up");
      expect(res.report.newCandidates).toBe(1);
      // both rows are preserved as raw source records
      expect((await db.select({ n: count() }).from(sourceRecord))[0]!.n).toBe(2);
      const [batch] = await db.select().from(importBatch);
      expect(batch!.status).toBe("completed");
    } finally {
      delete PARSERS["boom"];
    }
    await client.close();
  });

  it("6: verification failure + retry cannot duplicate verification work or spend", async () => {
    const { db, client, orgId } = await freshOrg();
    await importFile(db, {
      orgId, sourceType: "resume", filename: "one.csv",
      rows: [{ Name: "Solo Person", Email: "solo@example.com", Phone: "", City: "", State: "TX" }],
    });
    const [job] = await pendingVerificationJobs(db, orgId);
    const p = job!.payload as { identifierId: string; email: string };
    const args = { id: job!.id, orgId, identifierId: p.identifierId, email: p.email };

    const failing: EmailVerifier = {
      name: "mock", verify: async () => { throw new Error("provider down"); },
    };
    const working: EmailVerifier = {
      name: "mock", verify: async () => ({ result: "valid", raw: { ok: true } }),
    };

    expect(await runVerificationJob(db, failing, args)).toBe("failed");
    expect(await runVerificationJob(db, working, args)).toBe("done");   // retry succeeds
    expect(await runVerificationJob(db, working, args)).toBe("skipped"); // succeeded job never re-claims
    const rows = await db.select().from(emailVerification);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.result).toBe("valid");
    await client.close();
  });

  it("7: every candidate and identifier traces back to its batch and raw source row", async () => {
    const { db, client, orgId } = await freshOrg();
    const { batchId } = await importFile(db, {
      orgId, sourceType: "resume", filename: "resumes.csv", rows: resumeRows,
    });

    const [robert] = await db.select().from(candidate).where(eq(candidate.primaryEmail, "robert@gmail.com"));
    const [link] = await db.select().from(candidateSourceLink)
      .where(eq(candidateSourceLink.candidateId, robert!.id));
    expect(link!.method).toBe("exact");
    const [record] = await db.select().from(sourceRecord).where(eq(sourceRecord.id, link!.sourceRecordId));
    expect(record!.sourceBatchId).toBe(batchId);
    expect((record!.payload as Record<string, unknown>)["Email"]).toBe("robert@gmail.com");   // raw
    expect((record!.normalized as Record<string, unknown>)["email"]).toBe("robert@gmail.com"); // normalized
    expect((record!.normalized as Record<string, unknown>)["fullName"]).toBe("Robert Smith"); // transformation
    const [ident] = await db.select().from(identifier).where(eq(identifier.valueNormalized, "robert@gmail.com"));
    expect(ident!.firstSourceRecordId).toBe(record!.id);
    expect(ident!.candidateId).toBe(robert!.id);
    await client.close();
  });

  it("batchReport merges stored import facts with live verification results and cost", async () => {
    const { db, client, orgId } = await freshOrg();
    const { batchId } = await importFile(db, {
      orgId, sourceType: "resume", filename: "resumes.csv", rows: resumeRows,
    });
    const working: EmailVerifier = {
      name: "mock", verify: async (e) => ({ result: e.startsWith("robert") ? "valid" : "risky", raw: {} }),
    };
    for (const job of await pendingVerificationJobs(db, orgId)) {
      const p = job.payload as { identifierId: string; email: string };
      await runVerificationJob(db, working, { id: job.id, orgId, identifierId: p.identifierId, email: p.email });
    }
    const report = await batchReport(db, orgId, batchId);
    expect(report.status).toBe("completed");
    expect(report.newCandidates).toBe(2);
    expect(report.verification).toEqual({ valid: 1, invalid: 0, risky: 1, unknown: 0, unverified: 0 });
    expect(report.verificationCostUsd).toBeGreaterThan(0);
    // queue fully drained
    expect((await db.select({ n: count() }).from(agentJob).where(eq(agentJob.status, "queued")))[0]!.n).toBe(0);
    await client.close();
  });
});
