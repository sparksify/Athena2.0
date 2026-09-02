import type { ReactNode } from "react";

import { supabaseServer } from "@/lib/supabase/server";
import { AgentAvatar, PersonAvatar } from "@/components/agent-avatar";
import {
  AGENTS, CONSULTANTS, CONSULT_FUNNEL, KPIS, OWNERSHIP, SLA_COUNTS, SLA_LABEL,
  STAGES, STAGE_MIX, TAKE_BACK_QUEUE, UPCOMING_CONSULTS, WEEKLY_CONSULT_TARGET,
  consultantAvatar, type CqStatus, type SlaState,
} from "./demo-data";

export const metadata = { title: "Consultant Command — Athena" };
export const dynamic = "force-dynamic";

/* Phase 7 preview: the accountability screen Nick asked for, rendered from
   clearly-labeled demo fixtures. Hero reworked 2026-09-01 to Steve's
   command-center mockup: weekly consult goal gauge, needs-attention rail,
   KPI sparkline cards, Athena briefing, chevron funnel. Live wiring lands
   with Phase 7. */

const money = (n: number) =>
  n >= 1000 ? `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K` : `$${n}`;

const SLA_BADGE: Record<SlaState, string> = {
  on_track: "bg-emerald-500/15 text-emerald-400",
  nudged: "bg-amber-500/15 text-amber-400",
  escalated: "bg-orange-500/15 text-orange-400",
  take_back: "bg-red-500/15 text-red-400",
};

const CQ_BADGE: Record<CqStatus, { label: string; cls: string }> = {
  received: { label: "CQ received", cls: "bg-emerald-500/15 text-emerald-400" },
  sent: { label: "CQ sent", cls: "bg-amber-500/15 text-amber-400" },
  missing: { label: "No CQ — chase", cls: "bg-red-500/15 text-red-400" },
};

const STAGE_COLORS = ["#6366F1", "#818CF8", "#38BDF8", "#22D3EE", "#2DD4BF", "#34D399", "#A3E635", "#F59E0B"];
/* Card accents from the stage-mix mockup (bar keeps STAGE_COLORS). */
const STAGE_CARD_COLORS = ["#818CF8", "#EAB308", "#38BDF8", "#2DD4BF", "#22D3EE", "#34D399", "#A3E635", "#F59E0B"];

function SlaBadge({ sla }: { sla: SlaState }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${SLA_BADGE[sla]}`}>
      {SLA_LABEL[sla]}
    </span>
  );
}

function ratePill(pct: number) {
  return pct >= 90
    ? "bg-emerald-500/15 text-emerald-400"
    : pct >= 75
      ? "bg-amber-500/15 text-amber-400"
      : "bg-red-500/15 text-red-400";
}

/* Three dots against the weekly target of 3 real consults, plus overflow. */
function ConsultPace({ count }: { count: number }) {
  const met = count >= WEEKLY_CONSULT_TARGET;
  return (
    <span className="flex items-center gap-1.5">
      <span className={`text-sm font-semibold ${met ? "text-emerald-400" : count === 0 ? "text-red-400" : "text-[#E7ECF3]"}`} style={{ fontVariantNumeric: "tabular-nums" }}>
        {count}
      </span>
      <span className="flex gap-0.5">
        {Array.from({ length: WEEKLY_CONSULT_TARGET }, (_, i) => (
          <span
            key={i}
            className={`h-1.5 w-1.5 rounded-full ${i < count ? (met ? "bg-emerald-400" : "bg-indigo-400") : "bg-[#2A3348]"}`}
          />
        ))}
      </span>
      {count > WEEKLY_CONSULT_TARGET && (
        <span className="text-[10px] font-semibold text-emerald-400">+{count - WEEKLY_CONSULT_TARGET}</span>
      )}
    </span>
  );
}

/* ---------- hero building blocks (server-rendered, no client JS) ---------- */

/* Shared surface: soft top highlight, hairline border, deep drop shadow. */
const CARD =
  "relative overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-b from-[#161D2E] to-[#111726] shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_20px_40px_-22px_rgba(0,0,0,0.8)]";

function Glow({ className, color }: { className: string; color: string }) {
  return (
    <div
      className={`pointer-events-none absolute rounded-full blur-3xl ${className}`}
      style={{ backgroundColor: color }}
      aria-hidden
    />
  );
}

function Spark({ id, points, color }: { id: string; points: number[]; color: string }) {
  const w = 88;
  const h = 30;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = Math.max(0.001, max - min);
  const step = w / (points.length - 1);
  const y = (v: number) => h - 5 - ((v - min) / span) * (h - 10);
  const path = points.map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const lastX = ((points.length - 1) * step).toFixed(1);
  const lastY = y(points[points.length - 1] ?? 0);
  return (
    <svg width={w} height={h} className="block shrink-0 overflow-visible" aria-hidden>
      <defs>
        <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.32} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
        <filter id={`${id}-glow`} x="-20%" y="-60%" width="140%" height="220%">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
      </defs>
      <path d={`${path} L${lastX},${h} L0,${h} Z`} fill={`url(#${id}-fill)`} />
      <path d={path} fill="none" stroke={color} strokeWidth={3.5} opacity={0.10} filter={`url(#${id}-glow)`} />
      <path d={path} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r={3.2} fill={color} opacity={0.35} />
      <circle cx={lastX} cy={lastY} r={1.8} fill="#fff" />
    </svg>
  );
}

function HeroIcon({ color, size = 36, glow = true, children }: { color: string; size?: number; glow?: boolean; children: ReactNode }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-xl border"
      style={{
        width: size,
        height: size,
        color,
        borderColor: `${color}66`,
        background: `linear-gradient(145deg, ${color}30, ${color}0d)`,
        boxShadow: glow ? `0 0 14px ${color}0f, inset 0 1px 0 rgba(255,255,255,0.10)` : "inset 0 1px 0 rgba(255,255,255,0.10)",
      }}
    >
      <svg
        width={Math.round(size * 0.52)}
        height={Math.round(size * 0.52)}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {children}
      </svg>
    </span>
  );
}

function InlineIcon({ size = 12, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden
    >
      {children}
    </svg>
  );
}

const ICON = {
  target: (
    <>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </>
  ),
  clipboard: (
    <>
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="M9 12h6M9 16h6" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </>
  ),
  gauge: (
    <>
      <path d="m12 14 4-4" />
      <path d="M3.34 19a10 10 0 1 1 17.32 0" />
    </>
  ),
  check: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  users: (
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  sparkles: (
    <>
      <path d="M12 3l1.9 5.8 5.8 1.9-5.8 1.9L12 18.4l-1.9-5.8L4.3 10.7l5.8-1.9z" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
    </>
  ),
  funnel: <path d="M22 3H2l8 9.46V19l4 2v-8.54z" />,
  layers: <path d="M4 6h16M7 12h10M10 18h4" />,
  chat: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  trend: (
    <>
      <path d="M23 6l-9.5 9.5-5-5L1 18" />
      <path d="M17 6h6v6" />
    </>
  ),
  trophy: (
    <>
      <path d="M8 21h8M12 17v4" />
      <path d="M7 4h10v5a5 5 0 0 1-10 0z" />
      <path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4" />
    </>
  ),
} as const;

const ARC = "M 20 100 A 80 80 0 0 1 180 100";
const ARC_GLOSS = "M 16 100 A 84 84 0 0 1 184 100";

function GoalGauge({ value, target, paceBehind }: { value: number; target: number; paceBehind: number }) {
  const len = Math.PI * 80;
  const lenGloss = Math.PI * 84;
  const frac = Math.min(1, value / target);
  const dash = (l: number) => `${(l * frac).toFixed(1)} ${l.toFixed(1)}`;
  return (
    <div className="relative mx-auto w-full max-w-[300px]">
      <svg viewBox="0 0 200 112" className="block w-full overflow-visible" aria-hidden>
        <defs>
          <linearGradient id="goal-arc" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#7C3AED" />
            <stop offset="40%" stopColor="#6D5CF6" />
            <stop offset="72%" stopColor="#38BDF8" />
            <stop offset="100%" stopColor="#22D3EE" />
          </linearGradient>
          <linearGradient id="goal-track" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1C2436" />
            <stop offset="100%" stopColor="#131A29" />
          </linearGradient>
          <filter id="goal-bloom" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
        </defs>
        {/* track with a soft inner shadow line */}
        <path d={ARC} fill="none" stroke="url(#goal-track)" strokeWidth={13} strokeLinecap="round" />
        <path d={ARC} fill="none" stroke="#000" strokeOpacity={0.25} strokeWidth={1} transform="translate(0,-5.5)" />
        {/* bloom under the progress arc */}
        <path
          d={ARC}
          fill="none"
          stroke="url(#goal-arc)"
          strokeWidth={20}
          strokeLinecap="round"
          strokeDasharray={dash(len)}
          opacity={0.12}
          filter="url(#goal-bloom)"
        />
        {/* progress arc */}
        <path d={ARC} fill="none" stroke="url(#goal-arc)" strokeWidth={13} strokeLinecap="round" strokeDasharray={dash(len)} />
        {/* gloss highlight along the outer edge */}
        <path
          d={ARC_GLOSS}
          fill="none"
          stroke="#fff"
          strokeOpacity={0.22}
          strokeWidth={1.4}
          strokeLinecap="round"
          strokeDasharray={dash(lenGloss)}
        />
      </svg>
      <div className="absolute inset-x-0 bottom-1 flex flex-col items-center text-center">
        <span
          className="flex h-10 w-10 items-center justify-center rounded-full border border-cyan-300/30 text-cyan-200"
          style={{
            background: "linear-gradient(180deg, #16213A, #0F1522)",
            boxShadow: "0 0 16px rgba(34,211,238,0.08), inset 0 1px 0 rgba(255,255,255,0.10)",
          }}
        >
          <InlineIcon size={17}>{ICON.trophy}</InlineIcon>
        </span>
        <div className="mt-2 text-[11px] font-bold uppercase tracking-[0.2em] text-cyan-300">
          On track
        </div>
        <p className="mt-1 max-w-[220px] text-[11px] leading-snug text-[#94A0B8]" style={{ fontVariantNumeric: "tabular-nums" }}>
          You&apos;re {paceBehind} consults behind target pace to hit {target} this week.
        </p>
      </div>
      <div className="flex justify-between px-[6%] pt-1 text-[10px] text-[#64748B]" style={{ fontVariantNumeric: "tabular-nums" }}>
        <span>0</span>
        <span>{target}</span>
      </div>
    </div>
  );
}

const PERF_GRID =
  "grid grid-cols-[minmax(230px,2.1fr)_1fr_1fr_0.8fr_1fr_0.6fr_0.8fr_0.7fr_0.9fr] items-center";

const FUNNEL_STYLE = [
  { color: "#818CF8", icon: ICON.users },
  { color: "#A78BFA", icon: ICON.chat },
  { color: "#60A5FA", icon: ICON.clipboard },
  { color: "#22D3EE", icon: ICON.users },
  { color: "#34D399", icon: ICON.trend },
] as const;

export default async function ConsultantsPreviewPage() {
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

  const totalStage = Object.values(STAGE_MIX).reduce((a, b) => a + b, 0);
  const num = "tabular-nums" as const;
  const assigned = CONSULT_FUNNEL[0]?.count ?? 1;
  const missingCq = UPCOMING_CONSULTS.filter((c) => c.cq === "missing").length;
  const goalPct = Math.round((KPIS.consultsThisWeek / KPIS.consultTargetThisWeek) * 100);
  const remaining = KPIS.consultTargetThisWeek - KPIS.consultsThisWeek;
  const paceBehind = 3; // demo — Phase 7 computes pace from week elapsed
  const topConsultants = [...CONSULTANTS]
    .sort((a, b) => b.consultsThisWeek - a.consultsThisWeek || b.showRate - a.showRate)
    .slice(0, 3);

  const heroKpis = [
    { label: "Speed to consult", value: KPIS.speedToConsult, sub: "median, assignment → consult held", subColor: null, color: "#818CF8", icon: ICON.gauge, spark: [8, 7.4, 7.8, 6.6, 7.1, 6.2, 6.5, 5.6] },
    { label: "Median first touch", value: KPIS.medianFirstTouch, sub: "medians are elapsed time from assignment", subColor: null, color: "#A78BFA", icon: ICON.clock, spark: [3.4, 4.1, 3.2, 4.5, 3.6, 4.7, 3.8, 3.2] },
    { label: "CQ before consult", value: `${KPIS.cqBeforeConsultRate}%`, sub: `${missingCq} upcoming missing`, subColor: "#34D399", color: "#34D399", icon: ICON.check, spark: [70, 75, 72, 80, 77, 84, 82, 88] },
    { label: "Show rate", value: `${KPIS.showRate}%`, sub: null, subColor: null, color: "#60A5FA", icon: ICON.users, spark: [64, 70, 66, 73, 68, 74, 70, 71] },
  ];

  return (
    <main className="mx-auto max-w-[1400px] p-8">
      {/* preview banner */}
      <div className="mb-6 flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
        <span className="font-semibold uppercase tracking-wider">Preview · demo numbers</span>
        <span className="text-amber-200/70">
          Real consultant roster, placeholder metrics — every rate, time, and SLA state on this page
          is demo data until Phase 7 wires live queries. The 48h take-back and CQ-before-consult
          rules shown are the real spec.
        </span>
      </div>

      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-indigo-400">
            Consultant Command
          </div>
          <h1 className="mt-1 text-[34px] font-semibold leading-tight tracking-tight text-white">
            {greeting}, {firstName}
          </h1>
          <p className="mt-1.5 text-sm text-[#8B95A7]">
            Speed to consultation, three real consults a week, a CQ before every consult — the
            activities that cause the deal to happen.
          </p>
        </div>
        <div className="flex overflow-hidden rounded-lg border border-white/[0.08] bg-[#121826] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          {["Today", "7 days", "30 days", "Lifetime"].map((s, i) => (
            <span
              key={s}
              className={`px-3.5 py-1.5 text-xs ${
                i === 3
                  ? "bg-indigo-500/25 font-medium text-indigo-100 shadow-[inset_0_0_0_1px_rgba(129,140,248,0.45)]"
                  : "border-l border-white/[0.06] text-[#8B95A7] first:border-l-0"
              }`}
            >
              {s}
            </span>
          ))}
        </div>
      </div>

      {/* weekly goal + needs attention */}
      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
        <section className={`${CARD} border-indigo-400/15 p-6`} style={{ background: "linear-gradient(135deg, #151C38 0%, #131A2E 45%, #111726 100%)" }}>
          <Glow className="-top-24 right-1/3 h-72 w-72 opacity-[0.06]" color="#6366F1" />
          <Glow className="-bottom-20 left-1/2 h-52 w-52 opacity-[0.06]" color="#22D3EE" />
          <Glow className="-left-16 top-1/3 h-48 w-48 opacity-[0.06]" color="#7C3AED" />
          <div className="relative grid grid-cols-1 items-center gap-6 md:grid-cols-2 xl:grid-cols-[0.95fr_1.2fr_0.85fr]">
            <div>
              <div className="flex items-center gap-3">
                <HeroIcon color="#818CF8" size={44}>{ICON.target}</HeroIcon>
                <div>
                  <div className="text-lg font-semibold text-white">Weekly Consult Goal</div>
                  <div className="text-xs text-[#8B95A7]">
                    Real consults (weekly target {KPIS.consultTargetThisWeek})
                  </div>
                </div>
              </div>
              <div className="mt-5 flex items-baseline gap-2" style={{ fontVariantNumeric: num }}>
                <span className="text-[56px] font-bold leading-none tracking-tight text-white">
                  {KPIS.consultsThisWeek}
                </span>
                <span className="text-2xl font-semibold text-[#64748B]">/ {KPIS.consultTargetThisWeek}</span>
              </div>
              <div className="mt-2 text-sm font-semibold text-cyan-300" style={{ fontVariantNumeric: num }}>
                {goalPct}% of target
              </div>
              <div className="mt-3 h-1.5 w-full max-w-[260px] rounded-full bg-[#0D1220] shadow-[inset_0_1px_2px_rgba(0,0,0,0.6)]">
                <div
                  className="h-1.5 rounded-full bg-gradient-to-r from-indigo-500 via-sky-400 to-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.12)]"
                  style={{ width: `${goalPct}%` }}
                />
              </div>
              <div className="mt-4 flex items-center gap-2 text-sm text-cyan-100">
                <span className="text-cyan-300"><InlineIcon size={14}>{ICON.calendar}</InlineIcon></span>
                <span className="font-medium" style={{ fontVariantNumeric: num }}>
                  {remaining} consults remaining
                </span>
              </div>
              <div className="ml-[22px] text-[11px] text-[#64748B]">to reach weekly target</div>
            </div>
            <GoalGauge value={KPIS.consultsThisWeek} target={KPIS.consultTargetThisWeek} paceBehind={paceBehind} />
            <div className="md:col-span-2 xl:col-span-1 xl:border-l xl:border-white/[0.06] xl:pl-6">
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#7C8799]">
                Top consultants this week
              </div>
              <ul className="mt-3 space-y-3">
                {topConsultants.map((cn, i) => (
                  <li key={cn.name} className="flex items-center gap-3">
                    <span className="relative shrink-0">
                      <span
                        className="block rounded-full p-[2px]"
                        style={{
                          background: i === 0 ? "linear-gradient(135deg, #6366F1, #22D3EE)" : "rgba(255,255,255,0.10)",
                          boxShadow: i === 0 ? "0 0 12px rgba(34,211,238,0.08)" : "none",
                        }}
                      >
                        <PersonAvatar src={cn.avatar} alt={cn.name} size={44} />
                      </span>
                      <span
                        className="absolute -bottom-1 -right-1 flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 border-[#131A2E] text-[10px] font-bold text-white"
                        style={{
                          background: i === 0 ? "linear-gradient(135deg, #6366F1, #22D3EE)" : "#2A3348",
                          fontVariantNumeric: num,
                        }}
                      >
                        {i + 1}
                      </span>
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-white">{cn.name}</span>
                      <span className="block truncate text-[11px] text-[#8B95A7]" style={{ fontVariantNumeric: num }}>
                        {cn.consultsThisWeek} consults · {cn.speedToConsult ?? "—"} to consult
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className={`${CARD} border-red-400/20 p-5`} style={{ background: "linear-gradient(160deg, #1E1420 0%, #171323 40%, #121826 100%)" }}>
          <div className="relative">
            <div className="flex items-center gap-2 text-red-400">
              <InlineIcon size={15}>{ICON.bell}</InlineIcon>
              <h2 className="text-[11px] font-bold uppercase tracking-[0.2em]">Needs attention</h2>
            </div>
            <div className="mt-3 space-y-3">
              {[
                { count: missingCq, title: "CQ forms missing", sub: "Before consults", icon: ICON.clipboard },
                { count: KPIS.slaBreaches48h, title: "SLA breaches", sub: "Past 48 hours", icon: ICON.clock },
              ].map((a) => (
                <div
                  key={a.title}
                  className="flex items-center gap-3 rounded-xl border border-red-400/20 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                  style={{ background: "linear-gradient(90deg, rgba(239,68,68,0.12), rgba(239,68,68,0.04))" }}
                >
                  <HeroIcon color="#F87171" size={40} glow={false}>{a.icon}</HeroIcon>
                  <span className="text-2xl font-bold text-red-400" style={{ fontVariantNumeric: num }}>
                    {a.count}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-white">{a.title}</span>
                    <span className="block text-[11px] text-[#8B95A7]">{a.sub}</span>
                  </span>
                  <span className="ml-auto shrink-0 rounded-lg border border-red-400/50 bg-red-500/10 px-3 py-1 text-xs font-semibold text-red-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                    Review
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-[#8B95A7]">Resolve now to avoid delayed deals.</p>
          </div>
        </section>
      </div>

      {/* KPI sparkline cards */}
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {heroKpis.map((k, i) => (
          <div key={k.label} className={`${CARD} p-4`}>
            <Glow className="-right-10 -top-10 h-32 w-32 opacity-[0.06]" color={k.color} />
            <div className="relative flex items-center gap-3">
              <HeroIcon color={k.color} size={40}>{k.icon}</HeroIcon>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-[#7C8799]">
                  {k.label}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[26px] font-semibold leading-tight text-white" style={{ fontVariantNumeric: num }}>
                    {k.value}
                  </span>
                  <Spark id={`spark-${i}`} points={k.spark} color={k.color} />
                </div>
                {k.sub && (
                  <div
                    className="truncate text-[10px]"
                    style={{ color: k.subColor ?? "#64748B", fontVariantNumeric: num }}
                  >
                    {k.sub}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Athena briefing */}
      <section className={`${CARD} mt-4 border-indigo-400/20 p-5`} style={{ background: "linear-gradient(90deg, #121A38 0%, #141B3C 55%, #171A40 100%)" }}>
        <Glow className="-left-20 -top-24 h-64 w-64 opacity-[0.06]" color="#6366F1" />
        <Glow className="-bottom-24 right-1/3 h-48 w-48 opacity-[0.06]" color="#8B5CF6" />
        <div className="relative">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-indigo-300">
              <InlineIcon size={15}>{ICON.sparkles}</InlineIcon>
              <h2 className="text-[11px] font-bold uppercase tracking-[0.2em]">Athena briefing</h2>
            </div>
            <span className="rounded-full border border-amber-400/40 bg-amber-500/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-300">
              Demo
            </span>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-4 text-sm leading-relaxed text-[#C9D2E0] md:grid-cols-3 md:divide-x md:divide-white/[0.08]">
            <ul className="list-disc space-y-1.5 pl-4 marker:text-indigo-400/70">
              <li>{KPIS.consultsThisWeek} of {KPIS.consultTargetThisWeek} consults completed this week.</li>
              <li>Median speed to consultation is {KPIS.speedToConsult} from assignment.</li>
            </ul>
            <ul className="list-disc space-y-1.5 pl-4 marker:text-indigo-400/70 md:pl-8">
              <li>
                {KPIS.cqBeforeConsultRate}% of consults had the CQ in hand first — {missingCq} upcoming
                consults are missing one and are being chased.
              </li>
            </ul>
            <ul className="list-disc space-y-1.5 pl-4 marker:text-indigo-400/70 md:pl-8">
              <li>Fastest to the table is Rob Petka at 1d 18h with 4 consults, all CQ-backed.</li>
              <li>
                Aaron Bakken has zero consults this week and 2 assignments past the 48-hour no-touch wall.
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* assignment → consultation funnel — flat, no gradients */}
      <section className={`${CARD} mt-4 p-5`}>
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex items-center gap-2 text-indigo-400">
            <InlineIcon size={14}>{ICON.funnel}</InlineIcon>
            <h2 className="text-[11px] font-bold uppercase tracking-[0.2em]">
              Assignment → Consultation Funnel
            </h2>
          </div>
          <span className="text-[11px] text-[#64748B]">medians are elapsed time from assignment</span>
        </div>
        <div className="overflow-x-auto pb-1">
          <div className="mt-4 flex min-w-[900px] gap-1.5">
            {CONSULT_FUNNEL.map((step, i) => {
              const s = FUNNEL_STYLE[i] ?? FUNNEL_STYLE[0];
              const first = i === 0;
              const last = i === CONSULT_FUNNEL.length - 1;
              const clip = first
                ? "polygon(0 0, calc(100% - 16px) 0, 100% 50%, calc(100% - 16px) 100%, 0 100%)"
                : last
                  ? "polygon(0 0, 100% 0, 100% 100%, 0 100%, 16px 50%)"
                  : "polygon(0 0, calc(100% - 16px) 0, 100% 50%, calc(100% - 16px) 100%, 0 100%, 16px 50%)";
              return (
                <div key={step.label} className="flex-1">
                  {/* outer = 1px border in the stage color, inner = flat fill */}
                  <div style={{ clipPath: clip, padding: 1, backgroundColor: `${s.color}59` }}>
                    <div
                      className="px-6 py-3.5"
                      style={{ clipPath: clip, backgroundColor: `color-mix(in srgb, ${s.color} 9%, #0F1522)` }}
                    >
                      <div className="flex items-center gap-2.5">
                        <span
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold"
                          style={{ borderColor: `${s.color}80`, color: s.color, backgroundColor: `${s.color}1f`, fontVariantNumeric: num }}
                        >
                          {i + 1}
                        </span>
                        <span className="text-[28px] font-bold leading-none text-white" style={{ fontVariantNumeric: num }}>
                          {step.count}
                        </span>
                        <span className="text-xs font-semibold" style={{ color: s.color, fontVariantNumeric: num }}>
                          {Math.round((step.count / assigned) * 100)}%
                        </span>
                      </div>
                      <div
                        className="mt-2 flex items-center gap-1.5 whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.14em]"
                        style={{ color: s.color }}
                      >
                        <InlineIcon size={11}>{s.icon}</InlineIcon>
                        {step.label}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex min-w-[900px] gap-1.5">
            {CONSULT_FUNNEL.map((step, i) => (
              <div
                key={step.label}
                className="flex-1 px-6 text-[10px] text-[#64748B]"
                style={{ fontVariantNumeric: num }}
              >
                {step.median ? `median ${step.median}` : i === 0 ? "clock starts here" : " "}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CRM stage mix */}
      <section className={`${CARD} mt-4 p-5`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <HeroIcon color="#818CF8" size={42}>{ICON.layers}</HeroIcon>
            <h2 className="text-[15px] font-bold uppercase tracking-[0.2em] text-white">CRM stage mix</h2>
          </div>
          <span className="flex items-center gap-2 text-sm text-[#8B95A7]" style={{ fontVariantNumeric: num }}>
            <span className="h-2.5 w-2.5 rounded-full bg-indigo-400/70" />
            {totalStage} opportunities in scope
          </span>
        </div>
        <div className="mt-5 flex h-9 overflow-hidden rounded-lg bg-[#1B2333]">
          {STAGES.map((s, i) =>
            STAGE_MIX[s] > 0 ? (
              <div
                key={s}
                className="border-r border-black/25 last:border-r-0"
                style={{ width: `${(STAGE_MIX[s] / totalStage) * 100}%`, backgroundColor: STAGE_COLORS[i] }}
                title={`${s}: ${STAGE_MIX[s]}`}
              />
            ) : null,
          )}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
          {STAGES.map((s, i) => {
            const n = STAGE_MIX[s];
            const pct = totalStage > 0 ? (n / totalStage) * 100 : 0;
            const c = STAGE_CARD_COLORS[i] ?? "#818CF8";
            return (
              <div
                key={s}
                className="flex flex-col rounded-xl border p-4"
                style={{ borderColor: `${c}59`, backgroundColor: `${c}0a` }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] text-[#E7ECF3]">{s}</span>
                  <span className="shrink-0 rounded-md border border-indigo-400/50 bg-indigo-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-indigo-300">
                    Live
                  </span>
                </div>
                <div className="mt-3 text-[40px] font-bold leading-none text-white" style={{ fontVariantNumeric: num }}>
                  {n}
                </div>
                <div className="mt-3 text-[13px] leading-snug text-[#8B95A7]" style={{ fontVariantNumeric: num }}>
                  <span className="font-semibold" style={{ color: c }}>{pct.toFixed(1)}%</span> of visible CRM opportunities
                </div>
                <div className="mt-auto pt-4">
                  <div className="h-1.5 rounded-full bg-[#1B2333]">
                    <div
                      className="h-1.5 rounded-full"
                      style={{ width: `${n > 0 ? Math.max(pct, 5) : 0}%`, backgroundColor: c }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* leaderboard + CQ gate */}
      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[2fr_1fr]">
        <section className="rounded-xl border border-[#1E2635] bg-[#121826] p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#8B95A7]">
              Consultant performance
            </h2>
            <span className="text-[11px] text-[#64748B]">click a consultant to see their clients</span>
          </div>
          <div className="overflow-x-auto">
            <div className="mt-3 min-w-[760px] text-sm">
              <div className={`${PERF_GRID} pb-2 text-[10px] uppercase tracking-wider text-[#64748B]`}>
                <span className="font-semibold">Consultant</span>
                <span className="font-semibold">Consults / wk</span>
                <span className="font-semibold">Speed to consult</span>
                <span className="font-semibold">CQ first</span>
                <span className="font-semibold">First touch</span>
                <span className="font-semibold">Show</span>
                <span className="font-semibold">Revenue</span>
                <span className="font-semibold">Load</span>
                <span className="font-semibold">SLA</span>
              </div>
              {CONSULTANTS.map((cn) => {
                const overloaded = cn.load[0] > cn.load[1];
                const leads = OWNERSHIP.find((g) => g.consultant === cn.name)?.leads ?? [];
                return (
                  <details key={cn.name} className="group border-t border-[#1A2130]">
                    <summary className={`${PERF_GRID} cursor-pointer list-none py-2.5 transition-colors hover:bg-white/[0.02] group-open:bg-white/[0.03] [&::-webkit-details-marker]:hidden`}>
                      <span className="flex items-center gap-2.5 pr-3">
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center text-[#64748B] transition-transform group-open:rotate-90">
                          <InlineIcon size={12}><path d="m9 6 6 6-6 6" /></InlineIcon>
                        </span>
                        <PersonAvatar src={cn.avatar} alt={cn.name} size={32} />
                        <span className="min-w-0">
                          <span className="block whitespace-nowrap text-[#E7ECF3]">{cn.name}</span>
                          <span className="block max-w-[170px] truncate text-[11px] text-[#64748B]">{cn.brands}</span>
                        </span>
                      </span>
                      <span><ConsultPace count={cn.consultsThisWeek} /></span>
                      <span className="text-[#C3CCDB]" style={{ fontVariantNumeric: num }}>
                        {cn.speedToConsult ?? <span className="text-red-400">—</span>}
                      </span>
                      <span>
                        {cn.cqBeforeConsult === null ? (
                          <span className="text-xs text-[#64748B]">—</span>
                        ) : (
                          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${ratePill(cn.cqBeforeConsult)}`} style={{ fontVariantNumeric: num }}>
                            {cn.cqBeforeConsult}%
                          </span>
                        )}
                      </span>
                      <span className="text-[#C3CCDB]" style={{ fontVariantNumeric: num }}>{cn.firstTouch}</span>
                      <span style={{ fontVariantNumeric: num }}>{cn.showRate}%</span>
                      <span style={{ fontVariantNumeric: num }}>{money(cn.revenue)}</span>
                      <span className={overloaded ? "text-red-400" : "text-[#C3CCDB]"} style={{ fontVariantNumeric: num }}>
                        {cn.load[0]} / {cn.load[1]}
                      </span>
                      <span><SlaBadge sla={cn.sla} /></span>
                    </summary>
                    <div className="mb-3 ml-7 rounded-lg border border-[#1E2635] bg-[#0F1522] p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-[#64748B]">
                          {cn.name}&apos;s clients
                        </span>
                        <span className="rounded-full bg-indigo-500/15 px-2.5 py-0.5 text-xs font-semibold text-indigo-300" style={{ fontVariantNumeric: num }}>
                          {leads.length} shown of {cn.contacted}
                        </span>
                      </div>
                      {leads.length === 0 ? (
                        <p className="mt-2 text-xs text-[#64748B]">No clients loaded in this preview.</p>
                      ) : (
                        <ul className="mt-1 divide-y divide-[#1A2130]">
                          {leads.map((l) => (
                            <li key={l.email} className="grid grid-cols-2 items-center gap-2 py-2 md:grid-cols-[1.4fr_1fr_1fr_0.9fr_0.6fr]">
                              <span className="min-w-0">
                                <span className="block truncate text-sm text-[#E7ECF3]">{l.lead}</span>
                                <span className="block truncate text-[11px] text-[#64748B]">{l.email}</span>
                              </span>
                              <span className="truncate text-xs text-[#8B95A7]">{l.brand}</span>
                              <span className="flex items-center gap-1.5 text-xs text-[#8B95A7]">
                                <AgentAvatar name={l.agent} size={18} />
                                <span className="truncate">Assigned by {l.agent}</span>
                              </span>
                              <span className="text-xs text-[#C3CCDB]">
                                {l.stage}
                                <span className="block text-[10px] text-[#64748B]" style={{ fontVariantNumeric: num }}>
                                  {l.daysInStage}d in stage
                                </span>
                              </span>
                              <span className="justify-self-start md:justify-self-end"><SlaBadge sla={l.sla} /></span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </details>
                );
              })}
            </div>
          </div>
          <p className="mt-3 text-[11px] text-[#64748B]">
            Real consult = completed consultation appointment with a logged disposition. Routing rewards
            the top of this table: fast consults, CQ compliance, and show rate earn new, more, and
            higher-scored leads.
          </p>
        </section>

        <section className="rounded-xl border border-[#1E2635] bg-[#121826] p-5">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#8B95A7]">
            CQ gate — upcoming consults
          </h2>
          <p className="mt-1 text-xs text-[#64748B]">
            Every consult needs the CQ in hand first. Missing ones are chased now; the booking
            hard-gate ships with Phase 7.
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            {UPCOMING_CONSULTS.map((c) => (
              <li key={`${c.lead}-${c.when}`} className="rounded-lg border border-[#1E2635] bg-[#0F1522] px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[#E7ECF3]">{c.lead}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${CQ_BADGE[c.cq].cls}`}>
                    {CQ_BADGE[c.cq].label}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-[#64748B]">
                  <span className="truncate">{c.consultant} · {c.when}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    <AgentAvatar name={c.agent} size={14} /> {c.agent}
                  </span>
                </div>
              </li>
            ))}
          </ul>

          <h2 className="mt-5 text-[11px] font-semibold uppercase tracking-wider text-[#8B95A7]">
            Assignment SLA
          </h2>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {(Object.keys(SLA_COUNTS) as SlaState[]).map((k) => (
              <div key={k} className="rounded-lg border border-[#1E2635] bg-[#0F1522] p-3">
                <div className="text-xl font-semibold" style={{ fontVariantNumeric: num }}>{SLA_COUNTS[k]}</div>
                <div className="mt-1"><SlaBadge sla={k} /></div>
              </div>
            ))}
          </div>
          <div className="mt-2 text-[11px] text-[#64748B]">
            Ladder: nudge +1h → nudge +4h → manager +24h → take-back at 48h.
          </div>
        </section>
      </div>

      {/* take-back queue — framed around the consultant we're reclaiming from */}
      <section className="mt-6 rounded-xl border border-[#1E2635] bg-[#121826] p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#8B95A7]">
            Take-back queue (48h rule)
          </h2>
          <span className="text-[11px] text-[#64748B]">no first touch → reclaimed from the consultant and rerouted, their allocation drops</span>
        </div>
        <ul className="mt-3 grid grid-cols-1 gap-2 text-sm md:grid-cols-2 xl:grid-cols-4">
          {TAKE_BACK_QUEUE.map((r) => {
            const past = r.hoursSinceAssign >= 48;
            return (
              <li key={r.lead} className={`flex items-center gap-3 rounded-lg border bg-[#0F1522] px-3 py-2.5 ${past ? "border-red-500/30" : "border-[#1E2635]"}`}>
                <span className={`shrink-0 rounded-full p-[2px] ${past ? "bg-red-500/60" : "bg-amber-500/40"}`}>
                  <PersonAvatar src={consultantAvatar(r.consultant)} alt={r.consultant} size={40} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-[#E7ECF3]">{r.consultant}</span>
                    <span className={`shrink-0 text-xs font-semibold ${past ? "text-red-400" : "text-amber-400"}`} style={{ fontVariantNumeric: num }}>
                      {past ? "reclaiming now" : `${48 - r.hoursSinceAssign}h left`}
                    </span>
                  </span>
                  <span className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-[#64748B]">
                    <span className="truncate">{r.lead} · no first touch in {r.hoursSinceAssign}h</span>
                    <span className="flex shrink-0 items-center gap-1">
                      <AgentAvatar name={r.agent} size={14} /> {r.agent}
                    </span>
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {/* AI agents */}
      <div className="mt-6">
        <section className="rounded-xl border border-[#1E2635] bg-[#121826] p-5">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#8B95A7]">AI agents</h2>
          <p className="mt-1 text-xs text-[#64748B]">
            Persistent agents with their persona portraits.
          </p>
          <ul className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {AGENTS.map((a) => (
              <li key={a.name} className="rounded-lg border border-[#1E2635] bg-[#0F1522] p-3">
                <div className="flex items-center gap-3">
                  <AgentAvatar name={a.name} size={38} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-[#E7ECF3]">{a.name}</span>
                      <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-emerald-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Active
                      </span>
                    </div>
                    <div className="truncate text-[11px] text-[#64748B]">{a.role}</div>
                  </div>
                </div>
                <div className="mt-2.5 grid grid-cols-3 gap-2 border-t border-[#1A2130] pt-2.5 text-center">
                  {[
                    { v: a.handoffs.toLocaleString(), l: "Handoffs" },
                    { v: a.repliesHandled.toLocaleString(), l: "Replies" },
                    { v: String(a.activeAssignments), l: "Active" },
                  ].map((m) => (
                    <div key={m.l}>
                      <div className="text-sm font-semibold" style={{ fontVariantNumeric: num }}>{m.v}</div>
                      <div className="text-[9px] uppercase tracking-wide text-[#64748B]">{m.l}</div>
                    </div>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
