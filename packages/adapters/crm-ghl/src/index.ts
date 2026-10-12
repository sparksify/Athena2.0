import type { CrmContactHistory, CrmReader, CrmSyncAdapter } from "@athena/contracts";

const API = "https://services.leadconnectorhq.com";
const VERSION = "2021-07-28";

interface Pipeline { id: string; name: string; stages: { id: string; name: string }[] }

/**
 * GoHighLevel opportunity mirror behind CrmSyncAdapter (ADR 0004: Athena
 * owns stages; GHL displays them). Stage names are the FCC vocabulary and
 * are matched by name inside the configured pipeline.
 * Env: GHL_API_KEY, GHL_LOCATION_ID, GHL_PIPELINE_ID (or GHL_PIPELINE_NAME).
 */
export class GhlCrmAdapter implements CrmSyncAdapter, CrmReader {
  readonly name = "ghl";
  private pipeline: Pipeline | null = null;

  constructor(
    private readonly apiKey = process.env.GHL_API_KEY,
    private readonly locationId = process.env.GHL_LOCATION_ID,
    private readonly pipelineRef = process.env.GHL_PIPELINE_ID ?? process.env.GHL_PIPELINE_NAME,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  static configured(): boolean {
    return Boolean(process.env.GHL_API_KEY && process.env.GHL_LOCATION_ID && (process.env.GHL_PIPELINE_ID || process.env.GHL_PIPELINE_NAME));
  }

  async upsertOpportunity(input: { externalContactRef?: string; name: string; stage: string; email?: string; phone?: string }): Promise<{ externalRef: string }> {
    if (!this.apiKey || !this.locationId) throw new Error("GHL CRM is not configured");
    const pipeline = await this.loadPipeline();
    const stage = pipeline.stages.find((s) => norm(s.name) === norm(input.stage));
    if (!stage) throw new Error(`GHL pipeline "${pipeline.name}" has no stage named "${input.stage}"`);

    if (input.externalContactRef) {
      const res = await this.fetchImpl(`${API}/opportunities/${input.externalContactRef}`, {
        method: "PUT", headers: this.headers(), body: JSON.stringify({ pipelineStageId: stage.id, name: input.name }),
      });
      if (!res.ok) throw new Error(`ghl opportunity update failed: ${res.status} ${await res.text()}`);
      return { externalRef: input.externalContactRef };
    }
    const contactId = await this.contactIdFor(input);
    const res = await this.fetchImpl(`${API}/opportunities/`, {
      method: "POST", headers: this.headers(),
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
      method: "POST", headers: this.headers(),
      body: JSON.stringify({ locationId: this.locationId, firstName, lastName: rest.join(" ") || undefined, email: input.email, phone: input.phone, source: "Athena" }),
    });
    if (!res.ok) throw new Error(`ghl contact upsert failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { contact?: { id: string } };
    if (!json.contact?.id) throw new Error("ghl contact upsert returned no id");
    return json.contact.id;
  }

  private async loadPipeline(): Promise<Pipeline> {
    if (this.pipeline) return this.pipeline;
    const res = await this.fetchImpl(`${API}/opportunities/pipelines?locationId=${encodeURIComponent(this.locationId!)}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`ghl pipelines failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { pipelines?: Pipeline[] };
    const found = (json.pipelines ?? []).find((p) => p.id === this.pipelineRef || norm(p.name) === norm(this.pipelineRef ?? ""));
    if (!found) throw new Error(`GHL pipeline "${this.pipelineRef}" not found`);
    this.pipeline = found;
    return found;
  }

  // ---------------------------------------------------------------- read side (CrmReader)

  /** Reading only needs the key and location; the pipeline is for the mirror. */
  static readConfigured(): boolean {
    return Boolean(process.env.GHL_API_KEY && process.env.GHL_LOCATION_ID);
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
      method: "POST", headers: this.headers(),
      body: JSON.stringify({ locationId: this.locationId, pageLimit: 5, filters: [{ field, operator: "eq", value: field === "email" ? v.toLowerCase() : v }] }),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`ghl contact search failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { contacts?: Record<string, unknown>[] };
    const hits = json.contacts ?? [];
    return hits.find((c) => field === "email" ? String(c.email ?? "").toLowerCase() === v.toLowerCase() : true) ?? hits[0] ?? null;
  }
  private async opportunitiesFor(contactId: string) {
    const res = await this.fetchImpl(`${API}/opportunities/search?location_id=${encodeURIComponent(this.locationId!)}&contact_id=${encodeURIComponent(contactId)}&limit=50`, { headers: this.headers() });
    if (!res.ok) throw new Error(`ghl opportunities failed: ${res.status}`);
    return ((await res.json()) as { opportunities?: Record<string, unknown>[] }).opportunities ?? [];
  }
  private async conversationsFor(contactId: string) {
    const res = await this.fetchImpl(`${API}/conversations/search?locationId=${encodeURIComponent(this.locationId!)}&contactId=${encodeURIComponent(contactId)}&limit=${MAX_CONVERSATIONS}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`ghl conversations failed: ${res.status}`);
    return ((await res.json()) as { conversations?: Record<string, unknown>[] }).conversations ?? [];
  }
  private async messagesFor(conversationId: string) {
    const res = await this.fetchImpl(`${API}/conversations/${encodeURIComponent(conversationId)}/messages?limit=${MAX_MESSAGES}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`ghl messages failed: ${res.status}`);
    const json = (await res.json()) as { messages?: { messages?: Record<string, unknown>[] } | Record<string, unknown>[] };
    return Array.isArray(json.messages) ? json.messages : (json.messages?.messages ?? []);
  }
  private async appointmentsFor(contactId: string) {
    const res = await this.fetchImpl(`${API}/contacts/${encodeURIComponent(contactId)}/appointments`, { headers: this.headers() });
    if (!res.ok) throw new Error(`ghl appointments failed: ${res.status}`);
    return ((await res.json()) as { events?: Record<string, unknown>[] }).events ?? [];
  }
  private async notesFor(contactId: string) {
    const res = await this.fetchImpl(`${API}/contacts/${encodeURIComponent(contactId)}/notes`, { headers: this.headers() });
    if (!res.ok) throw new Error(`ghl notes failed: ${res.status}`);
    return ((await res.json()) as { notes?: Record<string, unknown>[] }).notes ?? [];
  }
  private allPipelinesCache: Pipeline[] | null = null;
  private async allPipelines(): Promise<Pipeline[]> {
    if (this.allPipelinesCache) return this.allPipelinesCache;
    const res = await this.fetchImpl(`${API}/opportunities/pipelines?locationId=${encodeURIComponent(this.locationId!)}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`ghl pipelines failed: ${res.status}`);
    this.allPipelinesCache = ((await res.json()) as { pipelines?: Pipeline[] }).pipelines ?? [];
    return this.allPipelinesCache;
  }
  private async safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    try { return await fn(); } catch { return fallback; }
  }

  private headers() {
    return { authorization: `Bearer ${this.apiKey}`, version: VERSION, "content-type": "application/json", accept: "application/json" };
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
