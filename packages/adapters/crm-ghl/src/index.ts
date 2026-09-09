import type { CrmSyncAdapter } from "@athena/contracts";

const API = "https://services.leadconnectorhq.com";
const VERSION = "2021-07-28";

interface Pipeline { id: string; name: string; stages: { id: string; name: string }[] }

/**
 * GoHighLevel opportunity mirror behind CrmSyncAdapter (ADR 0004: Athena
 * owns stages; GHL displays them). Stage names are the FCC vocabulary and
 * are matched by name inside the configured pipeline.
 * Env: GHL_API_KEY, GHL_LOCATION_ID, GHL_PIPELINE_ID (or GHL_PIPELINE_NAME).
 */
export class GhlCrmAdapter implements CrmSyncAdapter {
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

  private headers() {
    return { authorization: `Bearer ${this.apiKey}`, version: VERSION, "content-type": "application/json", accept: "application/json" };
  }
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
