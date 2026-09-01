import { notFound, redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Factor = { factor: string; points: number; reason: string };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export default async function Candidate360({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: candidate } = await supabase
    .from("candidate")
    .select("*")
    .eq("id", id)
    .single();
  if (!candidate) notFound();

  const [
    { data: snapshots },
    { data: identifiers },
    { data: attributes },
    { data: financials },
    { data: questionnaires },
    { data: interactions },
    { data: links },
    { data: events },
  ] = await Promise.all([
    supabase.from("score_snapshot").select("score, version, factors, created_at").eq("candidate_id", id).order("created_at", { ascending: false }).limit(1),
    supabase.from("identifier").select("type, value_normalized, email_verification(result, checked_at)").eq("candidate_id", id),
    supabase.from("candidate_attribute").select("key, value, confidence, created_at").eq("candidate_id", id).is("superseded_by_id", null),
    supabase.from("financial_profile").select("liquidity_usd, net_worth_usd, investable_usd").eq("candidate_id", id),
    supabase.from("questionnaire").select("kind, completed_at").eq("candidate_id", id),
    supabase.from("interaction").select("type, direction, occurred_at, payload").eq("candidate_id", id).order("occurred_at", { ascending: false }).limit(50),
    supabase.from("candidate_source_link").select("method, confidence, source_record(source_type, imported_at, source_batch_id)").eq("candidate_id", id),
    supabase.from("event").select("type, created_at").eq("entity_id", id).order("created_at", { ascending: false }).limit(25),
  ]);

  const snapshot = snapshots?.[0];
  const factors = (snapshot?.factors ?? []) as Factor[];
  const fin = financials?.[0]; // absent entirely for consultant role (RLS)
  const money = (v: unknown) => (v == null ? "—" : `$${Math.round(Number(v) / 1000)}k`);

  const nextAction =
    candidate.status !== "new" && candidate.status !== "scored"
      ? `in flight — status ${candidate.status}`
      : (candidate.current_score ?? 0) >= 80
        ? "strong reactivation candidate — queue for outreach when Phase 5 goes live"
        : (candidate.current_score ?? 0) >= 60
          ? "worth outreach in a later cohort"
          : "hold — low score; revisit after enrichment or new signals";

  return (
    <main className="mx-auto max-w-5xl p-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{candidate.full_name ?? "Unnamed candidate"}</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {[candidate.primary_email, candidate.primary_phone, [candidate.city, candidate.state].filter(Boolean).join(", ")]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="text-right">
          <div className="text-4xl font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>
            {candidate.current_score ?? "—"}
          </div>
          <div className="text-xs text-zinc-500">reactivation score</div>
          <span className="mt-1 inline-block rounded-full bg-zinc-100 px-2 py-0.5 font-mono text-xs">
            {candidate.status}
          </span>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="Why we care">
          {factors.length === 0 ? (
            <p className="text-sm text-zinc-400">Not scored yet.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {factors.map((f) => (
                  <tr key={f.factor} className="border-b border-zinc-50 last:border-0">
                    <td className="py-1 pr-2 font-mono text-xs text-zinc-500">{f.factor}</td>
                    <td className={`w-10 py-1 text-right font-mono text-xs ${f.points > 0 ? "text-green-700" : f.points < 0 ? "text-red-700" : "text-zinc-400"}`}
                        style={{ fontVariantNumeric: "tabular-nums" }}>
                      {f.points > 0 ? `+${f.points}` : f.points}
                    </td>
                    <td className="py-1 pl-3 text-zinc-600">{f.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="What we know">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {fin && (
              <>
                <dt className="text-zinc-500">Liquidity</dt>
                <dd className="font-mono">{money(fin.liquidity_usd)}</dd>
                <dt className="text-zinc-500">Net worth</dt>
                <dd className="font-mono">{money(fin.net_worth_usd)}</dd>
              </>
            )}
            <dt className="text-zinc-500">Questionnaire</dt>
            <dd>{questionnaires?.length ? questionnaires.map((q) => q.kind).join(", ") : "none"}</dd>
            {(identifiers ?? []).map((i, idx) => {
              const ver = (i.email_verification as { result: string }[] | null)?.[0];
              return (
                <div key={idx} className="col-span-2 flex justify-between border-t border-zinc-50 pt-1">
                  <span className="font-mono text-xs">{i.value_normalized}</span>
                  <span className="text-xs text-zinc-500">
                    {i.type}{ver ? ` · ${ver.result}` : i.type === "email" ? " · unverified" : ""}
                  </span>
                </div>
              );
            })}
            {(attributes ?? []).map((a) => (
              <div key={a.key} className="col-span-2 flex justify-between border-t border-zinc-50 pt-1">
                <span className="text-zinc-500">{a.key}</span>
                <span className="max-w-64 truncate text-right">{JSON.stringify(a.value)}</span>
              </div>
            ))}
          </dl>
        </Section>

        <Section title="What happened">
          {(interactions ?? []).length === 0 && (links ?? []).length === 0 ? (
            <p className="text-sm text-zinc-400">No history yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {(interactions ?? []).map((i, idx) => (
                <li key={idx} className="flex justify-between border-b border-zinc-50 py-1 last:border-0">
                  <span className="font-mono text-xs">{i.direction === "inbound" ? "←" : "→"} {i.type}</span>
                  <span className="text-xs text-zinc-400">{new Date(i.occurred_at).toLocaleDateString()}</span>
                </li>
              ))}
              {(links ?? []).map((l, idx) => {
                const raw = l.source_record as unknown;
                const sr = (Array.isArray(raw) ? raw[0] : raw) as
                  | { source_type: string; imported_at: string }
                  | null;
                return (
                  <li key={`s${idx}`} className="flex justify-between border-b border-zinc-50 py-1 last:border-0">
                    <span className="text-zinc-600">
                      source record: <span className="font-mono text-xs">{sr?.source_type}</span>
                      <span className="ml-1 text-xs text-zinc-400">({l.method}, {Number(l.confidence).toFixed(2)})</span>
                    </span>
                    <span className="text-xs text-zinc-400">
                      {sr ? new Date(sr.imported_at).toLocaleDateString() : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section title="What happens next">
          <p className="text-sm">{nextAction}</p>
          <p className="mt-2 text-xs text-zinc-400">
            AI research notes and outreach recommendations arrive with Phase 5.
          </p>
          <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-zinc-500">Recent events</h3>
          <ul className="mt-1 space-y-0.5 text-xs">
            {(events ?? []).map((e, idx) => (
              <li key={idx} className="flex justify-between py-0.5">
                <span className="font-mono">{e.type}</span>
                <span className="text-zinc-400">{new Date(e.created_at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </main>
  );
}
