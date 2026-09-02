import { createHmac, timingSafeEqual } from "node:crypto";
import type { EmailProvider, OutboundEmail } from "@athena/contracts";

/**
 * Smartlead behind the EmailProvider contract.
 *
 * Sending model: Smartlead is campaign-centric, but per-lead fully-custom
 * content is supported by pushing each recipient as a lead with
 * custom_subject / custom_email_message fields into a designated API
 * campaign whose sequence renders exactly those fields. mailboxRef selects
 * the sending account (Smartlead email_account id). Endpoints are exercised
 * against the live API the moment an API key exists; the shapes here follow
 * their published v1 REST API and MUST be smoke-tested then (fallback per
 * ADR 0005 review: Instantly adapter, same contract).
 */
export class SmartleadProvider implements EmailProvider {
  readonly name = "smartlead";
  private apiKey: string;
  private baseUrl: string;
  private campaignId: string;

  constructor(opts?: { apiKey?: string; baseUrl?: string; campaignId?: string }) {
    this.apiKey = opts?.apiKey ?? process.env.SMARTLEAD_API_KEY ?? "";
    this.baseUrl = opts?.baseUrl ?? process.env.SMARTLEAD_BASE_URL ?? "https://server.smartlead.ai/api/v1";
    this.campaignId = opts?.campaignId ?? process.env.SMARTLEAD_API_CAMPAIGN_ID ?? "";
    if (!this.apiKey) throw new Error("SMARTLEAD_API_KEY is not set");
    if (!this.campaignId) throw new Error("SMARTLEAD_API_CAMPAIGN_ID is not set");
  }

  async sendEmail(email: OutboundEmail): Promise<{ providerMessageId: string }> {
    const res = await fetch(
      `${this.baseUrl}/campaigns/${this.campaignId}/leads?api_key=${this.apiKey}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lead_list: [
            {
              email: email.to,
              custom_fields: {
                custom_subject: email.subject,
                custom_email_message: email.bodyText,
              },
            },
          ],
          settings: { email_account_id: email.mailboxRef, ignore_global_block_list: false },
        }),
      },
    );
    if (!res.ok) {
      throw new Error(`smartlead send failed: ${res.status} ${await res.text().catch(() => "")}`);
    }
    const body = (await res.json()) as { upload_count?: number; lead_ids?: (string | number)[] };
    const leadId = body.lead_ids?.[0];
    // The campaign/lead pair is the stable reference until the SENT webhook
    // delivers the message id; both are recorded so the webhook can join.
    return { providerMessageId: `sl-${this.campaignId}-${leadId ?? `${email.to}-${Date.now()}`}` };
  }
}

/** Normalized shape handed to core's handleEmailWebhook. */
export interface SmartleadNormalizedEvent {
  kind: "reply" | "bounce" | "complaint" | "unsubscribe";
  provider: "smartlead";
  providerMessageId: string;
  email: string;
  subject?: string;
  bodyText?: string;
  occurredAt: Date;
  raw: unknown;
}

const EVENT_MAP: Record<string, SmartleadNormalizedEvent["kind"]> = {
  EMAIL_REPLY: "reply",
  EMAIL_BOUNCE: "bounce",
  LEAD_UNSUBSCRIBED: "unsubscribe",
  EMAIL_SPAM_COMPLAINT: "complaint",
};

/** Verify Smartlead's HMAC-SHA256 webhook signature (X-Smartlead-Signature). */
export function verifySmartleadSignature(rawBody: string, signature: string, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature.trim().toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Translate a Smartlead webhook payload; null for event types Athena ignores. */
export function parseSmartleadWebhook(payload: unknown): SmartleadNormalizedEvent | null {
  const p = payload as {
    event_type?: string;
    to_email?: string;
    lead_email?: string;
    sl_email_lead_id?: string | number;
    message_id?: string;
    reply_message?: { message_id?: string; text?: string };
    subject?: string;
    reply_body?: string;
    event_timestamp?: string;
    time_replied?: string;
  } | null;
  if (!p?.event_type) return null;
  const kind = EVENT_MAP[p.event_type];
  if (!kind) return null;
  const email = (p.lead_email ?? p.to_email ?? "").trim().toLowerCase();
  if (!email) return null;
  const providerMessageId =
    p.reply_message?.message_id ?? p.message_id ?? `sl-${p.event_type}-${p.sl_email_lead_id ?? email}`;
  const ts = p.event_timestamp ?? p.time_replied;
  return {
    kind,
    provider: "smartlead",
    providerMessageId: String(providerMessageId),
    email,
    subject: p.subject,
    bodyText: p.reply_message?.text ?? p.reply_body,
    occurredAt: ts ? new Date(ts) : new Date(),
    raw: payload,
  };
}
