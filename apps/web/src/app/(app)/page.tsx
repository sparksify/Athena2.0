import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function Tile({ label, value, dim, hint }: { label: string; value: number | string; dim?: boolean; hint?: string }) {
  return (
    <div className={`rounded-lg border border-zinc-200 bg-white p-4 ${dim ? "opacity-60" : ""}`} title={hint}>
      <div className="text-2xl font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
      <div className="mt-0.5 text-xs text-zinc-500">{label}</div>
    </div>
  );
}

export default async function TodayPage() {
  const supabase = await supabaseServer();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const iso = startOfDay.toISOString();

  const c = (q: PromiseLike<{ count: number | null }>) => q.then((r) => r.count ?? 0);
  const [
    candidates,
    scored,
    hot,
    importedToday,
    validEmails,
    merged,
    pendingReviews,
    contacted,
    replies,
    interested,
    introductions,
    appointments,
    jobsToday,
    failedJobs,
  ] = await Promise.all([
    c(supabase.from("candidate").select("id", { count: "exact", head: true }).is("merged_into_id", null)),
    c(supabase.from("candidate").select("id", { count: "exact", head: true }).is("merged_into_id", null).not("current_score", "is", null)),
    c(supabase.from("candidate").select("id", { count: "exact", head: true }).is("merged_into_id", null).gte("current_score", 80)),
    c(supabase.from("source_record").select("id", { count: "exact", head: true }).gte("imported_at", iso)),
    c(supabase.from("email_verification").select("id", { count: "exact", head: true }).eq("result", "valid")),
    c(supabase.from("identity_review").select("id", { count: "exact", head: true }).eq("status", "merged")),
    c(supabase.from("identity_review").select("id", { count: "exact", head: true }).eq("status", "pending")),
    c(supabase.from("interaction").select("id", { count: "exact", head: true }).eq("type", "email_sent")),
    c(supabase.from("interaction").select("id", { count: "exact", head: true }).eq("type", "email_reply")),
    c(supabase.from("candidate").select("id", { count: "exact", head: true }).eq("status", "interested")),
    c(supabase.from("candidate").select("id", { count: "exact", head: true }).eq("status", "introduced")),
    c(supabase.from("interaction").select("id", { count: "exact", head: true }).eq("type", "meeting")),
    c(supabase.from("agent_job").select("id", { count: "exact", head: true }).gte("created_at", iso)),
    c(supabase.from("agent_job").select("id", { count: "exact", head: true }).eq("status", "failed")),
  ]);

  const { data: recentEvents } = await supabase
    .from("event")
    .select("id, type, entity_type, created_at")
    .order("created_at", { ascending: false })
    .limit(15);

  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-semibold">Today</h1>
      <p className="mt-1 text-sm text-zinc-500">
        {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
      </p>

      <section className="mt-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Candidate intelligence</h2>
        <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
          <Tile label="Candidates" value={candidates} />
          <Tile label="Scored" value={scored} />
          <Tile label="Score ≥ 80" value={hot} />
          <Tile label="Imported today" value={importedToday} />
          <Tile label="Valid emails" value={validEmails} />
          <Tile label="Duplicates merged" value={merged} />
          <Tile label="Pending reviews" value={pendingReviews} />
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Revenue funnel <span className="normal-case text-zinc-400">— fills as outreach phases go live</span>
        </h2>
        <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          <Tile label="Contacted" value={contacted} dim={contacted === 0} hint="interactions of type email_sent" />
          <Tile label="Replies" value={replies} dim={replies === 0} hint="interactions of type email_reply" />
          <Tile label="Interested" value={interested} dim={interested === 0} hint="candidates in status interested" />
          <Tile label="Introductions" value={introductions} dim={introductions === 0} hint="candidates in status introduced" />
          <Tile label="Appointments" value={appointments} dim={appointments === 0} hint="interactions of type meeting" />
        </div>
      </section>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">System</h2>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <Tile label="Agent jobs today" value={jobsToday} />
            <Tile label="Failed jobs (all time)" value={failedJobs} />
          </div>
        </section>
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Latest events</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {(recentEvents ?? []).map((e) => (
              <li key={e.id} className="flex justify-between border-b border-zinc-100 py-1">
                <span className="font-mono text-xs">{e.type}</span>
                <span className="text-xs text-zinc-400">{new Date(e.created_at).toLocaleString()}</span>
              </li>
            ))}
            {(recentEvents ?? []).length === 0 && <li className="text-zinc-400">No events yet.</li>}
          </ul>
        </section>
      </div>
    </main>
  );
}
