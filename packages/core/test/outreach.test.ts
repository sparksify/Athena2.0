import { and, count, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailProvider, LlmProvider } from "@athena/contracts";
import {
  angle, appUser, campaign, campaignMembership, candidate, candidateAttribute, costRecord,
  emailVerification, event, identifier, interaction, mailbox, message, org, outreachDraft,
  sourceRecord, suppression,
} from "@athena/db/schema";
import { approveDraft, rejectDraft } from "../src/outreach/approval";
import { draftOutreach } from "../src/outreach/drafting";
import { runSendTick } from "../src/outreach/scheduler";
import { sendApprovedDraft } from "../src/outreach/send";
import { addSuppression } from "../src/outreach/suppress";
import { handleEmailWebhook } from "../src/outreach/webhooks";
import { LlmGateway } from "../src/llm/gateway";
import { testDb } from "./helpers";

const ALWAYS_OPEN = { days: [0, 1, 2, 3, 4, 5, 6], startHour: 0, endHour: 24, timezone: "UTC" };

type Db = Awaited<ReturnType<typeof testDb>>["db"];

async function seed(db: Db, opts: { verification?: "valid" | "risky" | "invalid" | "none"; dailyCap?: number } = {}) {
  const [o] = await db.insert(org).values({ name: "Test Org" }).returning({ id: org.id });
  const orgId = o!.id;
  const [u] = await db
    .insert(appUser)
    .values({ id: crypto.randomUUID(), orgId, email: "op@test.io", role: "fcc_admin" })
    .returning({ id: appUser.id });
  const [cand] = await db
    .insert(candidate)
    .values({ orgId, fullName: "Pat Example", primaryEmail: "pat@example.com", city: "Plano", state: "TX" })
    .returning({ id: candidate.id });
  const [ident] = await db
    .insert(identifier)
    .values({ orgId, candidateId: cand!.id, type: "email", valueNormalized: "pat@example.com", valueRaw: "pat@example.com" })
    .returning({ id: identifier.id });
  if (opts.verification !== "none") {
    await db.insert(emailVerification).values({
      orgId,
      identifierId: ident!.id,
      provider: "test",
      result: opts.verification ?? "valid",
    });
  }
  const [mb] = await db
    .insert(mailbox)
    .values({
      orgId, provider: "smartlead", address: "amy@pool.test", domain: "pool.test",
      dailyCap: opts.dailyCap ?? 10, status: "active", externalRef: "sl-amy",
    })
    .returning({ id: mailbox.id });
  const [camp] = await db
    .insert(campaign)
    .values({ orgId, name: "Pilot", status: "active", sendWindow: ALWAYS_OPEN })
    .returning({ id: campaign.id });
  const [ang] = await db
    .insert(angle)
    .values({ orgId, name: "checkin", description: "friendly check-in" })
    .returning({ id: angle.id });
  await db.insert(campaignMembership).values({ orgId, campaignId: camp!.id, candidateId: cand!.id });
  return { orgId, userId: u!.id, candidateId: cand!.id, identifierId: ident!.id, mailboxId: mb!.id, campaignId: camp!.id, angleId: ang!.id };
}

async function makeApprovedDraft(db: Db, s: Awaited<ReturnType<typeof seed>>) {
  const [d] = await db
    .insert(outreachDraft)
    .values({
      orgId: s.orgId, campaignId: s.campaignId, candidateId: s.candidateId, angleId: s.angleId,
      mailboxId: s.mailboxId, subject: "Quick question", bodyText: "Hi Pat — still curious about ownership?",
      status: "approved", approvedBy: s.userId,
    })
    .returning({ id: outreachDraft.id });
  return d!.id;
}

function mockProvider(): EmailProvider & { sendEmail: ReturnType<typeof vi.fn> } {
  let n = 0;
  return {
    name: "mock-email",
    sendEmail: vi.fn(async () => ({ providerMessageId: `pm-${++n}` })),
  };
}

let db: Db;
beforeEach(async () => {
  db = (await testDb()).db;
});

describe("send path", () => {
  it("sends an approved draft and records message, interaction, cost, event", async () => {
    const s = await seed(db);
    const draftId = await makeApprovedDraft(db, s);
    const provider = mockProvider();

    const res = await sendApprovedDraft(db, provider, draftId);
    expect(res.sent).toBe(true);
    expect(provider.sendEmail).toHaveBeenCalledOnce();
    expect(provider.sendEmail.mock.calls[0]![0]).toMatchObject({ to: "pat@example.com", mailboxRef: "sl-amy" });

    const [d] = await db.select().from(outreachDraft).where(eq(outreachDraft.id, draftId));
    expect(d!.status).toBe("sent");
    expect(d!.sentMessageId).toBeTruthy();
    const msgs = await db.select().from(message).where(eq(message.candidateId, s.candidateId));
    expect(msgs).toHaveLength(1);
    const inter = await db.select().from(interaction).where(eq(interaction.candidateId, s.candidateId));
    expect(inter.map((i) => i.type)).toContain("email_sent");
    const costs = await db.select().from(costRecord).where(eq(costRecord.category, "message"));
    expect(costs).toHaveLength(1);
    const evts = await db.select().from(event).where(eq(event.type, "outreach.sent"));
    expect(evts).toHaveLength(1);
    const [mem] = await db.select().from(campaignMembership).where(eq(campaignMembership.candidateId, s.candidateId));
    expect(mem!.status).toBe("sent");
  });

  it("REFUSES and logs a duplicate send attempt", async () => {
    const s = await seed(db);
    const draftId = await makeApprovedDraft(db, s);
    const provider = mockProvider();

    const first = await sendApprovedDraft(db, provider, draftId);
    expect(first.sent).toBe(true);
    const second = await sendApprovedDraft(db, provider, draftId);
    expect(second).toMatchObject({ sent: false, outcome: "refused", reason: "status_sent" });
    expect(provider.sendEmail).toHaveBeenCalledOnce(); // no second provider call

    const refusals = await db.select().from(event).where(eq(event.type, "outreach.send_refused"));
    expect(refusals).toHaveLength(1);
    expect((refusals[0]!.payload as { reason: string }).reason).toBe("status_sent");
  });

  it("suppression gate blocks the send before the provider is called", async () => {
    const s = await seed(db);
    await addSuppression(db, { orgId: s.orgId, channel: "email", identifier: "pat@example.com", reason: "unsubscribed" });
    const draftId = await makeApprovedDraft(db, s);
    const provider = mockProvider();

    const res = await sendApprovedDraft(db, provider, draftId);
    expect(res).toMatchObject({ sent: false, outcome: "blocked", reason: "suppressed" });
    expect(provider.sendEmail).not.toHaveBeenCalled();
    const [d] = await db.select().from(outreachDraft).where(eq(outreachDraft.id, draftId));
    expect(d!.status).toBe("blocked");
    expect(d!.blockedReason).toBe("suppressed");
  });

  it("verification gate: never sends to non-valid (risky) or unverified", async () => {
    const risky = await seed(db, { verification: "risky" });
    const provider = mockProvider();
    const r1 = await sendApprovedDraft(db, provider, await makeApprovedDraft(db, risky));
    expect(r1).toMatchObject({ sent: false, outcome: "blocked", reason: "email_risky" });

    const dbTwo = (await testDb()).db;
    const unverified = await seed(dbTwo, { verification: "none" });
    const r2 = await sendApprovedDraft(dbTwo, provider, await makeApprovedDraft(dbTwo, unverified));
    expect(r2).toMatchObject({ sent: false, outcome: "blocked", reason: "email_unverified" });
    expect(provider.sendEmail).not.toHaveBeenCalled();
  });

  it("mailbox daily cap blocks the send that would exceed it", async () => {
    const s = await seed(db, { dailyCap: 1 });
    const provider = mockProvider();
    const first = await sendApprovedDraft(db, provider, await makeApprovedDraft(db, s));
    expect(first.sent).toBe(true);
    const second = await sendApprovedDraft(db, provider, await makeApprovedDraft(db, s));
    expect(second).toMatchObject({ sent: false, outcome: "blocked", reason: "mailbox_cap_reached" });
  });

  it("send window blocks outside configured hours", async () => {
    const s = await seed(db);
    await db
      .update(campaign)
      .set({ sendWindow: { days: [1, 2, 3, 4, 5], startHour: 9, endHour: 10, timezone: "UTC" } })
      .where(eq(campaign.id, s.campaignId));
    const provider = mockProvider();
    // Sunday 12:00 UTC — wrong day AND wrong hour.
    const res = await sendApprovedDraft(db, provider, await makeApprovedDraft(db, s), {
      now: new Date("2026-09-06T12:00:00Z"),
    });
    expect(res).toMatchObject({ sent: false, outcome: "blocked", reason: "outside_send_window" });
  });

  it("provider failure returns the draft to approved for retry", async () => {
    const s = await seed(db);
    const draftId = await makeApprovedDraft(db, s);
    const provider: EmailProvider = {
      name: "mock-email",
      sendEmail: async () => {
        throw new Error("smtp down");
      },
    };
    const res = await sendApprovedDraft(db, provider, draftId);
    expect(res).toMatchObject({ sent: false, outcome: "failed" });
    const [d] = await db.select().from(outreachDraft).where(eq(outreachDraft.id, draftId));
    expect(d!.status).toBe("approved");
    const evts = await db.select().from(event).where(eq(event.type, "outreach.send_failed"));
    expect(evts).toHaveLength(1);
  });
});

describe("webhooks", () => {
  it("opt-out lands in suppression and blocks the next send, idempotently", async () => {
    const s = await seed(db);
    const evt = {
      kind: "unsubscribe" as const,
      provider: "smartlead",
      providerMessageId: "sl-evt-1",
      email: "pat@example.com",
      occurredAt: new Date(),
    };
    const r1 = await handleEmailWebhook(db, evt);
    expect(r1).toMatchObject({ handled: true, deduped: false, suppressed: true });
    const r2 = await handleEmailWebhook(db, evt);
    expect(r2).toMatchObject({ handled: true, deduped: true });

    const sups = await db.select().from(suppression).where(eq(suppression.identifier, "pat@example.com"));
    expect(sups).toHaveLength(1);
    const opts = await db.select().from(interaction).where(eq(interaction.type, "opt_out"));
    expect(opts).toHaveLength(1);

    // Subsequent send attempt is blocked by the gate.
    const provider = mockProvider();
    const res = await sendApprovedDraft(db, provider, await makeApprovedDraft(db, s));
    expect(res).toMatchObject({ sent: false, outcome: "blocked", reason: "suppressed" });
    expect(provider.sendEmail).not.toHaveBeenCalled();
  });

  it("bounce suppresses; reply is idempotent on provider_message_id and queues classification", async () => {
    const s = await seed(db);
    await handleEmailWebhook(db, {
      kind: "bounce", provider: "smartlead", providerMessageId: "sl-b1",
      email: "pat@example.com", occurredAt: new Date(),
    });
    expect(
      (await db.select().from(suppression).where(eq(suppression.identifier, "pat@example.com"))).length,
    ).toBe(1);

    const reply = {
      kind: "reply" as const, provider: "smartlead", providerMessageId: "sl-r1",
      email: "pat@example.com", subject: "re: hi", bodyText: "tell me more",
      occurredAt: new Date(),
    };
    const r1 = await handleEmailWebhook(db, reply);
    const r2 = await handleEmailWebhook(db, reply);
    expect(r1.deduped).toBe(false);
    expect(r2.deduped).toBe(true);
    const [n] = await db
      .select({ n: count() })
      .from(message)
      .where(and(eq(message.provider, "smartlead"), eq(message.providerMessageId, "sl-r1")));
    expect(n!.n).toBe(1);
    const replyEvents = await db.select().from(event).where(eq(event.type, "outreach.reply_received"));
    expect(replyEvents).toHaveLength(1);
    void s;
  });
});

describe("drafting", () => {
  function mockLlm(json: unknown): LlmProvider {
    return {
      name: "mock-llm",
      complete: async () => ({
        text: JSON.stringify(json), json, model: "mock", inputTokens: 10, outputTokens: 20, costUsd: 0.001,
      }),
    };
  }

  it("stores only provenance-validated citations and lands in the approval queue", async () => {
    const s = await seed(db);
    const [src] = await db
      .insert(sourceRecord)
      .values({ orgId: s.orgId, sourceType: "resume", payload: {}, contentHash: "h1" })
      .returning({ id: sourceRecord.id });
    const [attr] = await db
      .insert(candidateAttribute)
      .values({
        orgId: s.orgId, candidateId: s.candidateId, key: "franchise_interest",
        value: "home services", sourceRecordId: src!.id,
      })
      .returning({ id: candidateAttribute.id });

    const gateway = new LlmGateway(
      mockLlm({ subject: "Hey Pat", bodyText: "Sixty words of warm check-in.", citedFactIds: [attr!.id, crypto.randomUUID()] }),
      db,
    );
    const res = await draftOutreach(db, gateway, {
      orgId: s.orgId, campaignId: s.campaignId, candidateId: s.candidateId, angleId: s.angleId,
    });
    expect(res.drafted).toBe(true);
    const [d] = await db.select().from(outreachDraft).where(eq(outreachDraft.candidateId, s.candidateId));
    expect(d!.status).toBe("draft"); // 100% human approval — never auto-approved
    expect(d!.citedAttributeIds).toEqual([attr!.id]); // bogus citation stripped
    const [mem] = await db.select().from(campaignMembership).where(eq(campaignMembership.candidateId, s.candidateId));
    expect(mem!.status).toBe("drafted");
    const llmCosts = await db.select().from(costRecord).where(eq(costRecord.category, "llm"));
    expect(llmCosts).toHaveLength(1);
  });

  it("skips suppressed candidates without spending tokens", async () => {
    const s = await seed(db);
    await addSuppression(db, { orgId: s.orgId, channel: "email", identifier: "pat@example.com", reason: "opt-out" });
    const spy = vi.fn();
    const gateway = new LlmGateway({ name: "mock-llm", complete: spy } as unknown as LlmProvider, db);
    const res = await draftOutreach(db, gateway, {
      orgId: s.orgId, campaignId: s.campaignId, candidateId: s.candidateId, angleId: s.angleId,
    });
    expect(res).toMatchObject({ drafted: false, reason: "suppressed" });
    expect(spy).not.toHaveBeenCalled();
    const [mem] = await db.select().from(campaignMembership).where(eq(campaignMembership.candidateId, s.candidateId));
    expect(mem!.status).toBe("excluded");
  });
});

describe("approval + scheduler", () => {
  it("approve/reject transitions are one-way from draft", async () => {
    const s = await seed(db);
    const [d] = await db
      .insert(outreachDraft)
      .values({
        orgId: s.orgId, campaignId: s.campaignId, candidateId: s.candidateId, angleId: s.angleId,
        subject: "s", bodyText: "b", status: "draft",
      })
      .returning({ id: outreachDraft.id });
    const ok = await approveDraft(db, { orgId: s.orgId, draftId: d!.id, userId: s.userId });
    expect(ok.ok).toBe(true);
    const again = await approveDraft(db, { orgId: s.orgId, draftId: d!.id, userId: s.userId });
    expect(again).toMatchObject({ ok: false, reason: "not_in_draft_status" });
    const rej = await rejectDraft(db, { orgId: s.orgId, draftId: d!.id, userId: s.userId });
    expect(rej.ok).toBe(false);
  });

  it("scheduler assigns a mailbox and sends approved drafts on active campaigns", async () => {
    const s = await seed(db);
    const [d] = await db
      .insert(outreachDraft)
      .values({
        orgId: s.orgId, campaignId: s.campaignId, candidateId: s.candidateId, angleId: s.angleId,
        subject: "s", bodyText: "b", status: "approved", approvedBy: s.userId, // no mailbox assigned
      })
      .returning({ id: outreachDraft.id });
    const provider = mockProvider();
    const summary = await runSendTick(db, provider, {});
    expect(summary).toMatchObject({ attempted: 1, sent: 1 });
    const [row] = await db.select().from(outreachDraft).where(eq(outreachDraft.id, d!.id));
    expect(row!.status).toBe("sent");
    expect(row!.mailboxId).toBe(s.mailboxId);
  });
});
