import type { EmailVerificationResult, EmailVerifier } from "@athena/contracts";

// https://developer.millionverifier.com/ — single verification API v3.
// Provider vocabulary maps to Athena's result enum here and nowhere else.
const RESULT_MAP: Record<string, EmailVerificationResult> = {
  ok: "valid",
  invalid: "invalid",
  disposable: "risky",
  catch_all: "risky",
  unknown: "unknown",
  error: "unknown",
};

export class MillionVerifierProvider implements EmailVerifier {
  readonly name = "millionverifier";

  constructor(
    private apiKey = process.env.MILLIONVERIFIER_API_KEY,
    private baseUrl = "https://api.millionverifier.com",
  ) {
    if (!this.apiKey) throw new Error("MILLIONVERIFIER_API_KEY is not set");
  }

  async verify(email: string): Promise<{ result: EmailVerificationResult; raw: unknown }> {
    const url = new URL("/api/v3/", this.baseUrl);
    url.searchParams.set("api", this.apiKey!);
    url.searchParams.set("email", email);
    url.searchParams.set("timeout", "10");

    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`millionverifier http ${res.status}`);
    const raw = (await res.json()) as { result?: string; error?: string };
    if (raw.error) throw new Error(`millionverifier: ${raw.error}`);
    return { result: RESULT_MAP[raw.result ?? "unknown"] ?? "unknown", raw };
  }
}
