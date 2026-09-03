import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailProvider, LlmProvider, OutboundEmail } from "@athena/contracts";
import {
  agentJob, appUser, candidate, candidateAttribute, conversation, event, identifier, mailbox, message, org,
  sourceRecord, suppression,
} from "@athena/db/schema";
import { sendAutoReply } from "../src/conversation/auto-reply";
import { classifyReply, routeClassification } from "../src/conversation/classify";
import { buildConversationContext } from "../src/conversation/context";
import { listConversations, overrideRate } from "../src/conversation/queue";
import { overrideClassification } from "../src/conversation/state";
import { LlmGateway } from "../src/llm/gateway";
import { handleEmailWebhook } from "../src/outreach/webhooks";
import { testDb } from "./helpers";

type Db = Awaited<ReturnType<typeof testDb>>["db"];

function llmReturning(json: unknown): LlmGateway {
  const provider: LlmProvider = {
    name: "mock-llm",
    complete: async () => ({ text: JSON.stringify(json), json, model: "mock", inputTokens: 5, outputTokens: 5, costUsd: 0 }),
  };
  return new LlmGateway(provider, db);
}
function llmFailing(): LlmGateway {
  return new LlmGateway({ name: "mock-llm", complete: async () => { throw new Error("boom"); } }, db);
}
function mockProvider() {
  let n = 0;
  return { name: "mock-email", sendEmail: vi.fn(async (_e: OutboundEmail) => ({ providerMessageId: `out-${++n}` })) } satisfies EmailProvider;
}

let db: Db;
async function seed() {
  const [o] = await db.insert(org).values({ name: "T" }).returning({ id: org.id });
  const orgId = o!.id;
  const [u] = await db.insert(appUser).values({ id: crypto.randomUUID(), orgId, email: "op@t.io", role: "manager" }).returning({ id: appUser.id });
  const [c] = await db.insert(candidate).values({ orgId, fullName: "Pat Example", primaryEmail: "pat@example.com", city: "Plano", state: "TX", currentScore: 74 }).returning({ id: candidate.id });
  await db.insert(identifier).values({ orgId, candidateId: c!.id, type: "email", valueNormalized: "pat@example.com", valueRaw: "pat@example.com" });
  const [mb] = await db.insert(mailbox).values({ orgId, provider: "smartlead", address: "amy@pool.test", domain: "pool.test", status: "active", externalRef: "sl-amy" }).returning({ id: mailbox.id });
  // The outbound email that started the thread.
  await db.insert(message).values({ orgId, candidateId: c!.id, direction: "outbound", provider: "smartlead", providerMessageId: "out-0", mailboxId: mb!.id, subject: "Quick question", bodyText: "Hi Pat — still curious?", occurredAt: new Date(Date.now() - 3600_000) });
  return { orgId, userId: u!.id, candidateId: c!.id, mailboxId: mb!.id };
}
async function inbound(orgId: string, candidateId: string, body: string, id = `in-${Math.random()}`) {
  const [m] = await db.insert(message).values({ orgId, candidateId, direction: "inbound", provider: "smartlead", providerMessageId: id, subject: "Re: Quick question", bodyText: body, occurredAt: new Date() }).returning({ id: message.id });
  return m!.id;
}

beforeEach(async () => { db = (await testDb()).db; });

describe("routing table", () => {
  it("only asks_what_this_is / needs_info at ≥0.90 auto-reply; everything uncertain goes to a human", () => {
    expect(routeClassification("needs_info", 0.95).action).toBe("auto_reply_queued");
    expect(routeClassification("asks_what_this_is", 0.9).action).toBe("auto_reply_queued");
    expect(routeClassification("needs_info", 0.89).action).toBe("human_queue");
    expect(routeClassification("positive", 0.99)).toMatchObject({ state: "awaiting_human", flagged: true });
    expect(routeClassification("unsubscribe", 0.95).action).toBe("suppressed");
    expect(routeClassification("unsubscribe", 0.7)).toMatchObject({ state: "awaiting_human", flagged: true });
    expect(routeClassification("not_interested", 0.95)).toMatchObject({ state: "closed" });
    expect(routeClassification("maybe_later", 0.95)).toMatchObject({ state: "awaiting_human", flagged: false });
    expect(routeClassification("ambiguous", 0)).toMatchObject({ state: "awaiting_human", flagged: true });
  });
});

describe("classifyReply", () => {
  it("classifies, opens a conversation, flags for humans, and is idempotent", async () => {
    const s = await seed();
    const mid = await inbound(s.orgId, s.candidateId, "Yes! I'd love to talk this week.");
    const r1 = await classifyReply(db, llmReturning({ classification: "positive", confidence: 0.97, summary: "wants a call" }), { messageId: mid });
    expect(r1).toMatchObject({ classification: "positive", confidence: 0.97, state: "awaiting_human", flagged: true, action: "human_queue" });
    const r2 = await classifyReply(db, llmReturning({ classification: "hostile", confidence: 0.99, summary: "x" }), { messageId: mid });
    expect(r2?.action).toBe("already_classified");
    const convs = await db.select().from(conversation).where(eq(conversation.candidateId, s.candidateId));
    expect(convs).toHaveLength(1);
    const [m] = await db.select().from(message).where(eq(message.id, mid));
    expect(m!.classification).toBe("positive");
    expect(Number(m!.classificationConfidence)).toBeCloseTo(0.97);
    const evts = await db.select().from(event).where(eq(event.type, "conversation.classified"));
    expect(evts).toHaveLength(1);
  });

  it("queues an auto-reply job only at ≥0.90 for eligible classes", async () => {
    const s = await seed();
    const mid = await inbound(s.orgId, s.candidateId, "Sorry, who is this and how did you get my email?");
    const r = await classifyReply(db, llmReturning({ classification: "asks_what_this_is", confidence: 0.94, summary: "" }), { messageId: mid });
    expect(r?.action).toBe("auto_reply_queued");
    const jobs = await db.select().from(agentJob).where(eq(agentJob.type, "conversation.auto_reply"));
    expect(jobs).toHaveLength(1);

    const mid2 = await inbound(s.orgId, s.candidateId, "what is this");
    const r2 = await classifyReply(db, llmReturning({ classification: "asks_what_this_is", confidence: 0.8, summary: "" }), { messageId: mid2 });
    expect(r2?.action).toBe("human_queue");
    expect((await db.select().from(agentJob).where(eq(agentJob.type, "conversation.auto_reply"))).length).toBe(1);
  });

  it("confident unsubscribe lands in suppression and closes the conversation", async () => {
    const s = await seed();
    const mid = await inbound(s.orgId, s.candidateId, "Please remove me from your list.");
    const r = await classifyReply(db, llmReturning({ classification: "unsubscribe", confidence: 0.98, summary: "" }), { messageId: mid });
    expect(r).toMatchObject({ action: "suppressed", state: "closed" });
    const sup = await db.select().from(suppression).where(eq(suppression.identifier, "pat@example.com"));
    expect(sup).toHaveLength(1);
  });

  it("LLM failure degrades to ambiguous → flagged human queue, never an auto-reply", async () => {
    const s = await seed();
    const mid = await inbound(s.orgId, s.candidateId, "???");
    const r = await classifyReply(db, llmFailing(), { messageId: mid });
    expect(r).toMatchObject({ classification: "ambiguous", confidence: 0, state: "awaiting_human", flagged: true });
    expect((await db.select().from(agentJob).where(eq(agentJob.type, "conversation.auto_reply"))).length).toBe(0);
  });

  it("webhook reply → classify job → classification, end to end", async () => {
    const s = await seed();
    await handleEmailWebhook(db, { kind: "reply", provider: "smartlead", providerMessageId: "sl-r9", email: "pat@example.com", subject: "Re: hi", bodyText: "How much does this cost?", occurredAt: new Date() });
    const [job] = await db.select().from(agentJob).where(eq(agentJob.type, "conversation.classify"));
    const messageId = (job!.payload as { messageId: string }).messageId;
    const r = await classifyReply(db, llmReturning({ classification: "asks_about_investment", confidence: 0.93, summary: "" }), { messageId, agentJobId: job!.id });
    expect(r).toMatchObject({ classification: "asks_about_investment", flagged: true });
    void s;
  });
});

describe("auto-reply gate", () => {
  it("NEVER sends below the threshold, for ineligible classes, or to suppressed addresses", async () => {
    const s = await seed();
    const provider = mockProvider();
    const llm = llmReturning({ subject: "Re: Quick question", bodyText: "Happy to explain — we help people evaluate franchise ownership at no cost. Open to a quick call? {{sender_first_name}}" });

    const low = await inbound(s.orgId, s.candidateId, "what is this?", "in-low");
    await classifyReply(db, llmReturning({ classification: "needs_info", confidence: 0.85, summary: "" }), { messageId: low });
    expect(await sendAutoReply(db, llm, provider, { messageId: low })).toMatchObject({ sent: false, reason: "below_threshold" });

    const wrongClass = await inbound(s.orgId, s.candidateId, "yes please call me", "in-pos");
    await classifyReply(db, llmReturning({ classification: "positive", confidence: 0.99, summary: "" }), { messageId: wrongClass });
    expect(await sendAutoReply(db, llm, provider, { messageId: wrongClass })).toMatchObject({ sent: false, reason: "class_not_eligible" });

    expect(provider.sendEmail).not.toHaveBeenCalled();
    const refusals = await db.select().from(event).where(eq(event.type, "conversation.auto_reply_refused"));
    expect(refusals).toHaveLength(2);
  });

  it("sends at ≥0.90 for an eligible class, records the outbound message, and won't double-reply", async () => {
    const s = await seed();
    const provider = mockProvider();
    const llm = llmReturning({ subject: "Re: Quick question", bodyText: "Happy to explain. {{sender_first_name}}" });
    const mid = await inbound(s.orgId, s.candidateId, "Who are you?", "in-ok");
    await classifyReply(db, llmReturning({ classification: "asks_what_this_is", confidence: 0.96, summary: "" }), { messageId: mid });

    const r = await sendAutoReply(db, llm, provider, { messageId: mid });
    expect(r.sent).toBe(true);
    expect(provider.sendEmail).toHaveBeenCalledOnce();
    expect(provider.sendEmail.mock.calls[0]![0]).toMatchObject({ to: "pat@example.com", mailboxRef: "sl-amy" });
    const [conv] = await db.select().from(conversation).where(eq(conversation.candidateId, s.candidateId));
    expect(conv!.state).toBe("awaiting_candidate");
    const thread = await db.select().from(message).where(eq(message.conversationId, conv!.id));
    // Thread = original outreach (back-linked) + inbound + exactly one auto-reply.
    expect(thread.filter((m) => m.direction === "outbound")).toHaveLength(2);
    expect(thread.filter((m) => m.provider === "mock-email")).toHaveLength(1);

    const again = await sendAutoReply(db, llm, provider, { messageId: mid });
    expect(again).toMatchObject({ sent: false, reason: "already_replied" });
    expect(provider.sendEmail).toHaveBeenCalledOnce();
  });

  it("refuses when the address is suppressed even if eligible", async () => {
    const s = await seed();
    await db.insert(suppression).values({ orgId: s.orgId, channel: "email", identifier: "pat@example.com", reason: "test" });
    const provider = mockProvider();
    const mid = await inbound(s.orgId, s.candidateId, "Who are you?", "in-sup");
    await classifyReply(db, llmReturning({ classification: "needs_info", confidence: 0.95, summary: "" }), { messageId: mid });
    expect(await sendAutoReply(db, llmReturning({ subject: "s", bodyText: "b" }), provider, { messageId: mid })).toMatchObject({ sent: false, reason: "suppressed" });
    expect(provider.sendEmail).not.toHaveBeenCalled();
  });
});

describe("overrides, queue, context", () => {
  it("override records an event and the override rate is measurable", async () => {
    const s = await seed();
    const mid = await inbound(s.orgId, s.candidateId, "maybe next year");
    await classifyReply(db, llmReturning({ classification: "not_interested", confidence: 0.6, summary: "" }), { messageId: mid });
    const r = await overrideClassification(db, { orgId: s.orgId, messageId: mid, classification: "maybe_later", userId: s.userId });
    expect(r.ok).toBe(true);
    const [m] = await db.select().from(message).where(eq(message.id, mid));
    expect(m!.classification).toBe("maybe_later");
    expect(await overrideRate(db, s.orgId)).toMatchObject({ classified: 1, overridden: 1, rate: 1 });
  });

  it("queue is flagged-first, then newest", async () => {
    const s = await seed();
    const [c2] = await db.insert(candidate).values({ orgId: s.orgId, fullName: "Sam Later", primaryEmail: "sam@example.com" }).returning({ id: candidate.id });
    const a = await inbound(s.orgId, s.candidateId, "not now", "q1");
    await classifyReply(db, llmReturning({ classification: "maybe_later", confidence: 0.95, summary: "" }), { messageId: a });
    const b = await inbound(s.orgId, c2!.id, "I'm in!", "q2");
    await classifyReply(db, llmReturning({ classification: "positive", confidence: 0.95, summary: "" }), { messageId: b });
    const rows = await listConversations(db, s.orgId);
    expect(rows.map((r) => r.candidateName)).toEqual(["Sam Later", "Pat Example"]);
    expect(rows[0]!.flagged).toBe(true);
  });

  it("context carries provenance facts, the research note, and only the last N messages", async () => {
    const s = await seed();
    const [src] = await db.insert(sourceRecord).values({ orgId: s.orgId, sourceType: "resume", payload: {}, contentHash: "h" }).returning({ id: sourceRecord.id });
    await db.insert(candidateAttribute).values([
      { orgId: s.orgId, candidateId: s.candidateId, key: "franchise_interest", value: "home services", sourceRecordId: src!.id },
      { orgId: s.orgId, candidateId: s.candidateId, key: "research_note", value: "Ran a plumbing business 2015-2020.", sourceRecordId: src!.id },
    ]);
    for (let i = 0; i < 10; i++) await inbound(s.orgId, s.candidateId, `msg ${i}`, `ctx-${i}`);
    const ctx = await buildConversationContext(db, { orgId: s.orgId, candidateId: s.candidateId, lastN: 4 });
    expect(ctx.messages).toHaveLength(4);
    expect(ctx.facts).toEqual([{ key: "franchise_interest", value: "home services" }]);
    expect(ctx.researchNote).toContain("plumbing");
    expect(ctx.candidate).toMatchObject({ name: "Pat Example", location: "Plano, TX", score: 74 });
  });
});
