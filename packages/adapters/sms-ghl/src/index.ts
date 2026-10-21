import type { SmsProvider } from "@athena/contracts";
import { locationBearer, type GhlAgency } from "@athena/crm-ghl";

export interface GhlSmsOptions {
  apiKey?: string | null; locationId?: string | null; fetchImpl?: typeof fetch;
  companyId?: string | null; locationToken?: string | null; agencyToken?: string | null;
}

const API = "https://services.leadconnectorhq.com";
const VERSION = "2021-07-28";

/**
 * GoHighLevel SMS behind SmsProvider (consultant nudges). The contact is
 * upserted by phone so the message threads under the consultant's GHL
 * record. Env: GHL_API_KEY (agency token, exchanged per sub-account when GHL_COMPANY_ID is set), GHL_LOCATION_ID default.
 */
export class GhlSmsProvider implements SmsProvider {
  readonly name = "ghl";
  private readonly apiKey: string | null;
  private readonly locationId: string | null;
  private readonly fetchImpl: typeof fetch;
  private readonly companyId: string | null;
  private readonly locationToken: string | null;
  private readonly agencyToken: string | null;

  constructor(private readonly opts: GhlSmsOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.GHL_API_KEY ?? null;
    this.locationId = opts.locationId ?? process.env.GHL_LOCATION_ID ?? null;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.companyId = opts.companyId ?? process.env.GHL_COMPANY_ID ?? null;
    this.locationToken = opts.locationToken ?? null;
    this.agencyToken = opts.agencyToken ?? null;
  }

  /** Needs a way in (API key or the installed app); the sub-account comes per consultant. */
  static configured(agency?: GhlAgency | null): boolean {
    return Boolean(process.env.GHL_API_KEY || agency);
  }

  forLocation(locationId: string, token: string | null = null): GhlSmsProvider {
    return new GhlSmsProvider({ ...this.opts, locationId, locationToken: token });
  }

  async sendSms(msg: { to: string; body: string }): Promise<{ providerMessageId: string }> {
    if (!this.apiKey || !this.locationId) throw new Error("GHL SMS is not configured");
    const contactId = await this.contactIdFor(msg.to);
    const res = await this.fetchImpl(`${API}/conversations/messages`, {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify({ type: "SMS", contactId, message: msg.body }),
    });
    if (!res.ok) throw new Error(`ghl sms failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { messageId?: string; conversationId?: string };
    return { providerMessageId: json.messageId ?? `${json.conversationId ?? "ghl"}:${Date.now()}` };
  }

  private async contactIdFor(phone: string): Promise<string> {
    const res = await this.fetchImpl(`${API}/contacts/upsert`, {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify({ locationId: this.locationId, phone }),
    });
    if (!res.ok) throw new Error(`ghl contact upsert failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { contact?: { id: string } };
    if (!json.contact?.id) throw new Error("ghl contact upsert returned no id");
    return json.contact.id;
  }

  private async headers() {
    const token = await locationBearer({ apiKey: this.apiKey, agencyToken: this.agencyToken, companyId: this.companyId, locationId: this.locationId!, token: this.locationToken, fetchImpl: this.fetchImpl });
    return { authorization: `Bearer ${token}`, version: VERSION, "content-type": "application/json", accept: "application/json" };
  }
}

/**
 * Tolerant parser for a GHL inbound-message webhook (workflow "Customer
 * Replied" → webhook action, or the InboundMessage event). Returns the
 * sender phone and text, or null when the payload isn't an inbound SMS.
 */
export function parseGhlInboundSms(payload: unknown): { fromPhone: string; text: string } | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const type = String(p.type ?? p.messageType ?? "").toLowerCase();
  const direction = String(p.direction ?? "inbound").toLowerCase();
  if (direction !== "inbound") return null;
  if (type && !type.includes("sms") && !type.includes("inbound") && type !== "message") return null;
  const contact = (p.contact ?? {}) as Record<string, unknown>;
  const fromPhone = String(p.phone ?? p.from ?? contact.phone ?? "").trim();
  const text = String(p.body ?? p.message ?? p.text ?? "").trim();
  if (!fromPhone || !text) return null;
  return { fromPhone, text };
}
