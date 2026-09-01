import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const BAR = "#6366F1"; // single-series histogram: one hue; counts labeled in ink

type Factor = { factor: string; points: number; reason: string };

export default async function ScoresPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: candidates } = await supabase
    .from("candidate")
    .select("id, full_name, primary_email, city, state, current_score")
    .is("merged_into_id", null)
    .not("current_score", "is", null)
    .order("current_score", { ascending: false })
    .limit(2000);

  const scored = candidates ?? [];
  const bins = Array.from({ length: 10 }, (_, i) => ({
    label: i === 9 ? "90–100" : `${i * 10}–${i * 10 + 9}`,
    count: 0,
  }));
  for (const c of scored) {
    bins[Math.min(9, Math.floor((c.current_score as number) / 10))]!.count += 1;
  }
  const maxCount = Math.max(1, ...bins.map((b) => b.count));

  const top = scored.slice(0, 25);
  const { data: snapshots } = top.length
    ? await supabase
        .from("score_snapshot")
        .select("candidate_id, score, factors, created_at")
        .in("candidate_id", top.map((c) => c.id))
        .order("created_at", { ascending: false })
    : { data: [] };
  const latestFactors = new Map<string, Factor[]>();
  for (const s of snapshots ?? []) {
    if (!latestFactors.has(s.candidate_id)) latestFactors.set(s.candidate_id, s.factors as Factor[]);
  }

  return (
    <main className="mx-auto max-w-5xl p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Reactivation scores</h1>
          <p className="mt-1 text-sm text-[#8B95A7]">
            {scored.length} scored candidates · deterministic factors, fully explainable
          </p>
        </div>
      </div>

      <section className="mt-8 rounded-lg border border-[#1E2635] bg-[#121826] p-6">
        <h2 className="text-sm font-semibold text-[#C3CCDB]">Score distribution</h2>
        {scored.length === 0 ? (
          <p className="py-6 text-sm text-[#64748B]">No scored candidates yet. Run scoring after an import.</p>
        ) : (
          <div className="mt-4 grid grid-cols-10 items-end gap-2" style={{ height: 180 }}>
            {bins.map((b) => (
              <div key={b.label} className="flex h-full flex-col items-center justify-end gap-1" title={`${b.label}: ${b.count}`}>
                <span className="text-xs text-[#A9B4C6]" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {b.count > 0 ? b.count : ""}
                </span>
                <div
                  className="w-full rounded-t"
                  style={{
                    background: BAR,
                    height: `${Math.max(b.count > 0 ? 3 : 1, (b.count / maxCount) * 130)}px`,
                    opacity: b.count > 0 ? 1 : 0.15,
                  }}
                />
                <span className="text-[10px] text-[#8B95A7]">{b.label}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-[#C3CCDB]">Top candidates — click a row for the why</h2>
        <div className="mt-2 space-y-1">
          {top.map((c) => (
            <details key={c.id} className="rounded-md border border-[#1E2635] bg-[#121826]">
              <summary className="flex cursor-pointer items-center justify-between px-4 py-2.5 text-sm">
                <span>
                  <span className="font-medium">{c.full_name ?? c.primary_email ?? c.id}</span>
                  <span className="ml-2 text-[#64748B]">
                    {[c.city, c.state].filter(Boolean).join(", ")}
                  </span>
                </span>
                <span className="font-mono text-base font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {c.current_score}
                </span>
              </summary>
              <table className="w-full border-t border-[#1A2130] text-sm">
                <tbody>
                  {(latestFactors.get(c.id) ?? []).map((f) => (
                    <tr key={f.factor} className="border-b border-[#161D2B] last:border-0">
                      <td className="px-4 py-1.5 font-mono text-xs text-[#8B95A7]">{f.factor}</td>
                      <td
                        className={`w-12 px-2 py-1.5 text-right font-mono text-xs ${f.points > 0 ? "text-green-400" : f.points < 0 ? "text-red-400" : "text-[#64748B]"}`}
                        style={{ fontVariantNumeric: "tabular-nums" }}
                      >
                        {f.points > 0 ? `+${f.points}` : f.points}
                      </td>
                      <td className="px-4 py-1.5 text-[#A9B4C6]">{f.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ))}
          {top.length === 0 && <p className="py-4 text-sm text-[#64748B]">Nothing scored yet.</p>}
        </div>
      </section>
    </main>
  );
}
