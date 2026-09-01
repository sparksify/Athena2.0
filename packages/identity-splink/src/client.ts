import type { IdentityResolver } from "@athena/contracts";

/** HTTP client for the Python Splink service in ./service. */
export class SplinkResolver implements IdentityResolver {
  readonly name = "splink";

  constructor(private baseUrl = process.env.SPLINK_URL ?? "http://localhost:8100") {}

  async resolve(records: { id: string; fields: Record<string, unknown> }[]) {
    const res = await fetch(new URL("/resolve", this.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ records: records.map((r) => ({ id: r.id, ...r.fields })) }),
      signal: AbortSignal.timeout(300_000),
    });
    if (!res.ok) throw new Error(`splink service http ${res.status}`);
    const body = (await res.json()) as {
      pairs: { left_id: string; right_id: string; confidence: number }[];
    };
    return body.pairs.map((p) => ({
      leftId: p.left_id,
      rightId: p.right_id,
      confidence: p.confidence,
    }));
  }
}
