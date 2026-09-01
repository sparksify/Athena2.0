import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;

function Spark({ points, color }: { points: number[]; color: string }) {
  const w = 100;
  const h = 26;
  const max = Math.max(1, ...points);
  const step = points.length > 1 ? w / (points.length - 1) : w;
  const y = (v: number) => h - 3 - (v / max) * (h - 8);
  const path = points.map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const lastX = ((points.length - 1) * step).toFixed(1);
  return (
    <svg width={w} height={h} className="mt-2 block" aria-hidden>
      <path d={`${path} L${lastX},${h} L0,${h} Z`} fill={color} opacity={0.12} />
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} />
      <circle cx={lastX} cy={y(points[points.length - 1] ?? 0)} r={2.2} fill={color} />
    </svg>
  );
}

function Kpi({
  label,
  value,
  spark,
  color,
  sub,
  dim,
}: {
  label: string;
  value: number | string;
  spark: number[];
  color: string;
  sub?: string;
  dim?: boolean;
}) {
  return (
    <div className={`rounded-xl border border-[#1E2635] bg-[#121826] p-4 ${dim ? "opacity-55" : ""}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[#64748B]">{label}</div>
      <div className="mt-1 text-2xl font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-[#8B95A7]">{sub}</div>}
      <Spark points={spark} color={color} />
    </div>
  );
}

function dailySeries(dates: Date[], days = 7): number[] {
  const out = new Array<number>(days).fill(0);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  for (const d of dates) {
    const idx = days - 1 - Math.floor((start.getTime() - new Date(d).setHours(0, 0, 0, 0)) / DAY);
    if (idx >= 0 && idx < days) out[idx]! += 1;
  }
  return out;
}

const FUNNEL_STAGES = [
  "Contacted", "Replied", "Positive", "Qualified", "Intro sent",
  "Appointment", "Showed", "Closed",
] as const;

export default async function OverviewPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: me } = user
    ? await supabase.from("user").select("full_name").eq("id", user.id).single()
    : { data: null };
  const firstName =
    me?.full_name?.split(" ")[0] ??
    (user?.email ? user.email.split("@")[0]!.replace(/^\w/, (c) => c.toUpperCase()) : "there");
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const c = (q: PromiseLike<{ count: number | null }>) => q.then((r) => r.count ?? 0);
  const weekAgo = new Date(Date.now() - 7 * DAY).toISOString();

  const [
    evaluated, contacted, replies, positive, qualified, intros, appointments,
    mergesPending, failedJobs, hot,
  ] = await Promise.all([
    c(supabase.from("candidate").select("id", { count: "exact", head: true }).is("merged_into_id", null).not("current_score", "is", null)),
    c(supabase.from("interaction").select("id", { count: "exact", head: true }).eq("type", "email_sent")),
    c(supabase.from("interaction").select("id", { count: "exact", head: true }).eq("type", "email_reply")),
    c(supabase.from("candidate").select("id", { count: "exact", head: true }).eq("status", "interested")),
    c(supabase.from("questionnaire").select("id", { count: "exact", head: true }).eq("kind", "cq_complete")),
    c(supabase.from("candidate").select("id", { count: "exact", head: true }).eq("status", "introduced")),
    c(supabase.from("interaction").select("id", { count: "exact", head: true }).eq("type", "meeting")),
    c(supabase.from("identity_review").select("id", { count: "exact", head: true }).eq("status", "pending")),
    c(supabase.from("agent_job").select("id", { count: "exact", head: true }).eq("status", "failed")),
    c(supabase.from("candidate").select("id", { count: "exact", head: true }).is("merged_into_id", null).gte("current_score", 80)),
  ]);

  const { data: weekEvents } = await supabase
    .from("event")
    .select("type, created_at")
    .gte("created_at", weekAgo)
    .limit(10_000);
  const byType = (t: string) =>
    dailySeries((weekEvents ?? []).filter((e) => e.type === t).map((e) => new Date(e.created_at)));
  const flat = new Array(7).fill(0);

  const funnelCounts: Record<(typeof FUNNEL_STAGES)[number], number> = {
    Contacted: contacted, Replied: replies, Positive: positive, Qualified: qualified,
    "Intro sent": intros, Appointment: appointments, Showed: 0, Closed: 0,
  };
  const funnelBase = Math.max(1, contacted);

  const { data: recentEvents } = await supabase
    .from("event")
    .select("id, type, created_at")
    .order("created_at", { ascending: false })
    .limit(12);

  return (
    <main className="mx-auto max-w-6xl p-8">
      <h1 className="text-2xl font-semibold">
        {greeting}, {firstName}.
      </h1>
      <p className="mt-1 text-sm text-[#8B95A7]">Here&apos;s what&apos;s happening with Athena today.</p>

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Kpi label="Evaluated" value={evaluated} spark={byType("candidate.scored")} color="#818CF8" sub={`${hot} scored ≥ 80`} />
        <Kpi label="Contacted" value={contacted} spark={byType("email.sent")} color="#22D3EE" dim={contacted === 0} />
        <Kpi label="Drafts" value={0} spark={flat} color="#22D3EE" sub="Phase 5" dim />
        <Kpi label="Positive" value={positive} spark={flat} color="#34D399" dim={positive === 0} />
        <Kpi label="Qualified" value={qualified} spark={flat} color="#A78BFA" dim={qualified === 0} />
        <Kpi label="Consultant intros" value={intros} spark={flat} color="#F59E0B" dim={intros === 0} />
        <Kpi label="Appointments" value={appointments} spark={flat} color="#60A5FA" dim={appointments === 0} />
        <Kpi label="Projected pipeline" value="—" spark={flat} color="#A78BFA" sub="Phase 9" dim />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[2fr_1fr]">
        <section className="rounded-xl border border-[#1E2635] bg-[#121826] p-5">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#8B95A7]">
            Reactivation funnel
          </h2>
          <div className="mt-4 grid grid-cols-4 gap-x-4 gap-y-5 md:grid-cols-8">
            {FUNNEL_STAGES.map((stage) => {
              const n = funnelCounts[stage];
              const pct = contacted === 0 ? 0 : Math.round((n / funnelBase) * 100);
              return (
                <div key={stage}>
                  <div className="text-lg font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {n}
                  </div>
                  <div className="mt-1 h-1 rounded-full bg-[#1B2333]">
                    <div
                      className="h-1 rounded-full bg-gradient-to-r from-indigo-500 to-cyan-400"
                      style={{ width: `${Math.max(n > 0 ? 6 : 0, pct)}%` }}
                    />
                  </div>
                  <div className="mt-1 text-[10px] uppercase tracking-wide text-[#64748B]">{stage}</div>
                  <div className="text-[10px] text-[#3D4A5C]" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {contacted === 0 ? "0%" : `${pct}%`}
                  </div>
                </div>
              );
            })}
          </div>
          {contacted === 0 && (
            <p className="mt-4 text-xs text-[#64748B]">
              The funnel fills when outbound goes live (Phase 5). Every number is a live query.
            </p>
          )}
        </section>

        <section className="rounded-xl border border-[#1E2635] bg-[#121826] p-5">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#8B95A7]">Needs a human</h2>
          <ul className="mt-3 space-y-2.5 text-sm">
            <li className="flex items-center justify-between">
              <span className="text-[#C3CCDB]">Drafts awaiting approval</span>
              <span className="font-semibold text-[#64748B]" style={{ fontVariantNumeric: "tabular-nums" }}>—</span>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-[#C3CCDB]">Identity merges to review</span>
              <span className={`font-semibold ${mergesPending > 0 ? "text-amber-400" : ""}`} style={{ fontVariantNumeric: "tabular-nums" }}>
                {mergesPending}
              </span>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-[#C3CCDB]">Failed agent jobs</span>
              <span className={`font-semibold ${failedJobs > 0 ? "text-red-400" : ""}`} style={{ fontVariantNumeric: "tabular-nums" }}>
                {failedJobs}
              </span>
            </li>
          </ul>
          <a href="/needs-human" className="mt-4 inline-block text-sm text-indigo-400 underline-offset-4 hover:underline">
            Open the queue →
          </a>

          <h2 className="mt-6 text-[11px] font-semibold uppercase tracking-wider text-[#8B95A7]">Latest events</h2>
          <ul className="mt-2 space-y-1 text-xs">
            {(recentEvents ?? []).map((e) => (
              <li key={e.id} className="flex justify-between border-b border-[#1A2130] py-1 last:border-0">
                <span className="font-mono text-[#A9B4C6]">{e.type}</span>
                <span className="text-[#3D4A5C]">{new Date(e.created_at).toLocaleTimeString()}</span>
              </li>
            ))}
            {(recentEvents ?? []).length === 0 && <li className="text-[#64748B]">No events yet.</li>}
          </ul>
        </section>
      </div>

      <section className="mt-6 rounded-xl border border-[#1E2635] bg-[#121826] p-5">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#8B95A7]">
          Consultant performance
        </h2>
        <p className="mt-3 text-sm text-[#64748B]">
          No consultants yet — routing and accountability arrive with Phase 7. This panel will show
          contacted, accept rate, first-contact time, show rate, and revenue per consultant.
        </p>
      </section>
    </main>
  );
}
