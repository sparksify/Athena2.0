import type { SmsProvider } from "@athena/contracts";

const API = "https://services.leadconnectorhq.com";
const VERSION = "2021-07-28";

/**
 * GoHighLevel SMS behind SmsProvider (consultant nudges). The contact is
 * upserted by phone so the message threads under the consultant's GHL
 * record. Env: GHL_API_KEY (private integration token), GHL_LOCATION_ID.
 */
export class GhlSmsProvider implements SmsProvider {
  readonly name = "ghl";
  constructor(
    private readonly apiKey = process.env.GHL_API_KEY,
    private readonly locationId = process.env.GHL_LOCATION_ID,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  static configured(): boolean {
    return Boolean(process.env.GHL_API_KEY && process.env.GHL_LOCATION_ID);
  }

  async sendSms(msg: { to: string; body: string }): Promise<{ providerMessageId: string }> {
    if (!this.apiKey || !this.locationId) throw new Error("GHL SMS is not configured");
    const contactId = await this.contactIdFor(msg.to);
    const res = await this.fetchImpl(`${API}/conversations/messages`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ type: "SMS", contactId, message: msg.body }),
    });
    if (!res.ok) throw new Error(`ghl sms failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { messageId?: string; conversationId?: string };
    return { providerMessageId: json.messageId ?? `${json.conversationId ?? "ghl"}:${Date.now()}` };
  }

  private async contactIdFor(phone: string): Promise<string> {
    const res = await this.fetchImpl(`${API}/contacts/upsert`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ locationId: this.locationId, phone }),
    });
    if (!res.ok) throw new Error(`ghl contact upsert failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { contact?: { id: string } };
    if (!json.contact?.id) throw new Error("ghl contact upsert returned no id");
    return json.contact.id;
  }

  private headers() {
    return { authorization: `Bearer ${this.apiKey}`, version: VERSION, "content-type": "application/json", accept: "application/json" };
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
