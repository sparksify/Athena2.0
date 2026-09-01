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

function Spark({ points, color }: { points: number[]; color: string }) {
  const w = 84;
  const h = 26;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = Math.max(0.001, max - min);
  const step = w / (points.length - 1);
  const y = (v: number) => h - 4 - ((v - min) / span) * (h - 8);
  const path = points.map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} className="block shrink-0" aria-hidden>
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function HeroIcon({ color, size = 36, children }: { color: string; size?: number; children: ReactNode }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-xl border"
      style={{ width: size, height: size, backgroundColor: `${color}14`, borderColor: `${color}33`, color }}
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

function GoalGauge({ value, target, paceBehind }: { value: number; target: number; paceBehind: number }) {
  const r = 80;
  const len = Math.PI * r;
  const frac = Math.min(1, value / target);
  return (
    <div className="relative mx-auto w-full max-w-[330px]">
      <svg viewBox="0 0 200 112" className="block w-full" aria-hidden>
        <defs>
          <linearGradient id="goal-arc" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#7C3AED" />
            <stop offset="55%" stopColor="#6366F1" />
            <stop offset="100%" stopColor="#22D3EE" />
          </linearGradient>
        </defs>
        <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="#1B2333" strokeWidth={13} strokeLinecap="round" />
        <path
          d="M 20 100 A 80 80 0 0 1 180 100"
          fill="none"
          stroke="url(#goal-arc)"
          strokeWidth={13}
          strokeLinecap="round"
          strokeDasharray={`${(len * frac).toFixed(1)} ${len.toFixed(1)}`}
        />
      </svg>
      <div className="absolute inset-x-0 bottom-1 flex flex-col items-center text-center">
        <span className="flex h-9 w-9 items-center justify-center rounded-full border border-[#26304A] bg-[#0F1522] text-cyan-300">
          <InlineIcon size={16}>{ICON.trophy}</InlineIcon>
        </span>
        <div className="mt-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-400">On track</div>
        <p className="mt-1 max-w-[220px] text-[11px] leading-snug text-[#8B95A7]" style={{ fontVariantNumeric: "tabular-nums" }}>
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
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-400">
            Consultant Command
          </div>
          <h1 className="mt-1 text-3xl font-semibold">
            {greeting}, {firstName}
          </h1>
          <p className="mt-1.5 text-sm text-[#8B95A7]">
            Speed to consultation, three real consults a week, a CQ before every consult — the
            activities that cause the deal to happen.
          </p>
        </div>
        <div className="flex gap-1.5">
          {["Today", "7 days", "30 days", "Lifetime"].map((s, i) => (
            <span
              key={s}
              className={`rounded-lg border px-3 py-1.5 text-xs ${i === 3 ? "border-indigo-500/50 bg-indigo-500/15 text-indigo-300" : "border-[#1E2635] bg-[#121826] text-[#8B95A7]"}`}
            >
              {s}
            </span>
          ))}
        </div>
      </div>

      {/* weekly goal + needs attention */}
      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
        <section className="rounded-2xl border border-indigo-500/20 bg-gradient-to-br from-[#131A33] to-[#111726] p-6">
          <div className="grid grid-cols-1 items-center gap-6 md:grid-cols-[1fr_1.15fr]">
            <div>
              <div className="flex items-center gap-3">
                <HeroIcon color="#818CF8" size={42}>{ICON.target}</HeroIcon>
                <div>
                  <div className="text-lg font-semibold text-[#E7ECF3]">Weekly Consult Goal</div>
                  <div className="text-xs text-[#8B95A7]">
                    Real consults (weekly target {KPIS.consultTargetThisWeek})
                  </div>
                </div>
              </div>
              <div className="mt-5 flex items-baseline gap-2" style={{ fontVariantNumeric: num }}>
                <span className="text-5xl font-bold text-[#E7ECF3]">{KPIS.consultsThisWeek}</span>
                <span className="text-2xl font-semibold text-[#64748B]">/ {KPIS.consultTargetThisWeek}</span>
              </div>
              <div className="mt-1 text-sm font-semibold text-cyan-400" style={{ fontVariantNumeric: num }}>
                {goalPct}% of target
              </div>
              <div className="mt-3 h-1.5 w-full max-w-[260px] rounded-full bg-[#1B2333]">
                <div
                  className="h-1.5 rounded-full bg-gradient-to-r from-indigo-500 to-cyan-400"
                  style={{ width: `${goalPct}%` }}
                />
              </div>
              <div className="mt-4 flex items-center gap-2 text-sm text-[#C3CCDB]">
                <span className="text-cyan-300"><InlineIcon size={14}>{ICON.calendar}</InlineIcon></span>
                <span className="font-medium" style={{ fontVariantNumeric: num }}>
                  {remaining} consults remaining
                </span>
              </div>
              <div className="ml-[22px] text-[11px] text-[#64748B]">to reach weekly target</div>
            </div>
            <GoalGauge value={KPIS.consultsThisWeek} target={KPIS.consultTargetThisWeek} paceBehind={paceBehind} />
          </div>
        </section>

        <section className="rounded-2xl border border-red-500/25 bg-gradient-to-br from-[#1A1219] to-[#121826] p-5">
          <div className="flex items-center gap-2 text-red-400">
            <InlineIcon size={15}>{ICON.bell}</InlineIcon>
            <h2 className="text-[11px] font-bold uppercase tracking-[0.18em]">Needs attention</h2>
          </div>
          <div className="mt-3 space-y-3">
            {[
              { count: missingCq, title: "CQ forms missing", sub: "Before consults", icon: ICON.clipboard },
              { count: KPIS.slaBreaches48h, title: "SLA breaches", sub: "Past 48 hours", icon: ICON.clock },
            ].map((a) => (
              <div key={a.title} className="flex items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/5 p-3">
                <HeroIcon color="#F87171" size={38}>{a.icon}</HeroIcon>
                <span className="text-xl font-bold text-red-400" style={{ fontVariantNumeric: num }}>{a.count}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-[#E7ECF3]">{a.title}</span>
                  <span className="block text-[11px] text-[#8B95A7]">{a.sub}</span>
                </span>
                <span className="ml-auto shrink-0 rounded-lg border border-red-500/40 px-3 py-1 text-xs font-medium text-red-300">
                  Review
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-[#8B95A7]">Resolve now to avoid delayed deals.</p>
        </section>
      </div>

      {/* KPI sparkline cards */}
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {heroKpis.map((k) => (
          <div key={k.label} className="rounded-2xl border border-[#1E2635] bg-[#121826] p-4">
            <div className="flex items-center gap-3">
              <HeroIcon color={k.color}>{k.icon}</HeroIcon>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[10px] font-semibold uppercase tracking-wider text-[#64748B]">
                  {k.label}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-2xl font-semibold text-[#E7ECF3]" style={{ fontVariantNumeric: num }}>
                    {k.value}
                  </span>
                  <Spark points={k.spark} color={k.color} />
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
      <section className="mt-4 rounded-2xl border border-indigo-500/20 bg-gradient-to-r from-[#101A33] to-[#131A3A] p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-indigo-300">
            <InlineIcon size={15}>{ICON.sparkles}</InlineIcon>
            <h2 className="text-[11px] font-bold uppercase tracking-[0.18em]">Athena briefing</h2>
          </div>
          <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
            Demo
          </span>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-4 text-sm leading-relaxed text-[#C3CCDB] md:grid-cols-3 md:divide-x md:divide-[#26304A]">
          <ul className="list-disc space-y-1.5 pl-4 marker:text-[#64748B]">
            <li>{KPIS.consultsThisWeek} of {KPIS.consultTargetThisWeek} consults completed this week.</li>
            <li>Median speed to consultation is {KPIS.speedToConsult} from assignment.</li>
          </ul>
          <ul className="list-disc space-y-1.5 pl-4 marker:text-[#64748B] md:pl-8">
            <li>
              {KPIS.cqBeforeConsultRate}% of consults had the CQ in hand first — {missingCq} upcoming
              consults are missing one and are being chased.
            </li>
          </ul>
          <ul className="list-disc space-y-1.5 pl-4 marker:text-[#64748B] md:pl-8">
            <li>Fastest to the table is Rob Petka at 1d 18h with 4 consults, all CQ-backed.</li>
            <li>
              Aaron Bakken has zero consults this week and 2 assignments past the 48-hour no-touch wall.
            </li>
          </ul>
        </div>
      </section>

      {/* assignment → consultation funnel */}
      <section className="mt-4 rounded-2xl border border-[#1E2635] bg-[#121826] p-5">
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex items-center gap-2 text-indigo-400">
            <InlineIcon size={14}>{ICON.funnel}</InlineIcon>
            <h2 className="text-[11px] font-bold uppercase tracking-[0.18em]">
              Assignment → Consultation Funnel
            </h2>
          </div>
          <span className="text-[11px] text-[#64748B]">medians are elapsed time from assignment</span>
        </div>
        <div className="overflow-x-auto pb-1">
          <div className="mt-4 flex min-w-[900px] gap-1">
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
                <div
                  key={step.label}
                  className="flex-1 px-6 py-3.5"
                  style={{
                    clipPath: clip,
                    background: `linear-gradient(90deg, ${s.color}12, ${s.color}2b)`,
                  }}
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold"
                      style={{ borderColor: `${s.color}66`, color: s.color, fontVariantNumeric: num }}
                    >
                      {i + 1}
                    </span>
                    <span className="text-2xl font-bold text-[#E7ECF3]" style={{ fontVariantNumeric: num }}>
                      {step.count}
                    </span>
                    <span className="text-xs font-semibold" style={{ color: s.color, fontVariantNumeric: num }}>
                      {Math.round((step.count / assigned) * 100)}%
                    </span>
                  </div>
                  <div
                    className="mt-1.5 flex items-center gap-1.5 whitespace-nowrap text-[10px] font-semibold uppercase tracking-wide"
                    style={{ color: s.color }}
                  >
                    <InlineIcon size={11}>{s.icon}</InlineIcon>
                    {step.label}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-1.5 flex min-w-[900px] gap-1">
            {CONSULT_FUNNEL.map((step, i) => (
              <div
                key={step.label}
                className="flex-1 px-6 text-[10px] text-[#64748B]"
                style={{ fontVariantNumeric: num }}
              >
                {step.median ? `median ${step.median}` : i === 0 ? "clock starts here" : " "}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* leaderboard + CQ gate */}
      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[2fr_1fr]">
        <section className="rounded-xl border border-[#1E2635] bg-[#121826] p-5">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#8B95A7]">
            Consultant performance
          </h2>
          <div className="overflow-x-auto">
            <table className="mt-3 w-full min-w-[760px] text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-[#64748B]">
                  <th className="pb-2 font-semibold">Consultant</th>
                  <th className="pb-2 font-semibold">Consults / wk</th>
                  <th className="pb-2 font-semibold">Speed to consult</th>
                  <th className="pb-2 font-semibold">CQ first</th>
                  <th className="pb-2 font-semibold">First touch</th>
                  <th className="pb-2 font-semibold">Show</th>
                  <th className="pb-2 font-semibold">Revenue</th>
                  <th className="pb-2 font-semibold">Load</th>
                  <th className="pb-2 font-semibold">SLA</th>
                </tr>
              </thead>
              <tbody>
                {CONSULTANTS.map((cn) => {
                  const overloaded = cn.load[0] > cn.load[1];
                  return (
                    <tr key={cn.name} className="border-t border-[#1A2130]">
                      <td className="py-2.5 pr-3">
                        <span className="flex items-center gap-2.5">
                          <PersonAvatar src={cn.avatar} alt={cn.name} size={32} />
                          <span className="min-w-0">
                            <span className="block whitespace-nowrap text-[#E7ECF3]">{cn.name}</span>
                            <span className="block max-w-[190px] truncate text-[11px] text-[#64748B]">{cn.brands}</span>
                          </span>
                        </span>
                      </td>
                      <td className="py-2.5"><ConsultPace count={cn.consultsThisWeek} /></td>
                      <td className="py-2.5 text-[#C3CCDB]" style={{ fontVariantNumeric: num }}>
                        {cn.speedToConsult ?? <span className="text-red-400">—</span>}
                      </td>
                      <td className="py-2.5">
                        {cn.cqBeforeConsult === null ? (
                          <span className="text-xs text-[#64748B]">—</span>
                        ) : (
                          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${ratePill(cn.cqBeforeConsult)}`} style={{ fontVariantNumeric: num }}>
                            {cn.cqBeforeConsult}%
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 text-[#C3CCDB]" style={{ fontVariantNumeric: num }}>{cn.firstTouch}</td>
                      <td className="py-2.5" style={{ fontVariantNumeric: num }}>{cn.showRate}%</td>
                      <td className="py-2.5" style={{ fontVariantNumeric: num }}>{money(cn.revenue)}</td>
                      <td className={`py-2.5 ${overloaded ? "text-red-400" : "text-[#C3CCDB]"}`} style={{ fontVariantNumeric: num }}>
                        {cn.load[0]} / {cn.load[1]}
                      </td>
                      <td className="py-2.5"><SlaBadge sla={cn.sla} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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

      {/* take-back queue */}
      <section className="mt-6 rounded-xl border border-[#1E2635] bg-[#121826] p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#8B95A7]">
            Take-back queue (48h rule)
          </h2>
          <span className="text-[11px] text-[#64748B]">no first touch → reclaimed and rerouted, allocation drops</span>
        </div>
        <ul className="mt-3 grid grid-cols-1 gap-2 text-sm md:grid-cols-2 xl:grid-cols-4">
          {TAKE_BACK_QUEUE.map((r) => {
            const past = r.hoursSinceAssign >= 48;
            return (
              <li key={r.lead} className="rounded-lg border border-[#1E2635] bg-[#0F1522] px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[#E7ECF3]">{r.lead}</span>
                  <span className={`shrink-0 text-xs font-semibold ${past ? "text-red-400" : "text-amber-400"}`} style={{ fontVariantNumeric: num }}>
                    {past ? "reclaiming now" : `${48 - r.hoursSinceAssign}h left`}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-[#64748B]">
                  <span className="truncate">{r.consultant} · no first touch in {r.hoursSinceAssign}h</span>
                  <span className="flex shrink-0 items-center gap-1">
                    <AgentAvatar name={r.agent} size={14} /> {r.agent}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {/* stage mix bar */}
      <section className="mt-6 rounded-xl border border-[#1E2635] bg-[#121826] p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#8B95A7]">CRM stage mix</h2>
          <span className="text-[11px] text-[#64748B]" style={{ fontVariantNumeric: num }}>
            {totalStage} opportunities in scope
          </span>
        </div>
        <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-[#1B2333]">
          {STAGES.map((s, i) =>
            STAGE_MIX[s] > 0 ? (
              <div key={s} style={{ width: `${(STAGE_MIX[s] / totalStage) * 100}%`, backgroundColor: STAGE_COLORS[i] }} />
            ) : null,
          )}
        </div>
        <div className="mt-3 grid grid-cols-4 gap-x-2 gap-y-2 md:grid-cols-8">
          {STAGES.map((s, i) => (
            <div key={s} className="text-center">
              <div className="text-sm font-semibold" style={{ fontVariantNumeric: num }}>{STAGE_MIX[s]}</div>
              <div className="mt-0.5 flex items-center justify-center gap-1 text-[9px] uppercase tracking-wide text-[#64748B]">
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: STAGE_COLORS[i] }} />
                {s}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ownership + agents */}
      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[2fr_1fr]">
        <section className="rounded-xl border border-[#1E2635] bg-[#121826] p-5">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#8B95A7]">
            Consultant ownership
          </h2>
          <p className="mt-1 text-xs text-[#64748B]">
            Who owns each visible opportunity, who assigned it, and whether it&apos;s moving.
          </p>
          <div className="mt-3 space-y-4">
            {OWNERSHIP.map((group) => (
              <div key={group.consultant} className="rounded-lg border border-[#1E2635] bg-[#0F1522] p-3">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2.5">
                    <PersonAvatar src={consultantAvatar(group.consultant)} alt={group.consultant} size={32} />
                    <span className="font-medium text-[#E7ECF3]">{group.consultant}</span>
                  </span>
                  <span className="rounded-full bg-indigo-500/15 px-2.5 py-0.5 text-xs font-semibold text-indigo-300" style={{ fontVariantNumeric: num }}>
                    {group.leads.length} shown
                  </span>
                </div>
                <ul className="mt-2 divide-y divide-[#1A2130]">
                  {group.leads.map((l) => (
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
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-[#1E2635] bg-[#121826] p-5">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#8B95A7]">AI agents</h2>
          <p className="mt-1 text-xs text-[#64748B]">
            Persistent agents with their persona portraits.
          </p>
          <ul className="mt-3 space-y-3">
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
