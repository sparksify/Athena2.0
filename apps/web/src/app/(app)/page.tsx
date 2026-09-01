import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;

/* ---------- tiny server-rendered charts (no client JS) ---------- */

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

function TileIcon({ d, color }: { d: string; color: string }) {
  return (
    <span
      className="flex h-7 w-7 items-center justify-center rounded-lg"
      style={{ backgroundColor: `${color}1f` }}
    >
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={d} />
      </svg>
    </span>
  );
}

function Kpi({
  label, value, spark, color, icon, sub, subTone = "muted", dim,
}: {
  label: string;
  value: number | string;
  spark: number[];
  color: string;
  icon: string;
  sub?: string;
  subTone?: "up" | "muted";
  dim?: boolean;
}) {
  return (
    <div className={`rounded-xl border border-[#1E2635] bg-[#121826] p-4 ${dim ? "opacity-55" : ""}`}>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[#64748B]">{label}</div>
          <div className="mt-1 text-2xl font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>
            {value}
          </div>
        </div>
        <TileIcon d={icon} color={color} />
      </div>
      <div className={`mt-0.5 h-4 text-[11px] ${subTone === "up" ? "text-emerald-400" : "text-[#8B95A7]"}`}>
        {sub ?? ""}
      </div>
      <Spark points={spark} color={color} />
    </div>
  );
}

const FUNNEL_COLORS = ["#6366F1", "#818CF8", "#38BDF8", "#22D3EE", "#2DD4BF", "#34D399", "#A3E635", "#F59E0B"];

function FunnelArea({ values }: { values: number[] }) {
  const W = 760;
  const H = 168;
  const padX = 14;
  const top = 16;
  const bottom = H - 10;
  const n = values.length;
  const max = Math.max(1, ...values);
  const xs = values.map((_, i) => padX + (i * (W - 2 * padX)) / (n - 1));
  const ys = values.map((v) => top + (1 - v / max) * (bottom - top));
  let line = `M${xs[0]},${ys[0]}`;
  for (let i = 1; i < n; i++) {
    const mx = ((xs[i - 1]! + xs[i]!) / 2).toFixed(1);
    line += ` C${mx},${ys[i - 1]!.toFixed(1)} ${mx},${ys[i]!.toFixed(1)} ${xs[i]!.toFixed(1)},${ys[i]!.toFixed(1)}`;
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" aria-hidden>
      <defs>
        <linearGradient id="funnelStroke" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#6366F1" />
          <stop offset="45%" stopColor="#22D3EE" />
          <stop offset="75%" stopColor="#34D399" />
          <stop offset="100%" stopColor="#F59E0B" />
        </linearGradient>
        <linearGradient id="funnelFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#22D3EE" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#6366F1" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {xs.map((x, i) => (
        <line key={i} x1={x} y1={8} x2={x} y2={bottom} stroke="#1E2635" strokeWidth={1} strokeDasharray="3 4" />
      ))}
      <path d={`${line} L${xs[n - 1]},${bottom} L${xs[0]},${bottom} Z`} fill="url(#funnelFill)" />
      <path d={line} fill="none" stroke="url(#funnelStroke)" strokeWidth={2.2} />
      {xs.map((x, i) => (
        <g key={`d${i}`}>
          <circle cx={x} cy={ys[i]} r={6.5} fill={FUNNEL_COLORS[i]} opacity={0.18} />
          <circle cx={x} cy={ys[i]} r={3.2} fill={FUNNEL_COLORS[i]} />
        </g>
      ))}
    </svg>
  );
}

function Donut({
  segments, total, label,
}: {
  segments: { name: string; value: number; color: string }[];
  total: number;
  label: string;
}) {
  const r = 52;
  const C = 2 * Math.PI * r;
  const sum = Math.max(1, segments.reduce((a, s) => a + s.value, 0));
  let acc = 0;
  return (
    <svg viewBox="0 0 140 140" className="block h-40 w-40" aria-hidden>
      <circle cx={70} cy={70} r={r} fill="none" stroke="#1B2333" strokeWidth={16} />
      {segments
        .filter((s) => s.value > 0)
        .map((s) => {
          const frac = s.value / sum;
          const len = Math.max(0, frac * C - 3);
          const el = (
            <circle
              key={s.name}
              cx={70}
              cy={70}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={16}
              strokeLinecap="round"
              strokeDasharray={`${len} ${C - len}`}
              strokeDashoffset={-acc * C}
              transform="rotate(-90 70 70)"
            />
          );
          acc += frac;
          return el;
        })}
      <text x={70} y={66} textAnchor="middle" fill="#E7ECF3" fontSize={26} fontWeight={600}>
        {total}
      </text>
      <text x={70} y={84} textAnchor="middle" fill="#64748B" fontSize={9} letterSpacing={1}>
        {label.toUpperCase()}
      </text>
    </svg>
  );
}

/* ---------- data helpers ---------- */

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

const money = (n: number) => (n === 0 ? "$0.00" : n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`);

const scorePill = (s: number | null) =>
  s == null
    ? "bg-[#1B2333] text-[#64748B]"
    : s >= 80
      ? "bg-emerald-500/15 text-emerald-400"
      : s >= 50
        ? "bg-sky-500/15 text-sky-400"
        : s >= 20
          ? "bg-amber-500/15 text-amber-400"
          : s > 0
            ? "bg-[#1B2333] text-[#8B95A7]"
            : "bg-red-500/15 text-red-400";

const AVATAR_GRADIENTS = [
  "from-indigo-500 to-violet-600",
  "from-cyan-500 to-sky-600",
  "from-emerald-500 to-teal-600",
  "from-amber-500 to-orange-600",
  "from-pink-500 to-rose-600",
  "from-violet-500 to-fuchsia-600",
];

const FUNNEL_STAGES = [
  "Contacted", "Replied", "Positive", "Qualified", "Intro sent", "Appointment", "Showed", "Closed",
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
  const cand = () =>
    supabase.from("candidate").select("id", { count: "exact", head: true }).is("merged_into_id", null);

  const [
    evaluated, contacted, replies, positive, qualified, intros, appointments, showed,
    mergesPending, failedJobs,
    hot, warm, engaged, cold, dnc,
    candidatesAll, links, suppressed,
    emailIds, vValid, vRisky, vInvalid,
  ] = await Promise.all([
    c(cand().not("current_score", "is", null)),
    c(supabase.from("interaction").select("id", { count: "exact", head: true }).eq("type", "email_sent")),
    c(supabase.from("interaction").select("id", { count: "exact", head: true }).eq("type", "email_reply")),
    c(cand().eq("status", "interested")),
    c(supabase.from("questionnaire").select("id", { count: "exact", head: true }).eq("kind", "cq_complete")),
    c(cand().eq("status", "introduced")),
    c(supabase.from("interaction").select("id", { count: "exact", head: true }).eq("type", "meeting")),
    c(supabase.from("interaction").select("id", { count: "exact", head: true }).eq("type", "meeting").contains("payload", { outcome: "showed" })),
    c(supabase.from("identity_review").select("id", { count: "exact", head: true }).eq("status", "pending")),
    c(supabase.from("agent_job").select("id", { count: "exact", head: true }).eq("status", "failed")),
    c(cand().gte("current_score", 80)),
    c(cand().gte("current_score", 50).lt("current_score", 80)),
    c(cand().gte("current_score", 20).lt("current_score", 50)),
    c(cand().gt("current_score", 0).lt("current_score", 20)),
    c(cand().eq("current_score", 0)),
    c(supabase.from("candidate").select("id", { count: "exact", head: true })),
    c(supabase.from("candidate_source_link").select("id", { count: "exact", head: true })),
    c(supabase.from("suppression").select("id", { count: "exact", head: true })),
    c(supabase.from("identifier").select("id", { count: "exact", head: true }).eq("type", "email")),
    c(supabase.from("email_verification").select("id", { count: "exact", head: true }).eq("result", "valid")),
    c(supabase.from("email_verification").select("id", { count: "exact", head: true }).eq("result", "risky")),
    c(supabase.from("email_verification").select("id", { count: "exact", head: true }).eq("result", "invalid")),
  ]);

  const [{ data: weekEvents }, { data: topCandidates }, { data: costs }, { data: recentEvents }] =
    await Promise.all([
      supabase.from("event").select("type, created_at").gte("created_at", weekAgo).limit(10_000),
      supabase
        .from("candidate")
        .select("id, full_name, city, state, status, current_score, primary_email")
        .is("merged_into_id", null)
        .not("current_score", "is", null)
        .order("current_score", { ascending: false })
        .limit(6),
      supabase.from("cost_record").select("category, amount_usd").limit(2000),
      supabase.from("event").select("id, type, created_at").order("created_at", { ascending: false }).limit(8),
    ]);

  const byType = (t: string) =>
    dailySeries((weekEvents ?? []).filter((e) => e.type === t).map((e) => new Date(e.created_at)));
  const flat = new Array(7).fill(0);
  const scored7 = (weekEvents ?? []).filter((e) => e.type === "candidate.scored").length;
  const imported7 = (weekEvents ?? []).filter((e) => e.type === "candidate.imported").length;

  const funnelValues = [contacted, replies, positive, qualified, intros, appointments, showed, 0];
  const funnelBase = Math.max(1, contacted);
  const dupes = Math.max(0, links - candidatesAll);
  const unverified = Math.max(0, emailIds - vValid - vRisky - vInvalid);
  const healthPct = emailIds === 0 ? 0 : Math.round((vValid / emailIds) * 100);

  const costTotal = (costs ?? []).reduce((a, r) => a + parseFloat(r.amount_usd ?? "0"), 0);
  const costBy = (cat: string) =>
    (costs ?? []).filter((r) => r.category === cat).reduce((a, r) => a + parseFloat(r.amount_usd ?? "0"), 0);

  const top = topCandidates?.[0];
  const insight = [
    `${evaluated} candidates scored across ${hot + warm} priority prospects`,
    top?.full_name ? `${top.full_name} leads at ${top.current_score}` : null,
    dupes > 0 ? `${dupes} cross-source duplicate${dupes === 1 ? "" : "s"} auto-merged` : null,
    suppressed > 0 ? `${suppressed} contact${suppressed === 1 ? "" : "s"} hard-blocked by suppression` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const donutSegments = [
    { name: "Hot (80+)", value: hot, color: "#34D399" },
    { name: "Warm (50–79)", value: warm, color: "#60A5FA" },
    { name: "Engaged (20–49)", value: engaged, color: "#F59E0B" },
    { name: "Cold (1–19)", value: cold, color: "#475569" },
    { name: "Do not contact", value: dnc, color: "#F87171" },
  ];
  const bandSum = Math.max(1, hot + warm + engaged + cold + dnc);

  const rangeChip = `${new Date(Date.now() - 6 * DAY).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;

  return (
    <main className="mx-auto max-w-[1400px] p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {greeting}, {firstName}.
          </h1>
          <p className="mt-1 text-sm text-[#8B95A7]">Here&apos;s what&apos;s happening with Athena today.</p>
        </div>
        <span className="rounded-lg border border-[#1E2635] bg-[#121826] px-3 py-1.5 text-xs text-[#8B95A7]">
          Last 7 days · {rangeChip}
        </span>
      </div>

      {/* KPI tiles */}
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Kpi label="Evaluated" value={evaluated} spark={byType("candidate.scored")} color="#818CF8"
          icon="M9 11a4 4 0 100-8 4 4 0 000 8zM2 21v-1a7 7 0 0114 0v1M17 8a3 3 0 100-6M22 21v-1a6 6 0 00-4-5.7"
          sub={scored7 > 0 ? `▲ ${scored7} scored this week` : undefined} subTone="up" />
        <Kpi label="Imported" value={candidatesAll} spark={byType("candidate.imported")} color="#22D3EE"
          icon="M12 3v12m0-12L8 7m4-4l4 4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"
          sub={imported7 > 0 ? `▲ ${imported7} new this week` : undefined} subTone="up" />
        <Kpi label="Contacted" value={contacted} spark={flat} color="#38BDF8"
          icon="M4 6h16v12H4zM4 7l8 6 8-6" dim={contacted === 0} />
        <Kpi label="Positive" value={positive} spark={flat} color="#34D399"
          icon="M14 9V5a2 2 0 00-4 0v4H6l1 10h9a2 2 0 002-2v-6a2 2 0 00-2-2h-2z" sub="Phase 6" dim={positive === 0} />
        <Kpi label="Qualified" value={qualified} spark={flat} color="#A78BFA"
          icon="M12 3l2.5 5 5.5.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9L9.5 8z" dim={qualified === 0} />
        <Kpi label="Consultant intros" value={intros} spark={flat} color="#F59E0B"
          icon="M8 12a3 3 0 100-6 3 3 0 000 6zm8 0a3 3 0 100-6 3 3 0 000 6zM2 20v-1a5 5 0 015-5m5 6v-1a5 5 0 0110 0v1" sub="Phase 7" dim={intros === 0} />
        <Kpi label="Appointments" value={appointments} spark={flat} color="#60A5FA"
          icon="M7 3v3m10-3v3M4 8h16M5 5h14a1 1 0 011 1v13a2 2 0 01-2 2H6a2 2 0 01-2-2V6a1 1 0 011-1z"
          sub={showed > 0 ? `${showed} showed` : undefined} dim={appointments === 0} />
        <Kpi label="Projected pipeline" value="—" spark={flat} color="#A78BFA"
          icon="M4 20V10m6 10V4m6 16v-7m4 7H2" sub="Phase 9" dim />
      </div>

      {/* Funnel + score mix */}
      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[2fr_1fr]">
        <section className="rounded-xl border border-[#1E2635] bg-[#121826] p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#8B95A7]">
              Reactivation funnel
            </h2>
            <span className="text-[11px] text-[#64748B]">Conversion by stage</span>
          </div>
          <div className="mt-3 flex items-baseline gap-3">
            <span className="text-3xl font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>
              {evaluated}
            </span>
            <span className="text-xs text-[#8B95A7]">candidates evaluated and eligible</span>
          </div>
          <div className="mt-2">
            <FunnelArea values={funnelValues} />
          </div>
          <div className="grid grid-cols-4 gap-x-2 md:grid-cols-8">
            {FUNNEL_STAGES.map((stage, i) => {
              const n = funnelValues[i]!;
              const pct = contacted === 0 ? 0 : Math.round((n / funnelBase) * 100);
              return (
                <div key={stage} className="text-center">
                  <div className="text-sm font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>{n}</div>
                  <div className="text-[9px] uppercase tracking-wide text-[#64748B]">{stage}</div>
                  <div className="text-[10px] text-[#3D4A5C]" style={{ fontVariantNumeric: "tabular-nums" }}>{pct}%</div>
                </div>
              );
            })}
          </div>
          {contacted === 0 && (
            <p className="mt-3 text-xs text-[#64748B]">
              The funnel fills when outbound goes live (Phase 5). Every number is a live query.
            </p>
          )}
        </section>

        <section className="rounded-xl border border-[#1E2635] bg-[#121826] p-5">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#8B95A7]">Score mix</h2>
          <div className="mt-2 flex items-center gap-4">
            <Donut segments={donutSegments} total={evaluated} label="candidates" />
            <ul className="min-w-0 flex-1 space-y-2 text-xs">
              {donutSegments.map((s) => (
                <li key={s.name} className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2 text-[#C3CCDB]">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                    <span className="truncate">{s.name}</span>
                  </span>
                  <span className="shrink-0 text-[#8B95A7]" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {s.value} · {Math.round((s.value / bandSum) * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-2 border-t border-[#1A2130] pt-3 text-[11px] text-[#64748B]">
            Deterministic score v1 — 11 factors, every score explainable.
          </p>
        </section>
      </div>

      {/* Leaderboard + needs-a-human */}
      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[2fr_1fr]">
        <section className="rounded-xl border border-[#1E2635] bg-[#121826] p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#8B95A7]">Top candidates</h2>
            <span className="text-[11px] text-[#64748B]">Consultant leaderboard arrives in Phase 7</span>
          </div>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-[#64748B]">
                <th className="pb-2 font-semibold">Candidate</th>
                <th className="pb-2 font-semibold">Score</th>
                <th className="pb-2 font-semibold">Status</th>
                <th className="hidden pb-2 font-semibold md:table-cell">Email</th>
                <th className="pb-2 text-right font-semibold">360</th>
              </tr>
            </thead>
            <tbody>
              {(topCandidates ?? []).map((t, i) => (
                <tr key={t.id} className="border-t border-[#1A2130]">
                  <td className="py-2.5">
                    <span className="flex items-center gap-2.5">
                      <span
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-[10px] font-bold text-white ${AVATAR_GRADIENTS[i % AVATAR_GRADIENTS.length]}`}
                      >
                        {(t.full_name ?? "?").split(" ").map((p: string) => p[0]).slice(0, 2).join("")}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[#E7ECF3]">{t.full_name ?? "Unknown"}</span>
                        <span className="block text-[11px] text-[#64748B]">
                          {[t.city, t.state].filter(Boolean).join(", ") || "—"}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="py-2.5">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${scorePill(t.current_score)}`}
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {t.current_score}
                    </span>
                  </td>
                  <td className="py-2.5 capitalize text-[#8B95A7]">{t.status}</td>
                  <td className="hidden max-w-[180px] truncate py-2.5 text-[#8B95A7] md:table-cell">
                    {t.primary_email ?? "—"}
                  </td>
                  <td className="py-2.5 text-right">
                    <a href={`/candidates/${t.id}`} className="text-indigo-400 hover:underline">
                      View →
                    </a>
                  </td>
                </tr>
              ))}
              {(topCandidates ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-sm text-[#64748B]">
                    No scored candidates yet — run an import.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <a href="/candidates" className="mt-2 inline-block text-sm text-indigo-400 underline-offset-4 hover:underline">
            View all candidates →
          </a>
        </section>

        <section className="rounded-xl border border-[#1E2635] bg-[#121826] p-5">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#8B95A7]">Needs a human</h2>
          <ul className="mt-3 space-y-2.5 text-sm">
            {[
              { label: "Drafts awaiting approval", value: null as number | null, tone: "" },
              { label: "Identity merges to review", value: mergesPending, tone: "text-amber-400" },
              { label: "Unverified email addresses", value: unverified, tone: "text-sky-400" },
              { label: "Invalid / risky emails", value: vInvalid + vRisky, tone: "text-amber-400" },
              { label: "Suppressed contacts", value: suppressed, tone: "text-red-400" },
              { label: "Failed agent jobs", value: failedJobs, tone: "text-red-400" },
            ].map((row) => (
              <li key={row.label} className="flex items-center justify-between">
                <span className="text-[#C3CCDB]">{row.label}</span>
                <span
                  className={`font-semibold ${row.value == null ? "text-[#64748B]" : row.value > 0 ? row.tone : "text-[#64748B]"}`}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {row.value ?? "—"}
                </span>
              </li>
            ))}
          </ul>
          <a href="/needs-human" className="mt-4 inline-block text-sm text-indigo-400 underline-offset-4 hover:underline">
            Open the queue →
          </a>
        </section>
      </div>

      {/* Health + economics + activity */}
      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-3">
        <section className="rounded-xl border border-[#1E2635] bg-[#121826] p-5">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#8B95A7]">Contact data health</h2>
          <div className="mt-3 flex items-baseline gap-2">
            <span className={`text-3xl font-semibold ${healthPct >= 60 ? "text-emerald-400" : "text-amber-400"}`} style={{ fontVariantNumeric: "tabular-nums" }}>
              {healthPct}%
            </span>
            <span className="text-xs text-[#8B95A7]">verified valid of {emailIds} emails</span>
          </div>
          <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-[#1B2333]">
            {[
              { v: vValid, color: "#34D399" },
              { v: vRisky, color: "#F59E0B" },
              { v: vInvalid, color: "#F87171" },
              { v: unverified, color: "#334155" },
            ].map((s, i) => (
              <div key={i} style={{ width: `${(s.v / Math.max(1, emailIds)) * 100}%`, backgroundColor: s.color }} />
            ))}
          </div>
          <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] text-[#8B95A7]">
            <li><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-emerald-400" />Valid {vValid}</li>
            <li><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-amber-400" />Risky {vRisky}</li>
            <li><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-red-400" />Invalid {vInvalid}</li>
            <li><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-slate-600" />Unverified {unverified}</li>
          </ul>
          <p className="mt-3 border-t border-[#1A2130] pt-3 text-[11px] text-[#64748B]">
            Sends are gated: never to non-valid addresses.
          </p>
        </section>

        <section className="rounded-xl border border-[#1E2635] bg-[#121826] p-5">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#8B95A7]">Economics (all time)</h2>
          <div className="mt-3 grid grid-cols-3 gap-3">
            {[
              { label: "AI spend", v: costBy("llm") },
              { label: "Verification", v: costBy("verification") },
              { label: "Total", v: costTotal },
            ].map((m) => (
              <div key={m.label}>
                <div className="text-lg font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>{money(m.v)}</div>
                <div className="text-[10px] uppercase tracking-wide text-[#64748B]">{m.label}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-[#1A2130] pt-3">
            <div>
              <div className="text-lg font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>
                {evaluated > 0 ? money(costTotal / evaluated) : "—"}
              </div>
              <div className="text-[10px] uppercase tracking-wide text-[#64748B]">Cost / candidate</div>
            </div>
            <div>
              <div className="text-lg font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>{(costs ?? []).length}</div>
              <div className="text-[10px] uppercase tracking-wide text-[#64748B]">Cost records</div>
            </div>
          </div>
          <p className="mt-3 text-[11px] text-[#64748B]">
            Every AI, enrichment and verification action writes a cost record.
          </p>
        </section>

        <section className="rounded-xl border border-[#1E2635] bg-[#121826] p-5">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#8B95A7]">Live activity</h2>
          <ul className="mt-2 space-y-1 text-xs">
            {(recentEvents ?? []).map((e) => (
              <li key={e.id} className="flex justify-between gap-2 border-b border-[#1A2130] py-1.5 last:border-0">
                <span className="truncate font-mono text-[#A9B4C6]">{e.type}</span>
                <span className="shrink-0 text-[#3D4A5C]">
                  {new Date(e.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </li>
            ))}
            {(recentEvents ?? []).length === 0 && <li className="text-[#64748B]">No events yet.</li>}
          </ul>
          <a href="/ops/jobs" className="mt-3 inline-block text-sm text-indigo-400 underline-offset-4 hover:underline">
            Agent ops →
          </a>
        </section>
      </div>

      {/* Insight banner */}
      <section className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-violet-500/30 bg-gradient-to-r from-indigo-600/25 via-violet-600/20 to-fuchsia-600/15 p-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/25">
            <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="#C4B5FD" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15.5l-1.8-4.7L5.5 9l4.7-1.3zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z" />
            </svg>
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-[#E7ECF3]">Athena insight</div>
            <div className="truncate text-sm text-[#C3CCDB]">{insight}</div>
          </div>
        </div>
        <a
          href="/candidates/scores"
          className="shrink-0 rounded-lg bg-violet-500/25 px-4 py-2 text-sm font-medium text-violet-200 hover:bg-violet-500/35"
        >
          View score analysis →
        </a>
      </section>
    </main>
  );
}
