import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CrmSyncAdapter, EmailProvider, LlmProvider, OutboundEmail, SmsProvider } from "@athena/contracts";
import {
  agentJob, appUser, appointment, assignment, candidate, candidateAttribute, consultant, consultantNudge, disposition,
  event, identifier, message, opportunity, org, personaMailbox, questionnaire, sourceRecord, suppression,
} from "@athena/db/schema";
import { handleCalendarEvent } from "../src/accountability/appointments";
import { applyCrmStage, syncOpportunity } from "../src/accountability/crm";
import { handleInboundSms, parseDispositionReply, recordDisposition } from "../src/accountability/dispositions";
import { runAccountabilityTick } from "../src/accountability/nudges";
import { advanceStage } from "../src/accountability/stages";
import { takeBackAssignment } from "../src/accountability/take-back";
import { classifyReply } from "../src/conversation/classify";
import { LlmGateway } from "../src/llm/gateway";
import { routeCandidate } from "../src/routing/assign";
import { recordFirstTouch } from "../src/routing/first-touch";
import { sendWarmIntro } from "../src/routing/intro";
import { rankConsultants } from "../src/routing/rank";
import { acceptAssignment, declineAssignment } from "../src/routing/respond";
import { EMPTY_STATS, type RoutingConsultant, type RoutingContext } from "../src/routing/types";
import { testDb } from "./helpers";

type Db = Awaited<ReturnType<typeof testDb>>["db"];
let db: Db;

const H = 3_600_000;

function llmReturning(json: unknown): LlmGateway {
  const provider: LlmProvider = {
    name: "mock-llm",
    complete: async () => ({ text: JSON.stringify(json), json, model: "mock", inputTokens: 5, outputTokens: 5, costUsd: 0 }),
  };
  return new LlmGateway(provider, db);
}
const INTRO_JSON = { candidateSubject: "Meet Rob", candidateBody: "Hi Pat, Rob will reach out.", consultantSubject: "Handoff: Pat", consultantBody: "Pat replied positive. Accept: link" };
function mockEmail() {
  let n = 0;
  return { name: "mock-gmail", sendEmail: vi.fn(async (_e: OutboundEmail) => ({ providerMessageId: `gm-${++n}` })) } satisfies EmailProvider;
}
function mockSms() {
  let n = 0;
  return { name: "mock-sms", sendSms: vi.fn(async (_m: { to: string; body: string }) => ({ providerMessageId: `sms-${++n}` })) } satisfies SmsProvider;
}
function mockCrm(): CrmSyncAdapter & { upserts: { name: string; stage: string }[] } {
  const upserts: { name: string; stage: string }[] = [];
  return {
    name: "mock-ghl", upserts,
    upsertOpportunity: async (i) => { upserts.push({ name: i.name, stage: i.stage }); return { externalRef: i.externalContactRef ?? "ghl-1" }; },
    parseStageWebhook: () => null,
  };
}

async function seed() {
  const [o] = await db.insert(org).values({ name: "T" }).returning({ id: org.id });
  const orgId = o!.id;
  const mk = async (email: string, role: "manager" | "consultant") =>
    (await db.insert(appUser).values({ id: crypto.randomUUID(), orgId, email, role }).returning({ id: appUser.id }))[0]!.id;
  const managerId = await mk("mgr@t.io", "manager");
  const robUser = await mk("rob@t.io", "consultant");
  const adamUser = await mk("adam@t.io", "consultant");
  const [c] = await db.insert(candidate).values({ orgId, fullName: "Pat Example", primaryEmail: "pat@example.com", city: "Plano", state: "TX", currentScore: 74 }).returning({ id: candidate.id });
  await db.insert(identifier).values({ orgId, candidateId: c!.id, type: "email", valueNormalized: "pat@example.com", valueRaw: "pat@example.com" });
  const [src] = await db.insert(sourceRecord).values({ orgId, sourceType: "resume", payload: {}, contentHash: "h" }).returning({ id: sourceRecord.id });
  await db.insert(candidateAttribute).values([
    { orgId, candidateId: c!.id, key: "franchise_interest", value: "home services", sourceRecordId: src!.id },
    { orgId, candidateId: c!.id, key: "research_note", value: "Ran a plumbing business.", sourceRecordId: src!.id },
  ]);
  const [sophie] = await db.insert(personaMailbox).values({ orgId, name: "Sophie", address: "sophie@persona.test", domain: "persona.test", avatarSlug: "agent-sophie" }).returning({ id: personaMailbox.id });
  const cons = await db.insert(consultant).values([
    { orgId, name: "Rob Petka", userId: robUser, email: "rob@t.io", phone: "+15550001111", territories: ["TX"], specialties: ["home services"], maxLoad: 5 },
    { orgId, name: "Adam Gruen", userId: adamUser, email: "adam@t.io", phone: "+15550002222", territories: [], specialties: [], maxLoad: 5 },
    { orgId, name: "Paused Pete", email: "pete@t.io", status: "paused", maxLoad: 5 },
  ]).returning({ id: consultant.id, name: consultant.name });
  const rob = cons.find((x) => x.name === "Rob Petka")!.id;
  const adam = cons.find((x) => x.name === "Adam Gruen")!.id;
  return { orgId, managerId, robUser, adamUser, candidateId: c!.id, rob, adam, sophieId: sophie!.id, srcId: src!.id };
}
async function eventsOf(type: string) {
  return db.select().from(event).where(eq(event.type, type));
}
async function jobsOf(type: string) {
  return db.select().from(agentJob).where(eq(agentJob.type, type));
}

beforeEach(async () => {
  db = (await testDb()).db;
});

describe("routing rules", () => {
  const base = (over: Partial<RoutingConsultant>): RoutingConsultant => ({
    id: "x", name: "X", userId: null, status: "active", maxLoad: 10, activeLoad: 0, specialties: [], territories: [], lastAssignedAt: null, stats: EMPTY_STATS, ...over,
  });
  const ctx: RoutingContext = { candidate: { id: "c", score: 70, state: "TX", interests: ["home services"], priorConsultantIds: [] }, now: new Date("2026-09-09T12:00:00Z") };

  it("is deterministic, drops paused/full consultants, and prefers specialty + territory + prior relationship", () => {
    const list = [
      base({ id: "a", name: "A", territories: ["TX"], specialties: ["home services"] }),
      base({ id: "b", name: "B" }),
      base({ id: "p", name: "P", status: "paused" }),
      base({ id: "f", name: "F", activeLoad: 10 }),
    ];
    const r1 = rankConsultants(list, ctx);
    const r2 = rankConsultants(list, ctx);
    expect(r1.map((r) => r.consultantId)).toEqual(["a", "b"]);
    expect(r1).toEqual(r2);
    expect(r1[0]!.factors.map((f) => f.rule)).toEqual(["availability", "prior_relationship", "specialty", "territory", "load", "performance", "round_robin"]);
    const prior = rankConsultants(list, { ...ctx, candidate: { ...ctx.candidate, priorConsultantIds: ["b"] } });
    expect(prior[0]!.consultantId).toBe("b");
    expect(rankConsultants(list, ctx, { excludeIds: ["a"] })[0]!.consultantId).toBe("b");
  });

  it("rewards performance and reserves top leads for strong performers", () => {
    const strong = base({ id: "s", name: "S", stats: { ...EMPTY_STATS, offered: 10, accepted: 10, showed: 8, noShow: 1, firstTouchMedianHours: 2 } });
    const weak = base({ id: "w", name: "W", stats: { ...EMPTY_STATS, offered: 10, accepted: 4, showed: 2, noShow: 4, firstTouchMedianHours: 30, takeBacks30d: 2 } });
    const normal = rankConsultants([weak, strong], ctx);
    expect(normal[0]!.consultantId).toBe("s");
    const top = rankConsultants([weak, strong], { ...ctx, candidate: { ...ctx.candidate, score: 92 } });
    const weakRow = top.find((r) => r.consultantId === "w")!;
    expect(weakRow.factors.find((f) => f.rule === "performance")!.reason).toContain("reserved");
    expect(top[0]!.consultantId).toBe("s");
  });
});

describe("handoff", () => {
  it("routes to the best consultant, opens the opportunity at Lead In, sets RLS ownership, and enqueues the intro in one tx", async () => {
    const s = await seed();
    const r = await routeCandidate(db, { orgId: s.orgId, candidateId: s.candidateId, trigger: "manual", personaMailboxId: s.sophieId });
    expect(r.assigned).toBe(true);
    expect(r.consultantId).toBe(s.rob); // TX + home services
    const [a] = await db.select().from(assignment);
    expect(a!.status).toBe("offered");
    expect((a!.reason as { factors: unknown[] }).factors).toHaveLength(7);
    const [o] = await db.select().from(opportunity);
    expect(o!.stage).toBe("lead_in");
    expect(o!.consultantId).toBe(s.rob);
    const [c] = await db.select().from(candidate).where(eq(candidate.id, s.candidateId));
    expect(c!.assignedToUserId).toBe(s.robUser);
    expect(c!.status).toBe("interested");
    expect(await eventsOf("assignment.offered")).toHaveLength(1);
    const jobs = await jobsOf("routing.intro");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.payload).toEqual({ assignmentId: a!.id });
    // a second route while one is live is refused, never double-assigned
    const again = await routeCandidate(db, { orgId: s.orgId, candidateId: s.candidateId, trigger: "manual" });
    expect(again).toMatchObject({ assigned: false, reason: "already_assigned" });
    expect(await db.select().from(assignment)).toHaveLength(1);
  });

  it("a confident positive reply enqueues routing.assign from the classifier", async () => {
    const s = await seed();
    const [m] = await db.insert(message).values({ orgId: s.orgId, candidateId: s.candidateId, direction: "inbound", provider: "smartlead", providerMessageId: "in-1", bodyText: "Yes, let's talk", occurredAt: new Date() }).returning({ id: message.id });
    await classifyReply(db, llmReturning({ classification: "positive", confidence: 0.96, rationale: "wants a call" }), { messageId: m!.id });
    const jobs = await jobsOf("routing.assign");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.payload).toMatchObject({ candidateId: s.candidateId, trigger: "positive_reply" });
    // below threshold: no handoff
    const [m2] = await db.insert(message).values({ orgId: s.orgId, candidateId: s.candidateId, direction: "inbound", provider: "smartlead", providerMessageId: "in-2", bodyText: "maybe", occurredAt: new Date() }).returning({ id: message.id });
    await classifyReply(db, llmReturning({ classification: "positive", confidence: 0.6, rationale: "unsure" }), { messageId: m2!.id });
    expect(await jobsOf("routing.assign")).toHaveLength(1);
  });

  it("sends the warm intro from the persona to candidate and consultant, once, never when suppressed or unconfigured", async () => {
    const s = await seed();
    const r = await routeCandidate(db, { orgId: s.orgId, candidateId: s.candidateId, trigger: "positive_reply", personaMailboxId: s.sophieId });
    const email = mockEmail();
    const out = await sendWarmIntro(db, llmReturning(INTRO_JSON), email, { assignmentId: r.assignmentId!, appUrl: "https://app.test" });
    expect(out.sent).toBe(true);
    expect(email.sendEmail).toHaveBeenCalledTimes(2);
    const calls = email.sendEmail.mock.calls.map((c) => c[0]);
    expect(calls[0]!.to).toBe("pat@example.com");
    expect(calls[1]!.to).toBe("rob@t.io");
    expect(calls[0]!.mailboxRef).toBe("sophie@persona.test");
    const msgs = await db.select().from(message).where(eq(message.personaMailboxId, s.sophieId));
    expect(msgs).toHaveLength(2);
    const [c] = await db.select().from(candidate).where(eq(candidate.id, s.candidateId));
    expect(c!.status).toBe("introduced");
    expect(await eventsOf("assignment.intro_sent")).toHaveLength(1);
    // idempotent
    const again = await sendWarmIntro(db, llmReturning(INTRO_JSON), email, { assignmentId: r.assignmentId!, appUrl: "https://app.test" });
    expect(again).toMatchObject({ sent: false, reason: "already_sent" });
    expect(email.sendEmail).toHaveBeenCalledTimes(2);
  });

  it("intro refuses on suppression and on a persona without an address", async () => {
    const s = await seed();
    await db.update(personaMailbox).set({ address: null }).where(eq(personaMailbox.id, s.sophieId));
    const r = await routeCandidate(db, { orgId: s.orgId, candidateId: s.candidateId, trigger: "manual", personaMailboxId: s.sophieId });
    const email = mockEmail();
    expect(await sendWarmIntro(db, llmReturning(INTRO_JSON), email, { assignmentId: r.assignmentId!, appUrl: "x" })).toMatchObject({ sent: false, reason: "persona_unconfigured" });
    await db.update(personaMailbox).set({ address: "sophie@persona.test" }).where(eq(personaMailbox.id, s.sophieId));
    await db.insert(suppression).values({ orgId: s.orgId, channel: "email", identifier: "pat@example.com", reason: "unsubscribed", source: "test" });
    expect(await sendWarmIntro(db, llmReturning(INTRO_JSON), email, { assignmentId: r.assignmentId!, appUrl: "x" })).toMatchObject({ sent: false, reason: "suppressed" });
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it("accept records the response; decline re-routes excluding the decliner", async () => {
    const s = await seed();
    const r = await routeCandidate(db, { orgId: s.orgId, candidateId: s.candidateId, trigger: "manual" });
    const d = await declineAssignment(db, { orgId: s.orgId, assignmentId: r.assignmentId!, actorType: "user", actorId: s.robUser, reason: "on vacation" });
    expect(d.ok).toBe(true);
    expect(d.reroute!.consultantId).toBe(s.adam);
    const rows = await db.select().from(assignment);
    expect(rows.map((a) => a.status).sort()).toEqual(["declined", "offered"]);
    const [o] = await db.select().from(opportunity);
    expect(o!.consultantId).toBe(s.adam); // opportunity follows the candidate
    const [c] = await db.select().from(candidate).where(eq(candidate.id, s.candidateId));
    expect(c!.assignedToUserId).toBe(s.adamUser);
    const acc = await acceptAssignment(db, { orgId: s.orgId, assignmentId: d.reroute!.assignmentId!, actorType: "user", actorId: s.adamUser });
    expect(acc.ok).toBe(true);
    expect((await db.select().from(candidate).where(eq(candidate.id, s.candidateId)))[0]!.status).toBe("in_opportunity");
  });
});

describe("accountability", () => {
  it("nudges at +1h, +4h, manager at +24h — once each — and takes the lead back at 48h", async () => {
    const s = await seed();
    const t0 = new Date("2026-09-09T09:00:00Z");
    const r = await routeCandidate(db, { orgId: s.orgId, candidateId: s.candidateId, trigger: "manual", now: t0 });
    const sms = mockSms();
    const tick = (ms: number) => runAccountabilityTick(db, sms, { orgId: s.orgId, managerPhone: "+15550009999", now: new Date(t0.getTime() + ms) });

    expect(await tick(30 * 60_000)).toMatchObject({ nudgesCreated: 0, nudgesSent: 0, takeBacks: 0 });
    expect(await tick(1 * H + 1)).toMatchObject({ nudgesCreated: 1, nudgesSent: 1 });
    expect(sms.sendSms.mock.calls[0]![0].to).toBe("+15550001111");
    expect(await tick(1 * H + 5 * 60_000)).toMatchObject({ nudgesCreated: 0, nudgesSent: 0 }); // no duplicate
    expect(await tick(4 * H + 1)).toMatchObject({ nudgesCreated: 1, nudgesSent: 1 });
    expect(await tick(24 * H + 1)).toMatchObject({ nudgesCreated: 1, nudgesSent: 1 });
    expect(sms.sendSms.mock.calls[2]![0].to).toBe("+15550009999"); // manager
    expect(sms.sendSms.mock.calls[2]![0].body).toContain("Take-back at 48h");
    expect(await db.select().from(consultantNudge)).toHaveLength(3);

    const tb = await tick(48 * H + 1);
    expect(tb.takeBacks).toBe(1);
    const rows = await db.select().from(assignment);
    const old = rows.find((a) => a.id === r.assignmentId)!;
    expect(old.status).toBe("taken_back");
    const fresh = rows.find((a) => a.id !== r.assignmentId)!;
    expect(fresh.consultantId).toBe(s.adam); // rerouted, excluding Rob
    expect(fresh.status).toBe("offered");
    expect(await eventsOf("assignment.taken_back")).toHaveLength(1);
    expect((await db.select().from(candidate).where(eq(candidate.id, s.candidateId)))[0]!.assignedToUserId).toBe(s.adamUser);
    // ladder restarts for the new assignment, old one is silent
    expect(await tick(48 * H + 1 * H + 2)).toMatchObject({ nudgesCreated: 1, takeBacks: 0 });
  });

  it("a logged first touch stops the clock and moves Lead In → Contact Made", async () => {
    const s = await seed();
    const t0 = new Date("2026-09-09T09:00:00Z");
    const r = await routeCandidate(db, { orgId: s.orgId, candidateId: s.candidateId, trigger: "manual", now: t0 });
    const ft = await recordFirstTouch(db, { orgId: s.orgId, assignmentId: r.assignmentId!, channel: "call", actorType: "user", actorId: s.robUser, now: new Date(t0.getTime() + 2 * H) });
    expect(ft).toEqual({ ok: true, firstTouch: true });
    expect((await db.select().from(opportunity))[0]!.stage).toBe("contact_made");
    expect(await jobsOf("crm.sync")).toHaveLength(1);
    const sms = mockSms();
    expect(await runAccountabilityTick(db, sms, { orgId: s.orgId, now: new Date(t0.getTime() + 50 * H) })).toMatchObject({ nudgesCreated: 0, takeBacks: 0 });
    expect((await db.select().from(assignment))[0]!.status).toBe("accepted");
    // manager take-back is explicit and re-routes
    const tb = await takeBackAssignment(db, { orgId: s.orgId, assignmentId: r.assignmentId!, reason: "manager", actorType: "user", actorId: s.managerId });
    expect(tb.ok).toBe(true);
    expect(tb.reroute!.consultantId).toBe(s.adam);
  });

  it("calendar bookings are idempotent, count as first touch, and flag a missing CQ", async () => {
    const s = await seed();
    const r = await routeCandidate(db, { orgId: s.orgId, candidateId: s.candidateId, trigger: "manual" });
    const starts = new Date(Date.now() + 2 * 86_400_000);
    const evt = { kind: "scheduled" as const, provider: "calendly" as const, externalRef: "cal-1", startsAt: starts, inviteeEmail: "Pat@Example.com" };
    const a1 = await handleCalendarEvent(db, evt);
    expect(a1).toMatchObject({ handled: true, deduped: false, cqMissing: true });
    expect(await handleCalendarEvent(db, evt)).toMatchObject({ handled: true, deduped: true });
    expect(await db.select().from(appointment)).toHaveLength(1);
    expect((await db.select().from(assignment).where(eq(assignment.id, r.assignmentId!)))[0]!.firstTouchAt).not.toBeNull();
    expect(await eventsOf("appointment.cq_missing")).toHaveLength(1);
    expect((await db.select().from(opportunity))[0]!.stage).toBe("contact_made");
    expect(await handleCalendarEvent(db, { ...evt, inviteeEmail: "nobody@example.com", externalRef: "cal-2" })).toMatchObject({ handled: false, reason: "unknown_invitee" });
    // with a CQ on file the flag is clear
    await db.insert(questionnaire).values({ orgId: s.orgId, candidateId: s.candidateId, kind: "cq_complete", sourceRecordId: s.srcId });
    expect(await handleCalendarEvent(db, { ...evt, externalRef: "cal-3" })).toMatchObject({ handled: true, cqMissing: false });
    expect(await handleCalendarEvent(db, { ...evt, kind: "canceled", externalRef: "cal-3" })).toMatchObject({ handled: true });
  });

  it("after the meeting ends the disposition ladder fires; replying '1' records it and advances the stage in Athena and GHL", async () => {
    const s = await seed();
    const t0 = new Date("2026-09-09T09:00:00Z");
    const r = await routeCandidate(db, { orgId: s.orgId, candidateId: s.candidateId, trigger: "manual", now: t0 });
    await acceptAssignment(db, { orgId: s.orgId, assignmentId: r.assignmentId!, actorType: "user", now: t0 });
    await handleCalendarEvent(db, { kind: "scheduled", provider: "calendly", externalRef: "cal-9", startsAt: new Date(t0.getTime() + 24 * H), endsAt: new Date(t0.getTime() + 25 * H), inviteeEmail: "pat@example.com" });
    const sms = mockSms();
    const t = (ms: number) => runAccountabilityTick(db, sms, { orgId: s.orgId, managerPhone: "+15550009999", now: new Date(t0.getTime() + ms) });
    expect(await t(25 * H + 30 * 60_000)).toMatchObject({ nudgesCreated: 0 });
    expect(await t(26 * H + 1)).toMatchObject({ nudgesCreated: 1, nudgesSent: 1 });
    expect(sms.sendSms.mock.calls[0]![0].body).toContain("Reply 1 showed");

    expect(parseDispositionReply(" 1 ")).toBe("1");
    expect(parseDispositionReply("Option 3 - they didn't show")).toBe("3");
    expect(parseDispositionReply("thanks")).toBeNull();
    const reply = await handleInboundSms(db, { fromPhone: "+1 (555) 000-1111", text: "1", now: new Date(t0.getTime() + 27 * H) });
    expect(reply).toMatchObject({ handled: true, action: "disposition" });
    const [ap] = await db.select().from(appointment);
    expect(ap!.status).toBe("showed");
    expect(await db.select().from(disposition)).toHaveLength(1);
    const [o] = await db.select().from(opportunity);
    expect(o!.stage).toBe("cq_sent"); // contact_made → next
    const [n] = await db.select().from(consultantNudge);
    expect(n!.response).toBe("1");
    // the CRM mirror job was enqueued by the stage change and syncs the label
    const syncJobs = await jobsOf("crm.sync");
    expect(syncJobs.length).toBeGreaterThan(0);
    const crm = mockCrm();
    const sync = await syncOpportunity(db, crm, { opportunityId: o!.id });
    expect(sync.ok).toBe(true);
    expect(crm.upserts.at(-1)).toEqual({ name: "Pat Example", stage: "CQ Sent" });
    expect((await db.select().from(opportunity))[0]!.ghlRef).toBe("ghl-1");
    // a stage change in GHL flows back without echo
    const back = await applyCrmStage(db, { externalRef: "ghl-1", stage: "Talking to Zors" });
    expect(back).toMatchObject({ ok: true, changed: true, to: "talking_to_zors" });
    const echo = (await jobsOf("crm.sync")).length;
    expect(echo).toBe(syncJobs.length); // no new sync job for a GHL-sourced change
    // no second disposition, and the ladder stays quiet
    expect(await recordDisposition(db, { orgId: s.orgId, appointmentId: ap!.id, code: "3", via: "ui", actorType: "user" })).toMatchObject({ ok: false, reason: "already_recorded" });
    expect(await t(30 * H)).toMatchObject({ nudgesCreated: 0 });
  });

  it("'2' closes the opportunity as lost; '3' is a no-show with the stage held", async () => {
    const s = await seed();
    await routeCandidate(db, { orgId: s.orgId, candidateId: s.candidateId, trigger: "manual" });
    await handleCalendarEvent(db, { kind: "scheduled", provider: "manual", externalRef: "m-1", startsAt: new Date(Date.now() - 2 * H), inviteeEmail: "pat@example.com" });
    const [ap] = await db.select().from(appointment);
    const r3 = await recordDisposition(db, { orgId: s.orgId, appointmentId: ap!.id, code: "3", via: "ui", actorType: "user" });
    expect(r3).toMatchObject({ ok: true, stageTo: null });
    expect((await db.select().from(appointment))[0]!.status).toBe("no_show");
    expect((await db.select().from(opportunity))[0]!.stage).toBe("contact_made");
    await handleCalendarEvent(db, { kind: "scheduled", provider: "manual", externalRef: "m-2", startsAt: new Date(Date.now() - 1 * H), inviteeEmail: "pat@example.com" });
    const ap2 = (await db.select().from(appointment)).find((a) => a.externalRef === "m-2")!;
    const r2 = await recordDisposition(db, { orgId: s.orgId, appointmentId: ap2.id, code: "2", via: "ui", actorType: "user" });
    expect(r2).toMatchObject({ ok: true, stageTo: "closed_lost" });
    expect((await db.select().from(candidate).where(eq(candidate.id, s.candidateId)))[0]!.status).toBe("closed_lost");
    // stages never move backwards automatically
    expect(await db.transaction((tx) => advanceStage(tx, { orgId: s.orgId, candidateId: s.candidateId, to: "lead_in", minimumOnly: true }))).toBeNull();
  });
});
