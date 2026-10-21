import type { CrmContactHistory, CrmReader, CrmSyncAdapter } from "@athena/contracts";

const API = "https://services.leadconnectorhq.com";
const VERSION = "2021-07-28";

interface Pipeline { id: string; name: string; stages: { id: string; name: string }[] }

/**
 * Agency tokens cannot call sub-account endpoints directly; GHL hands out a
 * short-lived location token per sub-account in exchange. Cached per
 * process until a minute before expiry. Without GHL_COMPANY_ID the key is
 * assumed to be a sub-account token and is used as-is.
 */
const locationTokens = new Map<string, { token: string; expiresAt: number }>();

/** GHL_LOCATION_TOKENS="locId:token,locId:token" — a private-integration token issued inside a sub-account; wins over the exchange. */
function presetLocationToken(locationId: string): string | null {
  for (const pair of (process.env.GHL_LOCATION_TOKENS ?? "").split(",")) {
    const i = pair.indexOf(":");
    if (i > 0 && pair.slice(0, i).trim() === locationId) return pair.slice(i + 1).trim() || null;
  }
  return null;
}

export async function locationBearer(opts: { apiKey?: string | null; agencyToken?: string | null; companyId?: string | null; locationId: string; token?: string | null; fetchImpl?: typeof fetch }): Promise<string> {
  if (opts.token) return opts.token;
  const preset = presetLocationToken(opts.locationId);
  if (preset) return preset;
  const agency = opts.agencyToken ?? opts.apiKey;
  if (!opts.companyId || !agency) {
    if (opts.apiKey) return opts.apiKey;
    throw new Error("GHL is not configured (no sub-account token, agency app or API key)");
  }
  const key = `${opts.companyId}:${opts.locationId}`;
  const hit = locationTokens.get(key);
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token;
  const f = opts.fetchImpl ?? fetch;
  const res = await f(`${API}/oauth/locationToken`, {
    method: "POST",
    headers: { authorization: `Bearer ${agency}`, version: VERSION, "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ companyId: opts.companyId, locationId: opts.locationId }).toString(),
  });
  if (!res.ok) throw new Error(`ghl location token for ${opts.locationId} failed: ${res.status} ${(await res.text().catch(() => "")).slice(0, 120)} — connect the GoHighLevel app (Connections page), or paste a sub-account token on the roster`);
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("ghl location token response had no access_token");
  locationTokens.set(key, { token: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 86_400) * 1000 });
  return json.access_token;
}

/**
 * GoHighLevel opportunity mirror behind CrmSyncAdapter (ADR 0004: Athena
 * owns stages; GHL displays them). Stage names are the FCC vocabulary and
 * are matched by name inside the configured pipeline.
 * Env: GHL_API_KEY, GHL_LOCATION_ID, GHL_PIPELINE_ID (or GHL_PIPELINE_NAME).
 */
// ---------------------------------------------------------------- marketplace app (OAuth 2.0)

/** Scopes the Athena marketplace app asks for. oauth.write is what lets an agency token mint sub-account tokens. */
export const GHL_APP_SCOPES = [
  "companies.readonly", "locations.readonly", "users.readonly",
  "contacts.readonly", "contacts.write",
  "conversations.readonly", "conversations/message.readonly", "conversations/message.write",
  "opportunities.readonly", "opportunities.write",
  "calendars/events.readonly",
  "oauth.readonly", "oauth.write",
] as const;

export interface GhlOAuthTokens { accessToken: string; refreshToken: string | null; expiresIn: number; scope: string | null; companyId: string | null; userType: string | null }

/** Where the installer is sent; GHL asks which agency to install on, then redirects back with ?code=. */
export function ghlAuthorizeUrl(opts: { clientId: string; redirectUri: string; state: string; scopes?: readonly string[] }): string {
  const u = new URL("https://marketplace.gohighlevel.com/oauth/chooselocation");
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", opts.redirectUri);
  u.searchParams.set("client_id", opts.clientId);
  u.searchParams.set("scope", (opts.scopes ?? GHL_APP_SCOPES).join(" "));
  u.searchParams.set("state", opts.state);
  return u.toString();
}

async function oauthToken(form: Record<string, string>, fetchImpl: typeof fetch = fetch): Promise<GhlOAuthTokens> {
  const res = await fetchImpl(`${API}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(form).toString(),
  });
  if (!res.ok) throw new Error(`ghl oauth token failed: ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const j = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; companyId?: string; userType?: string };
  if (!j.access_token) throw new Error("ghl oauth token response had no access_token");
  return { accessToken: j.access_token, refreshToken: j.refresh_token ?? null, expiresIn: Number(j.expires_in ?? 86_399), scope: j.scope ?? null, companyId: j.companyId ?? null, userType: j.userType ?? null };
}

/** Authorization code → agency tokens (user_type Company). */
export function exchangeGhlCode(opts: { clientId: string; clientSecret: string; code: string; redirectUri: string; fetchImpl?: typeof fetch }): Promise<GhlOAuthTokens> {
  return oauthToken({ client_id: opts.clientId, client_secret: opts.clientSecret, grant_type: "authorization_code", code: opts.code, user_type: "Company", redirect_uri: opts.redirectUri }, opts.fetchImpl);
}

/** Refresh an agency access token (they last ~24h; refresh tokens a year). */
export function refreshGhlAccess(opts: { clientId: string; clientSecret: string; refreshToken: string; fetchImpl?: typeof fetch }): Promise<GhlOAuthTokens> {
  return oauthToken({ client_id: opts.clientId, client_secret: opts.clientSecret, grant_type: "refresh_token", refresh_token: opts.refreshToken, user_type: "Company" }, opts.fetchImpl);
}

/** The installed app's agency credential, as the callers hand it to the adapters. */
export interface GhlAgency { agencyToken: string; companyId: string | null }

export interface GhlCrmOptions {
  apiKey?: string | null; locationId?: string | null; pipelineRef?: string | null; fetchImpl?: typeof fetch;
  companyId?: string | null; locationToken?: string | null; agencyToken?: string | null;
}

export class GhlCrmAdapter implements CrmSyncAdapter, CrmReader {
  readonly name = "ghl";
  private pipeline: Pipeline | null = null;

  private readonly apiKey: string | null;
  private readonly locationId: string | null;
  private readonly pipelineRef: string | null;
  private readonly fetchImpl: typeof fetch;
  private readonly companyId: string | null;
  private readonly locationToken: string | null;
  private readonly agencyToken: string | null;

  constructor(private readonly opts: GhlCrmOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.GHL_API_KEY ?? null;
    this.locationId = opts.locationId ?? process.env.GHL_LOCATION_ID ?? null;
    this.pipelineRef = opts.pipelineRef ?? process.env.GHL_PIPELINE_ID ?? process.env.GHL_PIPELINE_NAME ?? null;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.companyId = opts.companyId ?? process.env.GHL_COMPANY_ID ?? null;
    this.locationToken = opts.locationToken ?? null;
    this.agencyToken = opts.agencyToken ?? null;
  }

  /** The mirror needs a way in (API key or the installed app) and a pipeline; the location comes per consultant. */
  static configured(agency?: GhlAgency | null): boolean {
    return Boolean((process.env.GHL_API_KEY || agency) && (process.env.GHL_PIPELINE_ID || process.env.GHL_PIPELINE_NAME));
  }

  /** A different sub-account; `token` is that sub-account's own private-integration token when one is on file. */
  forLocation(locationId: string, token: string | null = null): GhlCrmAdapter {
    return new GhlCrmAdapter({ ...this.opts, locationId, locationToken: token });
  }

  /**
   * Sub-accounts the agency token can see. Needs GHL_COMPANY_ID (the agency
   * id) unless the scope lists ids explicitly. `scope` entries are sub-account
   * ids or names (case/punctuation-insensitive); it defaults to
   * GHL_LOCATION_IDS. An empty scope means every sub-account.
   */
  static async listLocations(opts: { apiKey?: string | null; agencyToken?: string | null; companyId?: string | null; fetchImpl?: typeof fetch; scope?: string[] } = {}): Promise<{ id: string; name: string | null }[]> {
    const bearer = opts.agencyToken ?? opts.apiKey ?? process.env.GHL_API_KEY;
    const companyId = opts.companyId ?? process.env.GHL_COMPANY_ID;
    const explicit = (opts.scope ?? envScope()).filter(Boolean);
    if (explicit.length && !companyId) return explicit.map((id) => ({ id, name: null }));
    if (!bearer || !companyId) {
      const one = process.env.GHL_LOCATION_ID;
      return one ? [{ id: one, name: null }] : [];
    }
    const f = opts.fetchImpl ?? fetch;
    const out: { id: string; name: string | null }[] = [];
    let skip = 0;
    for (;;) {
      const res = await f(`${API}/locations/search?companyId=${encodeURIComponent(companyId)}&limit=100&skip=${skip}`, {
        headers: { authorization: `Bearer ${bearer}`, version: VERSION, accept: "application/json" },
      });
      if (!res.ok) throw new Error(`ghl locations failed: ${res.status} ${await res.text()}`);
      const json = (await res.json()) as { locations?: { id: string; name?: string }[] };
      const page = json.locations ?? [];
      out.push(...page.map((l) => ({ id: String(l.id), name: l.name ?? null })));
      if (page.length < 100) break;
      skip += 100;
    }
    if (!explicit.length) return out;
    const wanted = new Set(explicit.map(norm));
    return out.filter((l) => wanted.has(norm(l.id)) || (l.name != null && wanted.has(norm(l.name))));
  }

  async upsertOpportunity(input: { externalContactRef?: string; name: string; stage: string; email?: string; phone?: string }): Promise<{ externalRef: string }> {
    if (!this.apiKey || !this.locationId) throw new Error("GHL CRM is not configured");
    const pipeline = await this.loadPipeline();
    const stage = pipeline.stages.find((s) => norm(s.name) === norm(input.stage));
    if (!stage) throw new Error(`GHL pipeline "${pipeline.name}" has no stage named "${input.stage}"`);

    if (input.externalContactRef) {
      const res = await this.fetchImpl(`${API}/opportunities/${input.externalContactRef}`, {
        method: "PUT", headers: await this.headers(), body: JSON.stringify({ pipelineStageId: stage.id, name: input.name }),
      });
      if (!res.ok) throw new Error(`ghl opportunity update failed: ${res.status} ${await res.text()}`);
      return { externalRef: input.externalContactRef };
    }
    const contactId = await this.contactIdFor(input);
    const res = await this.fetchImpl(`${API}/opportunities/`, {
      method: "POST", headers: await this.headers(),
      body: JSON.stringify({ pipelineId: pipeline.id, locationId: this.locationId, name: input.name, pipelineStageId: stage.id, status: "open", contactId }),
    });
    if (!res.ok) throw new Error(`ghl opportunity create failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { opportunity?: { id: string } };
    if (!json.opportunity?.id) throw new Error("ghl opportunity create returned no id");
    return { externalRef: json.opportunity.id };
  }

  /** GHL "Opportunity Stage Changed" webhook → (opportunity id, stage name). */
  parseStageWebhook(payload: unknown): { externalRef: string; stage: string } | null {
    return parseGhlStageWebhook(payload);
  }

  private async contactIdFor(input: { name: string; email?: string; phone?: string }): Promise<string> {
    const [firstName, ...rest] = input.name.split(" ");
    const res = await this.fetchImpl(`${API}/contacts/upsert`, {
      method: "POST", headers: await this.headers(),
      body: JSON.stringify({ locationId: this.locationId, firstName, lastName: rest.join(" ") || undefined, email: input.email, phone: input.phone, source: "Athena" }),
    });
    if (!res.ok) throw new Error(`ghl contact upsert failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { contact?: { id: string } };
    if (!json.contact?.id) throw new Error("ghl contact upsert returned no id");
    return json.contact.id;
  }

  private async loadPipeline(): Promise<Pipeline> {
    if (this.pipeline) return this.pipeline;
    const res = await this.fetchImpl(`${API}/opportunities/pipelines?locationId=${encodeURIComponent(this.locationId!)}`, { headers: await this.headers() });
    if (!res.ok) throw new Error(`ghl pipelines failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { pipelines?: Pipeline[] };
    const found = (json.pipelines ?? []).find((p) => p.id === this.pipelineRef || norm(p.name) === norm(this.pipelineRef ?? ""));
    if (!found) throw new Error(`GHL pipeline "${this.pipelineRef}" not found`);
    this.pipeline = found;
    return found;
  }

  /** Contact details on a sub-account (owner email/phone/timezone), for roster prefill. Tolerant: null when GHL refuses. */
  static async getLocation(locationId: string, opts: { apiKey?: string | null; agencyToken?: string | null; fetchImpl?: typeof fetch } = {}): Promise<{ id: string; name: string | null; email: string | null; phone: string | null; timezone: string | null } | null> {
    const bearer = opts.agencyToken ?? opts.apiKey ?? process.env.GHL_API_KEY;
    if (!bearer) return null;
    const f = opts.fetchImpl ?? fetch;
    const res = await f(`${API}/locations/${encodeURIComponent(locationId)}`, { headers: { authorization: `Bearer ${bearer}`, version: VERSION, accept: "application/json" } });
    if (!res.ok) return null;
    const l = ((await res.json()) as { location?: Record<string, unknown> }).location;
    if (!l) return null;
    return { id: String(l.id ?? locationId), name: str(l.name), email: str(l.email)?.toLowerCase() ?? null, phone: str(l.phone), timezone: str(l.timezone) };
  }

  /** Health check for one sub-account: does the configured pipeline exist there, and what else is available. */
  async checkPipeline(): Promise<{ matched: string | null; available: string[] }> {
    const all = await this.allPipelines();
    const found = all.find((p) => p.id === this.pipelineRef || norm(p.name) === norm(this.pipelineRef ?? ""));
    return { matched: found?.name ?? null, available: all.map((p) => p.name) };
  }

  // ---------------------------------------------------------------- read side (CrmReader)

  /** Reading needs the key and at least one way to find sub-accounts. */
  static readConfigured(agency?: GhlAgency | null): boolean {
    if (agency) return true;
    return Boolean(process.env.GHL_API_KEY && (process.env.GHL_COMPANY_ID || process.env.GHL_LOCATION_IDS || process.env.GHL_LOCATION_ID));
  }

  /**
   * Everything GHL knows about a person: the contact (tags, DND, source,
   * custom fields), every opportunity with its pipeline stage name, the
   * conversation history (last MAX_CONVERSATIONS threads, MAX_MESSAGES each),
   * appointments and notes. Tolerant of partial payloads: a missing section
   * yields an empty list, never a throw, so one flaky endpoint doesn't lose
   * the rest of the record.
   */
  async lookupContact(query: { email?: string | null; phone?: string | null }): Promise<CrmContactHistory | null> {
    if (!this.apiKey || !this.locationId) throw new Error("GHL CRM is not configured");
    const contact = (await this.findContact("email", query.email)) ?? (await this.findContact("phone", query.phone));
    if (!contact) return null;
    const id = String(contact.id);
    const [opps, convos, appts, notes, pipelines] = await Promise.all([
      this.safe(() => this.opportunitiesFor(id), []),
      this.safe(() => this.conversationsFor(id), []),
      this.safe(() => this.appointmentsFor(id), []),
      this.safe(() => this.notesFor(id), []),
      this.safe(() => this.allPipelines(), []),
    ]);
    const stageName = (pipelineId: unknown, stageId: unknown) => {
      const p = pipelines.find((x) => x.id === pipelineId);
      return { pipeline: p?.name ?? null, stage: p?.stages.find((s) => s.id === stageId)?.name ?? null };
    };
    const messages: CrmContactHistory["messages"] = [];
    for (const c of convos.slice(0, MAX_CONVERSATIONS)) {
      const list = await this.safe(() => this.messagesFor(String(c.id)), []);
      for (const m of list) {
        const at = date(m.dateAdded ?? m.createdAt);
        if (!at) continue;
        messages.push({
          ref: String(m.id), channel: channelOf(m), direction: String(m.direction ?? "").toLowerCase() === "inbound" ? "inbound" : "outbound",
          occurredAt: at, subject: str(m.subject), body: str(m.body),
        });
      }
    }
    const customFields: Record<string, unknown> = {};
    for (const f of (contact.customFields ?? []) as { id?: string; key?: string; value?: unknown }[]) {
      const k = f.key ?? f.id;
      if (k) customFields[String(k)] = f.value;
    }
    return {
      locations: [{ id: this.locationId!, name: null }],
      contactRef: id,
      tags: ((contact.tags ?? []) as unknown[]).map(String),
      dnd: Boolean(contact.dnd) || Object.values((contact.dndSettings ?? {}) as Record<string, { status?: string }>).some((s) => s?.status === "active"),
      source: str(contact.source),
      addedAt: date(contact.dateAdded),
      assignedTo: str(contact.assignedTo),
      customFields,
      opportunities: opps.map((o) => ({
        ref: String(o.id), name: str(o.name), ...stageName(o.pipelineId, o.pipelineStageId),
        status: String(o.status ?? "open").toLowerCase(), valueUsd: o.monetaryValue == null ? null : Number(o.monetaryValue),
        createdAt: date(o.createdAt), updatedAt: date(o.lastStageChangeAt ?? o.updatedAt),
      })),
      messages: messages.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime()),
      appointments: appts.flatMap((a) => {
        const s = date(a.startTime);
        return s ? [{ ref: String(a.id), title: str(a.title), startsAt: s, endsAt: date(a.endTime), status: str(a.appointmentStatus ?? a.status) }] : [];
      }),
      notes: notes.flatMap((n) => (n.body ? [{ ref: String(n.id), body: String(n.body), createdAt: date(n.dateAdded) }] : [])),
    };
  }

  private async findContact(field: "email" | "phone", value?: string | null): Promise<Record<string, unknown> | null> {
    const v = value?.trim();
    if (!v) return null;
    const res = await this.fetchImpl(`${API}/contacts/search`, {
      method: "POST", headers: await this.headers(),
      body: JSON.stringify({ locationId: this.locationId, pageLimit: 5, filters: [{ field, operator: "eq", value: field === "email" ? v.toLowerCase() : v }] }),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`ghl contact search failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { contacts?: Record<string, unknown>[] };
    const hits = json.contacts ?? [];
    // An email hit must match exactly; never fall back to "whatever the search returned".
    if (field === "email") return hits.find((c) => String(c.email ?? "").toLowerCase() === v.toLowerCase()) ?? null;
    const digits = v.replace(/\D/g, "").slice(-10);
    return hits.find((c) => String(c.phone ?? "").replace(/\D/g, "").endsWith(digits)) ?? null;
  }
  private async opportunitiesFor(contactId: string) {
    const res = await this.fetchImpl(`${API}/opportunities/search?location_id=${encodeURIComponent(this.locationId!)}&contact_id=${encodeURIComponent(contactId)}&limit=50`, { headers: await this.headers() });
    if (!res.ok) throw new Error(`ghl opportunities failed: ${res.status}`);
    return ((await res.json()) as { opportunities?: Record<string, unknown>[] }).opportunities ?? [];
  }
  private async conversationsFor(contactId: string) {
    const res = await this.fetchImpl(`${API}/conversations/search?locationId=${encodeURIComponent(this.locationId!)}&contactId=${encodeURIComponent(contactId)}&limit=${MAX_CONVERSATIONS}`, { headers: await this.headers() });
    if (!res.ok) throw new Error(`ghl conversations failed: ${res.status}`);
    return ((await res.json()) as { conversations?: Record<string, unknown>[] }).conversations ?? [];
  }
  private async messagesFor(conversationId: string) {
    const res = await this.fetchImpl(`${API}/conversations/${encodeURIComponent(conversationId)}/messages?limit=${MAX_MESSAGES}`, { headers: await this.headers() });
    if (!res.ok) throw new Error(`ghl messages failed: ${res.status}`);
    const json = (await res.json()) as { messages?: { messages?: Record<string, unknown>[] } | Record<string, unknown>[] };
    return Array.isArray(json.messages) ? json.messages : (json.messages?.messages ?? []);
  }
  private async appointmentsFor(contactId: string) {
    const res = await this.fetchImpl(`${API}/contacts/${encodeURIComponent(contactId)}/appointments`, { headers: await this.headers() });
    if (!res.ok) throw new Error(`ghl appointments failed: ${res.status}`);
    return ((await res.json()) as { events?: Record<string, unknown>[] }).events ?? [];
  }
  private async notesFor(contactId: string) {
    const res = await this.fetchImpl(`${API}/contacts/${encodeURIComponent(contactId)}/notes`, { headers: await this.headers() });
    if (!res.ok) throw new Error(`ghl notes failed: ${res.status}`);
    return ((await res.json()) as { notes?: Record<string, unknown>[] }).notes ?? [];
  }
  private allPipelinesCache: Pipeline[] | null = null;
  private async allPipelines(): Promise<Pipeline[]> {
    if (this.allPipelinesCache) return this.allPipelinesCache;
    const res = await this.fetchImpl(`${API}/opportunities/pipelines?locationId=${encodeURIComponent(this.locationId!)}`, { headers: await this.headers() });
    if (!res.ok) throw new Error(`ghl pipelines failed: ${res.status}`);
    this.allPipelinesCache = ((await res.json()) as { pipelines?: Pipeline[] }).pipelines ?? [];
    return this.allPipelinesCache;
  }
  private async safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    try { return await fn(); } catch { return fallback; }
  }

  private async headers() {
    const token = await locationBearer({ apiKey: this.apiKey, agencyToken: this.agencyToken, companyId: this.companyId, locationId: this.locationId!, token: this.locationToken, fetchImpl: this.fetchImpl });
    return { authorization: `Bearer ${token}`, version: VERSION, "content-type": "application/json", accept: "application/json" };
  }
}

const MAX_CONVERSATIONS = 5;
const MAX_MESSAGES = 100;
const str = (v: unknown): string | null => (v == null || v === "" ? null : String(v));
const date = (v: unknown): Date | null => {
  if (v == null) return null;
  const d = new Date(typeof v === "number" ? v : String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};
function channelOf(m: Record<string, unknown>): "email" | "sms" | "call" | "other" {
  const t = String(m.messageType ?? m.type ?? "").toUpperCase();
  if (t.includes("EMAIL")) return "email";
  if (t.includes("SMS") || t.includes("WHATSAPP") || t.includes("FB") || t.includes("IG")) return "sms";
  if (t.includes("CALL") || t.includes("VOICEMAIL")) return "call";
  return "other";
}

export function parseGhlStageWebhook(payload: unknown): { externalRef: string; stage: string } | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const id = String(p.id ?? p.opportunityId ?? p.opportunity_id ?? "").trim();
  const stage = String(p.pipelineStageName ?? p.stageName ?? p.pipleline_stage_name ?? p.stage ?? "").trim();
  if (!id || !stage) return null;
  return { externalRef: id, stage };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const envScope = () => (process.env.GHL_LOCATION_IDS ?? "").split(",").map((x) => x.trim()).filter(Boolean);


/**
 * One CrmReader over every sub-account. FCC runs a sub-account per
 * consultant, so a lead can live in any of them (or several): the lookup
 * fans out and merges. DND anywhere counts; opportunities and messages are
 * kept from every account, tagged with the account name.
 */
export interface ScopeEntry { id: string; token?: string | null }
export interface AgencyLocation { id: string; name: string | null; token?: string | null }

export class GhlAgencyReader implements CrmReader {
  readonly name = "ghl";
  private locations: AgencyLocation[] | null = null;

  constructor(
    private readonly apiKey: string | null | undefined = process.env.GHL_API_KEY,
    private readonly companyId: string | null | undefined = process.env.GHL_COMPANY_ID,
    private readonly fetchImpl: typeof fetch = fetch,
    preset?: AgencyLocation[],
    private readonly agencyToken: string | null = null,
  ) {
    if (preset) this.locations = preset;
  }

  /**
   * A reader over the sub-accounts that matter: GHL_LOCATION_IDS (ids or
   * names) plus whatever the caller adds — normally the active consultants'
   * sub-accounts from the roster. Agencies carry hundreds of sub-accounts;
   * a lookup across all of them per candidate is not viable. When nothing in
   * the scope matches, every sub-account is used and `scope` says so.
   */
  static async scoped(extra: (string | ScopeEntry)[] = [], opts: { apiKey?: string | null; companyId?: string | null; agencyToken?: string | null; fetchImpl?: typeof fetch } = {}): Promise<GhlAgencyReader & { scope: "scoped" | "all"; total: number }> {
    const all = await GhlCrmAdapter.listLocations({ ...opts, scope: [] });
    const entries = extra.map((e) => (typeof e === "string" ? { id: e } : e));
    const tokens = new Map(entries.filter((e) => e.token).map((e) => [norm(e.id), e.token!]));
    const wanted = new Set([...envScope(), ...entries.map((e) => e.id)].map(norm));
    const withTokens = all.map((l) => ({ ...l, token: tokens.get(norm(l.id)) ?? null }));
    const picked = wanted.size ? withTokens.filter((l) => wanted.has(norm(l.id)) || (l.name != null && wanted.has(norm(l.name)))) : [];
    const reader = new GhlAgencyReader(opts.apiKey ?? process.env.GHL_API_KEY, opts.companyId ?? process.env.GHL_COMPANY_ID, opts.fetchImpl, picked.length ? picked : withTokens, opts.agencyToken ?? null);
    return Object.assign(reader, { scope: picked.length ? ("scoped" as const) : ("all" as const), total: all.length });
  }

  async listLocations() {
    if (!this.locations) this.locations = await GhlCrmAdapter.listLocations({ apiKey: this.apiKey, agencyToken: this.agencyToken, companyId: this.companyId, fetchImpl: this.fetchImpl });
    return this.locations;
  }

  async lookupContact(query: { email?: string | null; phone?: string | null }): Promise<CrmContactHistory | null> {
    const locations = await this.listLocations();
    if (!locations.length) throw new Error("GHL: no sub-accounts configured (set GHL_COMPANY_ID, GHL_LOCATION_IDS or GHL_LOCATION_ID)");
    const found: { loc: AgencyLocation; h: CrmContactHistory }[] = [];
    for (const loc of locations) {
      try {
        const h = await new GhlCrmAdapter({ apiKey: this.apiKey, locationId: loc.id, fetchImpl: this.fetchImpl, companyId: this.companyId, locationToken: loc.token ?? null, agencyToken: this.agencyToken }).lookupContact(query);
        if (h) found.push({ loc, h });
      } catch (err) {
        // one broken sub-account must not hide the others
        console.warn(`[ghl] lookup failed in ${loc.name ?? loc.id}: ${String(err)}`);
      }
    }
    if (!found.length) return null;
    return mergeHistories(found.map((f) => ({ ...f.h, locations: [{ id: f.loc.id, name: f.loc.name }] })));
  }
}

/** Pure merge of per-sub-account histories into one record. Exported for tests. */
export function mergeHistories(parts: CrmContactHistory[]): CrmContactHistory {
  const byRecency = [...parts].sort((a, b) => (latest(b) ?? 0) - (latest(a) ?? 0));
  const primary = byRecency[0]!;
  const tagLoc = (locName: string | null, s: string | null) => (locName && s ? `${s} (${locName})` : s);
  return {
    contactRef: parts.map((p) => p.contactRef).join(","),
    tags: [...new Set(parts.flatMap((p) => p.tags))],
    dnd: parts.some((p) => p.dnd),
    source: primary.source ?? parts.find((p) => p.source)?.source ?? null,
    addedAt: parts.map((p) => p.addedAt).filter((d): d is Date => d != null).sort((a, b) => a.getTime() - b.getTime())[0] ?? null,
    assignedTo: primary.assignedTo ?? parts.find((p) => p.assignedTo)?.assignedTo ?? null,
    customFields: Object.assign({}, ...parts.map((p) => p.customFields)),
    opportunities: parts.flatMap((p) => p.opportunities.map((o) => ({ ...o, pipeline: tagLoc(p.locations?.[0]?.name ?? null, o.pipeline) }))),
    messages: dedupe(parts.flatMap((p) => p.messages), (m) => m.ref).sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime()),
    appointments: dedupe(parts.flatMap((p) => p.appointments), (a) => a.ref),
    notes: dedupe(parts.flatMap((p) => p.notes), (n) => n.ref),
    locations: parts.flatMap((p) => p.locations ?? []),
  };
}
const latest = (h: CrmContactHistory): number | null => {
  const ts = [...h.messages.map((m) => m.occurredAt.getTime()), ...h.opportunities.map((o) => o.updatedAt?.getTime() ?? 0)];
  return ts.length ? Math.max(...ts) : null;
};
const dedupe = <T>(xs: T[], key: (x: T) => string): T[] => {
  const seen = new Set<string>();
  return xs.filter((x) => (seen.has(key(x)) ? false : (seen.add(key(x)), true)));
};
