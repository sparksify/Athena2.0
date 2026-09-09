import { createSign } from "node:crypto";
import type { EmailProvider, OutboundEmail } from "@athena/contracts";

/**
 * Gmail API sender for the coordinator personas (ADR 0005). A Google
 * Workspace service account with domain-wide delegation impersonates the
 * persona address (`mailboxRef`) and sends a plain RFC 2822 message, so
 * every intro/nudge lands as a normal email from a real mailbox.
 *
 * Env: GMAIL_SERVICE_ACCOUNT_JSON — the service-account key JSON (raw or
 * base64), granted https://www.googleapis.com/auth/gmail.send.
 */
export class GmailProvider implements EmailProvider {
  readonly name = "gmail";
  private tokens = new Map<string, { token: string; expiresAt: number }>();
  private key: { client_email: string; private_key: string } | null;

  constructor(serviceAccountJson = process.env.GMAIL_SERVICE_ACCOUNT_JSON, private readonly fetchImpl: typeof fetch = fetch) {
    this.key = serviceAccountJson ? parseKey(serviceAccountJson) : null;
  }

  static configured(): boolean {
    return Boolean(process.env.GMAIL_SERVICE_ACCOUNT_JSON);
  }

  async sendEmail(email: OutboundEmail): Promise<{ providerMessageId: string }> {
    if (!this.key) throw new Error("GMAIL_SERVICE_ACCOUNT_JSON is not configured");
    const token = await this.accessToken(email.mailboxRef);
    const raw = buildMime(email);
    const res = await this.fetchImpl("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ raw }),
    });
    if (!res.ok) throw new Error(`gmail send failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { id: string };
    return { providerMessageId: json.id };
  }

  private async accessToken(subject: string): Promise<string> {
    const cached = this.tokens.get(subject);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const now = Math.floor(Date.now() / 1000);
    const assertion = signJwt(
      { iss: this.key!.client_email, sub: subject, scope: "https://www.googleapis.com/auth/gmail.send", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 },
      this.key!.private_key,
    );
    const res = await this.fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
    });
    if (!res.ok) throw new Error(`gmail token failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.tokens.set(subject, { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 });
    return json.access_token;
  }
}

function parseKey(input: string): { client_email: string; private_key: string } {
  const text = input.trim().startsWith("{") ? input : Buffer.from(input, "base64").toString("utf8");
  const json = JSON.parse(text) as { client_email?: string; private_key?: string };
  if (!json.client_email || !json.private_key) throw new Error("service account JSON needs client_email and private_key");
  return { client_email: json.client_email, private_key: json.private_key };
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function signJwt(claims: Record<string, unknown>, privateKey: string): string {
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(claims));
  const signer = createSign("RSA-SHA256");
  signer.update(`${head}.${body}`);
  return `${head}.${body}.${b64url(signer.sign(privateKey))}`;
}

/** Plain-text RFC 2822 message, base64url as the Gmail API expects. */
export function buildMime(email: OutboundEmail): string {
  const lines = [
    `From: ${email.mailboxRef}`,
    `To: ${email.to}`,
    `Subject: =?UTF-8?B?${Buffer.from(email.subject).toString("base64")}?=`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(email.bodyText).toString("base64"),
  ];
  return b64url(lines.join("\r\n"));
}
