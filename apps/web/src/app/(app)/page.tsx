import type { ReactNode } from "react";

import { supabaseServer } from "@/lib/supabase/server";
import { PersonAvatar } from "@/components/agent-avatar";
import { CONSULTANTS, KPIS, OVERVIEW_KPIS, UPCOMING_CONSULTS } from "./consultants/demo-data";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;

/* ---------- tiny server-rendered charts (no client JS) ---------- */

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

/* ---------- overview hero (mockup 2026-09-02) ---------- */

const OV_CARD = "rounded-2xl border border-white/[0.07] bg-[#111726]";

function OvIcon({ size = 16, stroke = 1.8, children }: { size?: number; stroke?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden
    >
      {children}
    </svg>
  );
}

const OV = {
  dollar: (
    <>
      <path d="M12 2v20" />
      <path d="M17 6.5H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H6" />
    </>
  ),
  users: (
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  chat: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  group: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M15.5 15.5a5 5 0 0 1 6 4.5" />
    </>
  ),
  gauge: (
    <>
      <path d="m12 14 4-4" />
      <path d="M3.34 19a10 10 0 1 1 17.32 0" />
    </>
  ),
  doc: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M9 13h6M9 17h6" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </>
  ),
  check: <path d="m5 12 5 5L20 7" />,
  alert: (
    <>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
  mail: (
    <>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-10 7L2 7" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </>
  ),
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
} as const;

function OvTile({ color, size = 56, children }: { color: string; size?: number; children: ReactNode }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-xl border"
      style={{ width: size, height: size, color, borderColor: `${color}59`, backgroundColor: `${color}14` }}
    >
      <OvIcon size={Math.round(size * 0.42)}>{children}</OvIcon>
    </span>
  );
}

const MEDAL = [
  { ring: "#F59E0B", fill: "linear-gradient(180deg, #FCD34D, #D97706)", text: "#78350F" },
  { ring: "#9CA3AF", fill: "linear-gradient(180deg, #E5E7EB, #6B7280)", text: "#1F2937" },
  { ring: "#F97316", fill: "linear-gradient(180deg, #FDBA74, #C2410C)", text: "#431407" },
] as const;

function Medal({ rank }: { rank: number }) {
  const m = MEDAL[rank - 1] ?? MEDAL[2];
  return (
    <span className="relative flex h-9 w-9 shrink-0 items-start justify-center">
      <span
        className="absolute bottom-0 left-1/2 h-4 w-2 -translate-x-[6px] rotate-[18deg] rounded-sm"
        style={{ backgroundColor: m.ring, opacity: 0.85 }}
      />
      <span
        className="absolute bottom-0 left-1/2 h-4 w-2 -translate-x-[2px] -rotate-[18deg] rounded-sm"
        style={{ backgroundColor: m.ring, opacity: 0.85 }}
      />
      <span
        className="relative flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-bold"
        style={{ background: m.fill, color: m.text, boxShadow: `0 0 0 2px #111726, 0 0 0 3px ${m.ring}66`, fontVariantNumeric: "tabular-nums" }}
      >
        {rank}
      </span>
    </span>
  );
}

const JOURNEY = [
  { label: "Assigned", value: null, color: "#818CF8", icon: OV.doc },
  { label: "First touch", value: KPIS.medianFirstTouch, color: "#2DD4BF", icon: OV.chat },
  { label: "Appointment", value: "—", color: "#F59E0B", icon: OV.calendar },
  { label: "Consult held", value: KPIS.speedToConsult, color: "#60A5FA", icon: OV.check },
] as const;

const SNAPSHOT_GRID = "grid grid-cols-[1.6fr_1fr_1fr_1fr_1fr_1.4fr_1fr] items-center";

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

  const scored7 = (weekEvents ?? []).filter((e) => e.type === "candidate.scored").length;

  // Consultant figures share the Consultants page fixtures until Phase 7 wires live queries.
  const topConsultants = [...CONSULTANTS]
    .sort((a, b) => b.consultsThisWeek - a.consultsThisWeek || b.showRate - a.showRate)
    .slice(0, 3);
  const breachConsultant = CONSULTANTS.find((c) => c.sla === "take_back") ?? CONSULTANTS[CONSULTANTS.length - 1]!;
  const snapshot = [...topConsultants, breachConsultant];
  const missingCq = UPCOMING_CONSULTS.filter((c) => c.cq === "missing").length;

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
      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-indigo-400">Athena overview</div>
          <h1 className="mt-1 text-[34px] font-semibold leading-tight tracking-tight text-white">
            {greeting}, {firstName}.
          </h1>
          <p className="mt-1.5 text-sm text-[#8B95A7]">
            Pipeline velocity, consultant performance, and the actions that need attention.
          </p>
        </div>
        <span className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-[#121826] px-3.5 py-2 text-sm text-[#C3CCDB]">
          <span className="text-[#8B95A7]"><OvIcon size={15}>{OV.calendar}</OvIcon></span>
          Last 7 days · {rangeChip}
          <span className="text-[#8B95A7]"><OvIcon size={14}>{OV.chevronDown}</OvIcon></span>
        </span>
      </div>

      {/* KPI cards */}
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Open pipeline value", value: `$${OVERVIEW_KPIS.pipelineValue.toLocaleString()}`, sub: `Across ${OVERVIEW_KPIS.openOpportunities} open CRM opportunities`, subColor: "#8B95A7", color: "#818CF8", icon: OV.dollar },
          { label: "New candidates", value: String(candidatesAll), sub: `+${scored7} evaluated this week`, subColor: "#2DD4BF", color: "#2DD4BF", icon: OV.users },
          { label: "Buyer-positive replies", value: String(OVERVIEW_KPIS.positiveReplies), sub: "Inception positive reply volume", subColor: "#8B95A7", color: "#34D399", icon: OV.chat },
          { label: "Consultant handoffs", value: String(OVERVIEW_KPIS.consultantHandoffs), sub: "Introductions in selected range", subColor: "#8B95A7", color: "#F59E0B", icon: OV.group },
        ].map((k) => (
          <div key={k.label} className={`${OV_CARD} flex items-center gap-4 p-5`}>
            <OvTile color={k.color}>{k.icon}</OvTile>
            <div className="min-w-0">
              <div className="truncate text-[11px] font-semibold uppercase tracking-[0.16em] text-[#94A0B8]">{k.label}</div>
              <div className="mt-0.5 text-[40px] font-semibold leading-none tracking-tight text-white" style={{ fontVariantNumeric: "tabular-nums" }}>
                {k.value}
              </div>
              <div className="mt-2 truncate text-[13px]" style={{ color: k.subColor }}>{k.sub}</div>
            </div>
          </div>
        ))}
      </div>

      {/* velocity + top consultants + needs intervention */}
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.55fr_0.95fr_1fr]">
        <section className={`${OV_CARD} p-5`}>
          <div className="flex items-center gap-3">
            <OvTile color="#60A5FA" size={34}>{OV.gauge}</OvTile>
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.18em] text-[#C3CCDB]">Pipeline velocity</h2>
          </div>
          <div className="mt-4 grid grid-cols-3 divide-x divide-white/[0.08] text-center">
            <div className="px-2">
              <div className="text-[13px] text-[#C3CCDB]">Median first touch</div>
              <div className="mt-2 text-[40px] font-semibold leading-none text-sky-300" style={{ fontVariantNumeric: "tabular-nums" }}>{KPIS.medianFirstTouch}</div>
            </div>
            <div className="px-2">
              <div className="text-[13px] leading-snug text-[#C3CCDB]">Median assignment →<br />consult held</div>
              <div className="mt-2 text-[40px] font-semibold leading-none text-sky-300" style={{ fontVariantNumeric: "tabular-nums" }}>{KPIS.speedToConsult}</div>
            </div>
            <div className="px-2">
              <div className="text-[13px] text-[#C3CCDB]">Time to first appointment</div>
              <div className="mt-2 text-[40px] font-semibold leading-none text-[#64748B]">—</div>
              <span className="mt-2 inline-block rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-amber-300">
                Tracking required
              </span>
            </div>
          </div>
          <div className="mt-6 flex items-start">
            {JOURNEY.map((j, i) => (
              <div key={j.label} className="flex flex-1 items-start">
                <div className="flex w-full flex-col items-center text-center">
                  <span
                    className="flex h-11 w-11 items-center justify-center rounded-full border-2"
                    style={{ borderColor: j.color, color: j.color, backgroundColor: `${j.color}12` }}
                  >
                    <OvIcon size={18}>{j.icon}</OvIcon>
                  </span>
                  <span className="mt-2.5 whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.14em] text-[#E7ECF3]">{j.label}</span>
                  {j.value !== null && (
                    <span className="mt-1 text-[15px] font-medium text-[#E7ECF3]" style={{ fontVariantNumeric: "tabular-nums" }}>{j.value}</span>
                  )}
                </div>
                {i < JOURNEY.length - 1 && (
                  <span className="mt-[21px] flex w-16 shrink-0 -translate-x-2 items-center text-[#3D4A5C]" aria-hidden>
                    <span className="h-px flex-1 bg-[#3D4A5C]" />
                    <OvIcon size={12}>{OV.chevronRight}</OvIcon>
                  </span>
                )}
              </div>
            ))}
          </div>
          <div className="mt-5 flex items-center gap-2.5 rounded-lg border border-sky-500/20 bg-sky-500/[0.06] px-3 py-2.5 text-[12px] text-[#C3CCDB]">
            <span className="text-sky-400"><OvIcon size={16}>{OV.info}</OvIcon></span>
            First-touch speed is visible. Appointment timestamp must be captured to measure the full journey.
          </div>
        </section>

        <section className={`${OV_CARD} p-5`}>
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.18em] text-[#C3CCDB]">Top consultants this week</h2>
          <ul className="mt-4 space-y-4">
            {topConsultants.map((cn, i) => (
              <li key={cn.name} className="flex items-center gap-3">
                <Medal rank={i + 1} />
                <span className="shrink-0 rounded-full border-2 border-indigo-400/40 p-[2px]">
                  <PersonAvatar src={cn.avatar} alt={cn.name} size={60} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[19px] font-semibold text-white">{cn.name}</span>
                  <span className="block truncate text-[13px] text-[#8B95A7]" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {cn.consultsThisWeek} consults · {cn.speedToConsult ?? "—"} to consult
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <a href="/consultants" className="mt-5 inline-flex items-center gap-1 text-[14px] text-indigo-300 hover:underline">
            View all consultants <OvIcon size={14}>{OV.chevronRight}</OvIcon>
          </a>
        </section>

        <section className="rounded-2xl border border-red-500/30 bg-[#1A1119] p-5">
          <div className="flex items-center gap-2.5 text-red-400">
            <OvIcon size={18}>{OV.alert}</OvIcon>
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.18em]">Needs intervention</h2>
          </div>
          <div className="mt-4 flex items-start gap-4">
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-2 border-red-500/60 bg-red-500/10 text-[22px] font-semibold text-red-200">
              {breachConsultant.name.split(" ").map((p) => p[0]).join("")}
            </span>
            <div className="min-w-0">
              <div className="text-[20px] font-semibold text-white">{breachConsultant.name}</div>
              <div className="text-[15px] text-red-400" style={{ fontVariantNumeric: "tabular-nums" }}>
                {breachConsultant.consultsThisWeek} consults this week
              </div>
              <div className="mt-0.5 text-[15px] leading-snug text-[#C3CCDB]">
                {KPIS.slaBreaches48h} assignments past the 48-hour no-touch SLA
              </div>
              <a
                href="/consultants"
                className="mt-3 inline-flex items-center gap-2 rounded-lg bg-red-500/85 px-4 py-2 text-[15px] font-medium text-white hover:bg-red-500"
              >
                Contact consultant <OvIcon size={16}>{OV.mail}</OvIcon>
              </a>
            </div>
          </div>
          <div className="mt-4 space-y-3 border-t border-white/[0.08] pt-4">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-amber-500/50 text-amber-400"><OvIcon size={15}>{OV.calendar}</OvIcon></span>
              <span className="min-w-0 flex-1 text-[14px] leading-snug text-[#E7ECF3]">Time to first appointment is not being captured</span>
              <span className="shrink-0 rounded-md border border-amber-500/60 px-3 py-1.5 text-[13px] font-medium text-amber-300">Fix tracking</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-red-500/50 text-red-400"><OvIcon size={15}>{OV.doc}</OvIcon></span>
              <span className="min-w-0 flex-1 text-[14px] leading-snug text-[#E7ECF3]">{missingCq} upcoming consults missing CQ</span>
              <a href="/consultants" className="shrink-0 rounded-md border border-red-500/60 px-3 py-1.5 text-[13px] font-medium text-red-300 hover:bg-red-500/10">Review CQs</a>
            </div>
          </div>
          <p className="mt-4 text-[12px] text-[#8B95A7]">Resolve blockers before more opportunities stall.</p>
        </section>
      </div>

      {/* consultant execution snapshot */}
      <section className={`${OV_CARD} mt-4 p-5`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <OvTile color="#818CF8" size={34}>{OV.group}</OvTile>
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.18em] text-[#C3CCDB]">Consultant execution snapshot</h2>
          </div>
          <div className="flex rounded-lg border border-white/[0.08] bg-[#0F1522] p-0.5 text-[13px]">
            <span className="flex items-center gap-1.5 rounded-md border border-indigo-400/50 bg-indigo-500/15 px-3 py-1.5 text-indigo-200">
              <OvIcon size={13}>{OV.users}</OvIcon> All consultants
            </span>
            <span className="px-3 py-1.5 text-[#8B95A7]">Needs attention</span>
            <span className="px-3 py-1.5 text-[#8B95A7]">Top performers</span>
          </div>
        </div>
        <div className="mt-3 overflow-x-auto">
          <div className="min-w-[860px] text-[14px]">
            <div className={`${SNAPSHOT_GRID} border-b border-white/[0.08] px-4 pb-2.5 text-[11px] uppercase tracking-[0.14em] text-[#8B95A7]`}>
              <span>Consultant</span><span>Assigned</span><span>First touch</span><span>Appointments</span><span>Consults</span><span>Median speed</span><span>SLA</span>
            </div>
            {snapshot.map((cn) => {
              const breach = cn.sla === "take_back";
              return (
                <div
                  key={cn.name}
                  className={`${SNAPSHOT_GRID} border-b border-white/[0.06] px-4 py-3 last:border-0 ${breach ? "bg-red-500/[0.08]" : ""}`}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  <span className="text-[#E7ECF3]">{cn.name}</span>
                  <span className="text-[#C3CCDB]">{breach ? KPIS.slaBreaches48h : "—"}</span>
                  <span className="text-[#C3CCDB]">—</span>
                  <span className="text-[#C3CCDB]">—</span>
                  <span className="text-[#E7ECF3]">{cn.consultsThisWeek}</span>
                  <span className="text-[#C3CCDB]">{cn.speedToConsult ? `${cn.speedToConsult} to consult` : "—"}</span>
                  <span>
                    <span className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] ${breach ? "border border-red-500/50 bg-red-500/15 text-red-300" : "border border-emerald-500/40 bg-emerald-500/10 text-emerald-300"}`}>
                      {breach ? "Breach" : "On track"}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <p className="mt-3 px-4 text-[13px] text-[#8B95A7]">
          Showing primary consultants. <a href="/consultants" className="text-indigo-300 hover:underline">View full roster in CRM.</a>
        </p>
      </section>

      {/* Funnel + score mix */}
      <div className="mt-4 grid grid-cols-1 gap-6 xl:grid-cols-[2fr_1fr]">
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
