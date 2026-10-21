import { describe, expect, it } from "vitest";
import type { CrmContactHistory } from "@athena/contracts";
import { GhlAgencyReader, GhlCrmAdapter, exchangeGhlCode, ghlAuthorizeUrl, mergeHistories } from "../src/index";

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

  it("scopes lookups to named or listed sub-accounts and falls back to all when nothing matches", async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
      if (String(url).includes("/locations/search")) {
        return Response.json({ locations: [{ id: "L1", name: "Rob Petka" }, { id: "L2", name: "FCC - Lead Transfer" }, { id: "L3", name: "Someone Else" }] });
      }
      return Response.json({});
    }) as typeof fetch;
    const opts = { apiKey: "key", companyId: "agency", fetchImpl };
    expect((await GhlCrmAdapter.listLocations({ ...opts, scope: ["fcc lead transfer", "L1"] })).map((l) => l.id)).toEqual(["L1", "L2"]);
    const scoped = await GhlAgencyReader.scoped(["Rob Petka"], opts);
    expect(scoped.scope).toBe("scoped");
    expect((await scoped.listLocations()).map((l) => l.id)).toEqual(["L1"]);
    const wide = await GhlAgencyReader.scoped(["nobody"], opts);
    expect(wide.scope).toBe("all");
    expect(wide.total).toBe(3);
  });

  it("exchanges the agency token for a sub-account token and reuses it", async () => {
    const bearers: string[] = [];
    let exchanges = 0;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      const auth = String((init?.headers as Record<string, string> | undefined)?.authorization ?? "");
      if (u.endsWith("/oauth/locationToken")) {
        exchanges++;
        expect(auth).toBe("Bearer agency-key");
        expect(String(init?.body)).toBe("companyId=agency&locationId=L1");
        return Response.json({ access_token: "loc-token", expires_in: 86400 });
      }
      bearers.push(auth);
      if (u.endsWith("/contacts/search")) return Response.json({ contacts: [] });
      return Response.json({ pipelines: [] });
    }) as typeof fetch;
    const reader = new GhlAgencyReader("agency-key", "agency", fetchImpl, [{ id: "L1", name: "Rob Petka" }]);
    await reader.lookupContact({ email: "a@example.com" });
    await reader.lookupContact({ email: "b@example.com" });
    expect(exchanges).toBe(1);
    expect(bearers.every((b) => b === "Bearer loc-token")).toBe(true);
  });

  it("prefers a sub-account token from GHL_LOCATION_TOKENS over the exchange", async () => {
    process.env.GHL_LOCATION_TOKENS = "L9:pit-nine, L1:pit-one";
    const bearers: string[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/oauth/locationToken")) throw new Error("exchange must not be called");
      bearers.push(String((init?.headers as Record<string, string>).authorization));
      return Response.json({ contacts: [] });
    }) as typeof fetch;
    try {
      await new GhlAgencyReader("agency-key", "agency", fetchImpl, [{ id: "L1", name: "Rob" }]).lookupContact({ email: "x@example.com" });
    } finally { delete process.env.GHL_LOCATION_TOKENS; }
    expect(bearers).toEqual(["Bearer pit-one"]);
  });

  it("installs as an agency app and mints sub-account tokens with the agency OAuth token", async () => {
    const u = new URL(ghlAuthorizeUrl({ clientId: "6ad8c70276e05f9924b466c1-mvi73inl", redirectUri: "https://x/cb", state: "s1" }));
    expect(u.pathname).toBe("/v2/oauth/chooselocation");
    expect(u.searchParams.get("scope")).toContain("oauth.write");
    expect(u.searchParams.get("version_id")).toBe("6ad8c70276e05f9924b466c1");
    expect(u.searchParams.get("state")).toBe("s1");

    const seen: Record<string, string>[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      const auth = String((init?.headers as Record<string, string> | undefined)?.authorization ?? "");
      if (u.endsWith("/oauth/token")) {
        seen.push(Object.fromEntries(new URLSearchParams(String(init?.body))));
        return Response.json({ access_token: "agency-oauth", refresh_token: "r1", expires_in: 86399, scope: "oauth.write contacts.readonly", userType: "Company", companyId: "C1" });
      }
      if (u.endsWith("/oauth/locationToken")) {
        expect(auth).toBe("Bearer agency-oauth");
        return Response.json({ access_token: "loc-L1", expires_in: 86400 });
      }
      expect(auth).toBe("Bearer loc-L1");
      return Response.json({ contacts: [] });
    }) as typeof fetch;
    const t = await exchangeGhlCode({ clientId: "cid", clientSecret: "sec", code: "abc", redirectUri: "https://x/cb", fetchImpl });
    expect(t.companyId).toBe("C1");
    expect(seen[0]).toMatchObject({ grant_type: "authorization_code", user_type: "Company", code: "abc" });
    const reader = await GhlAgencyReader.scoped(["L1"], { agencyToken: t.accessToken, companyId: "C1", apiKey: null, fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("/locations/search")) return Response.json({ locations: [{ id: "L1", name: "Rob" }] });
      return fetchImpl(url, init);
    }) as typeof fetch });
    expect(await reader.lookupContact({ email: "a@example.com" })).toBeNull();
  });
});
