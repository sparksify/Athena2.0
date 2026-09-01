import { AgentAvatar, PersonAvatar } from "@/components/agent-avatar";
import {
  AGENTS, CONSULTANTS, CONSULT_FUNNEL, KPIS, OWNERSHIP, SLA_COUNTS, SLA_LABEL,
  STAGES, STAGE_MIX, TAKE_BACK_QUEUE, UPCOMING_CONSULTS, WEEKLY_CONSULT_TARGET,
  consultantAvatar, type CqStatus, type SlaState,
} from "./demo-data";

export const metadata = { title: "Consultant Command — Athena" };

/* Phase 7 preview: the accountability screen Nick asked for, rendered from
   clearly-labeled demo fixtures. Reorganized 2026-09-01 around his consult-
   first priorities: speed to consultation (assignment → completed consult),
   3 real consults per consultant per week, and a CQ in hand before every
   consult. Live wiring lands with Phase 7. */

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

export default function ConsultantsPreviewPage() {
  const totalStage = Object.values(STAGE_MIX).reduce((a, b) => a + b, 0);
  const num = "tabular-nums" as const;
  const assigned = CONSULT_FUNNEL[0]?.count ?? 1;
  const missingCq = UPCOMING_CONSULTS.filter((c) => c.cq === "missing").length;

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

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Consultant Command</h1>
          <p className="mt-1 text-sm text-[#8B95A7]">
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

      {/* KPI row — consult-first */}
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {[
          { label: "Speed to consult", value: KPIS.speedToConsult, sub: "median, assignment → consult held", hero: true },
          { label: "Real consults (wk)", value: `${KPIS.consultsThisWeek} / ${KPIS.consultTargetThisWeek}`, sub: `target ${WEEKLY_CONSULT_TARGET} per consultant` },
          { label: "CQ before consult", value: `${KPIS.cqBeforeConsultRate}%`, sub: `${missingCq} upcoming missing`, alert: missingCq > 0 },
          { label: "Median first touch", value: KPIS.medianFirstTouch },
          { label: "Show rate", value: `${KPIS.showRate}%` },
          { label: "SLA breaches (48h)", value: String(KPIS.slaBreaches48h), alert: KPIS.slaBreaches48h > 0 },
        ].map((k) => (
          <div
            key={k.label}
            className={`rounded-xl border p-4 ${"hero" in k && k.hero ? "border-indigo-500/40 bg-indigo-500/10" : "border-[#1E2635] bg-[#121826]"}`}
          >
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[#64748B]">{k.label}</div>
            <div className={`mt-1 text-2xl font-semibold ${"alert" in k && k.alert ? "text-red-400" : ""}`} style={{ fontVariantNumeric: num }}>
              {k.value}
            </div>
            {"sub" in k && k.sub && (
              <div className={`mt-0.5 text-[10px] ${"alert" in k && k.alert ? "text-red-400/80" : "text-[#64748B]"}`}>{k.sub}</div>
            )}
          </div>
        ))}
      </div>

      {/* executive summary */}
      <section className="mt-6 rounded-xl border border-indigo-500/20 bg-gradient-to-r from-[#101A33] to-[#131A3A] p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#8B95A7]">
            Athena executive summary
          </h2>
          <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
            Demo
          </span>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-[#C3CCDB]">
          Good morning. {KPIS.consultsThisWeek} real consults completed this week against a roster
          target of {KPIS.consultTargetThisWeek}; median speed to consultation is {KPIS.speedToConsult} from
          assignment. {KPIS.cqBeforeConsultRate}% of consults had the CQ in hand first — {missingCq} upcoming
          consults are missing one and are being chased. Fastest to the table is Rob Petka at 1d 18h with 4
          consults, all CQ-backed. Attention required: Aaron Bakken has zero consults this week and 2
          assignments past the 48-hour no-touch wall; take-back and rerouting run automatically, and his
          allocation drops until response times recover.
        </p>
      </section>

      {/* assignment → consultation funnel */}
      <section className="mt-6 rounded-xl border border-[#1E2635] bg-[#121826] p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#8B95A7]">
            Assignment → consultation
          </h2>
          <span className="text-[11px] text-[#64748B]">medians are elapsed time from assignment</span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
          {CONSULT_FUNNEL.map((step, i) => (
            <div key={step.label} className="relative rounded-lg border border-[#1E2635] bg-[#0F1522] p-3">
              <div className="flex items-baseline gap-1.5">
                <span className="text-xl font-semibold" style={{ fontVariantNumeric: num }}>{step.count}</span>
                <span className="text-[11px] text-[#64748B]" style={{ fontVariantNumeric: num }}>
                  {Math.round((step.count / assigned) * 100)}%
                </span>
              </div>
              <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#8B95A7]">
                {step.label}
              </div>
              <div className="mt-1.5 h-1 rounded-full bg-[#1B2333]">
                <div
                  className="h-1 rounded-full bg-gradient-to-r from-indigo-500 to-cyan-400"
                  style={{ width: `${(step.count / assigned) * 100}%` }}
                />
              </div>
              <div className="mt-1.5 text-[10px] text-[#64748B]" style={{ fontVariantNumeric: num }}>
                {step.median ? `median ${step.median}` : i === 0 ? "clock starts here" : " "}
              </div>
            </div>
          ))}
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
            Persistent agents. Placeholder avatars — real persona images upload via admin later.
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
