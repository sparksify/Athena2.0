import { supabaseServer } from "@/lib/supabase/server";
import { ReviewButtons } from "./review-buttons";

export const dynamic = "force-dynamic";
export const metadata = { title: "Outreach — Athena" };

const STATUS_ORDER = ["draft", "approved", "scheduled", "sent", "blocked", "rejected"] as const;
const STATUS_TONE: Record<string, string> = {
  draft: "bg-amber-500/15 text-amber-400",
  approved: "bg-sky-500/15 text-sky-400",
  scheduled: "bg-indigo-500/15 text-indigo-300",
  sent: "bg-emerald-500/15 text-emerald-400",
  blocked: "bg-red-500/15 text-red-400",
  rejected: "bg-[#1B2333] text-[#64748B]",
};

export default async function OutreachPage() {
  const supabase = await supabaseServer();

  const [{ data: pendingDrafts }, { data: recent }, { data: statusRows }, { count: suppressions }] =
    await Promise.all([
      supabase
        .from("outreach_draft")
        .select(
          "id, subject, body_text, cited_attribute_ids, created_at, candidate(full_name, primary_email), angle(name), campaign(name)",
        )
        .eq("status", "draft")
        .order("created_at", { ascending: true })
        .limit(25),
      supabase
        .from("outreach_draft")
        .select("id, subject, status, blocked_reason, created_at, candidate(full_name)")
        .neq("status", "draft")
        .order("created_at", { ascending: false })
        .limit(15),
      supabase.from("outreach_draft").select("status"),
      supabase.from("suppression").select("id", { count: "exact", head: true }),
    ]);

  const counts = new Map<string, number>();
  for (const r of statusRows ?? []) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

  return (
    <main className="mx-auto max-w-6xl p-8">
      <h1 className="text-2xl font-semibold">Outreach</h1>
      <p className="mt-1 text-sm text-[#8B95A7]">
        Every email is AI-drafted from provenance-backed facts and sent only after a human approves
        it. Suppression and verification gates run in code on every send.
      </p>

      <div className="mt-6 grid grid-cols-3 gap-3 md:grid-cols-7">
        {STATUS_ORDER.map((s) => (
          <div key={s} className="rounded-xl border border-[#1E2635] bg-[#121826] p-3">
            <div className="text-xl font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>
              {counts.get(s) ?? 0}
            </div>
            <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_TONE[s]}`}>
              {s}
            </span>
          </div>
        ))}
        <div className="rounded-xl border border-[#1E2635] bg-[#121826] p-3">
          <div className="text-xl font-semibold text-red-400" style={{ fontVariantNumeric: "tabular-nums" }}>
            {suppressions ?? 0}
          </div>
          <span className="mt-1 inline-block rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-400">
            Suppressed
          </span>
        </div>
      </div>

      <section className="mt-6 rounded-xl border border-[#1E2635] bg-[#121826] p-5">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#8B95A7]">
          Approval queue — {pendingDrafts?.length ?? 0} awaiting review
        </h2>
        <div className="mt-3 space-y-4">
          {(pendingDrafts ?? []).map((d) => {
            const cand = one(d.candidate);
            const ang = one(d.angle);
            const camp = one(d.campaign);
            return (
              <article key={d.id} className="rounded-lg border border-[#1E2635] bg-[#0F1522] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-[#E7ECF3]">
                      {cand?.full_name ?? "Unknown"}{" "}
                      <span className="text-[#64748B]">&lt;{cand?.primary_email}&gt;</span>
                    </div>
                    <div className="text-[11px] text-[#64748B]">
                      {camp?.name} · angle: {ang?.name} · cites {(d.cited_attribute_ids ?? []).length} fact
                      {(d.cited_attribute_ids ?? []).length === 1 ? "" : "s"} on record
                    </div>
                  </div>
                  <ReviewButtons draftId={d.id} />
                </div>
                <div className="mt-3 border-t border-[#1A2130] pt-3">
                  <div className="text-sm font-medium text-[#C3CCDB]">{d.subject}</div>
                  <pre className="mt-1.5 whitespace-pre-wrap font-sans text-sm leading-relaxed text-[#A9B4C6]">
                    {d.body_text}
                  </pre>
                </div>
              </article>
            );
          })}
          {(pendingDrafts ?? []).length === 0 && (
            <p className="text-sm text-[#64748B]">
              Nothing awaiting approval. Drafts appear here when a campaign drafting job runs.
            </p>
          )}
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-[#1E2635] bg-[#121826] p-5">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#8B95A7]">Recent activity</h2>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-[#64748B]">
              <th className="pb-2 font-semibold">Candidate</th>
              <th className="pb-2 font-semibold">Subject</th>
              <th className="pb-2 font-semibold">Status</th>
              <th className="pb-2 font-semibold">Reason</th>
            </tr>
          </thead>
          <tbody>
            {(recent ?? []).map((r) => (
              <tr key={r.id} className="border-t border-[#1A2130]">
                <td className="py-2 text-[#C3CCDB]">{one(r.candidate)?.full_name ?? "—"}</td>
                <td className="max-w-[280px] truncate py-2 text-[#8B95A7]">{r.subject}</td>
                <td className="py-2">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[r.status] ?? ""}`}>
                    {r.status}
                  </span>
                </td>
                <td className="py-2 text-xs text-[#64748B]">{r.blocked_reason ?? "—"}</td>
              </tr>
            ))}
            {(recent ?? []).length === 0 && (
              <tr>
                <td colSpan={4} className="py-3 text-sm text-[#64748B]">No sends yet — Phase 5 goes live once Smartlead and the Athena 1.0 suppression import are in.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}
