import { describe, expect, it } from "vitest";
import type { CrmContactHistory } from "@athena/contracts";
import { GhlAgencyReader, mergeHistories } from "../src/index";

const D = (s: string) => new Date(s);
const base = (over: Partial<CrmContactHistory>): CrmContactHistory => ({
  contactRef: "c", tags: [], dnd: false, source: null, addedAt: null, assignedTo: null, customFields: {},
  opportunities: [], messages: [], appointments: [], notes: [], ...over,
});

describe("one CRM reader over every consultant sub-account", () => {
  it("merges a lead found in two sub-accounts: DND anywhere wins, nothing duplicates, newest account leads", () => {
    const rob = base({
      contactRef: "r1", tags: ["4EverCharge"], source: "Trade show", assignedTo: "Rob", locations: [{ id: "L-rob", name: "Rob Petka" }],
      opportunities: [{ ref: "o1", name: "Pat", pipeline: "FCC", stage: "Contact Made", status: "lost", valueUsd: null, createdAt: D("2025-01-01"), updatedAt: D("2025-02-01") }],
      messages: [{ ref: "m1", channel: "email", direction: "outbound", occurredAt: D("2025-01-02"), subject: null, body: "hi" }],
    });
    const adam = base({
      contactRef: "a1", tags: ["CRS", "4EverCharge"], dnd: true, assignedTo: "Adam", locations: [{ id: "L-adam", name: "Adam Gruen" }],
      opportunities: [{ ref: "o2", name: "Pat", pipeline: "FCC", stage: "Talking to Zors", status: "open", valueUsd: 45000, createdAt: D("2026-03-01"), updatedAt: D("2026-06-01") }],
      messages: [{ ref: "m2", channel: "sms", direction: "inbound", occurredAt: D("2026-06-01"), subject: null, body: "yes" }],
      appointments: [{ ref: "ap1", title: "Consult", startsAt: D("2026-06-05"), endsAt: null, status: "showed" }],
    });
    const m = mergeHistories([rob, adam]);
    expect(m.dnd).toBe(true);
    expect(m.tags).toEqual(["4EverCharge", "CRS"]);
    expect(m.assignedTo).toBe("Adam"); // most recent activity
    expect(m.opportunities.map((o) => o.pipeline)).toEqual(["FCC (Rob Petka)", "FCC (Adam Gruen)"]);
    expect(m.messages.map((x) => x.ref)).toEqual(["m1", "m2"]);
    expect(m.locations?.map((l) => l.name)).toEqual(["Rob Petka", "Adam Gruen"]);
    expect(mergeHistories([rob, rob]).messages).toHaveLength(1);
  });

  it("fans the lookup out across sub-accounts and survives one broken account", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      calls.push(u);
      const body = init?.body ? JSON.parse(String(init.body)) as { locationId?: string } : {};
      if (u.endsWith("/contacts/search")) {
        if (body.locationId === "L-broken") return new Response("boom", { status: 500 });
        if (body.locationId === "L-adam") return Response.json({ contacts: [{ id: "a1", email: "pat@example.com", tags: ["CRS"], dnd: false }] });
        return Response.json({ contacts: [] });
      }
      if (u.includes("/opportunities/pipelines")) return Response.json({ pipelines: [] });
      return Response.json({ opportunities: [], conversations: [], events: [], notes: [] });
    }) as typeof fetch;
    const reader = new GhlAgencyReader("key", undefined, fetchImpl, [
      { id: "L-rob", name: "Rob Petka" }, { id: "L-broken", name: "Broken" }, { id: "L-adam", name: "Adam Gruen" },
    ]);
    const h = await reader.lookupContact({ email: "pat@example.com" });
    expect(h?.contactRef).toBe("a1");
    expect(h?.locations).toEqual([{ id: "L-adam", name: "Adam Gruen" }]);
    expect(calls.filter((c) => c.endsWith("/contacts/search"))).toHaveLength(3);
    expect(await reader.lookupContact({ email: "nobody@example.com" })).toBeNull();
  });
});
