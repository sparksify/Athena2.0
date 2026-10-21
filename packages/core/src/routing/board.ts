import { sql } from "drizzle-orm";
import type { OpportunityStage } from "@athena/db/schema";
import type { EmitTx } from "../events/emit";
import { rows } from "../db-rows";
import { NUDGE_LADDER, TAKE_BACK_AFTER_MS } from "../accountability/ladder";
import { STAGE_LABELS, PIPELINE_STAGES } from "../accountability/stages";
import { consultantStats, startOfWeek } from "./stats";
import type { ConsultantStats } from "./types";

export type SlaState = "on_track" | "nudged" | "escalated" | "take_back";
export const WEEKLY_CONSULT_TARGET = 3;

export interface BoardConsultant {
  id: string; name: string; avatarSlug: string | null; status: "active" | "paused";
  activeLoad: number; maxLoad: number; stats: ConsultantStats; sla: SlaState; brands: string[];
}
export interface BoardLead {
  assignmentId: string; candidateId: string; lead: string; email: string | null; brand: string | null;
  agent: string | null; stage: OpportunityStage; stageLabel: string; daysInStage: number; sla: SlaState;
  hoursSinceAssign: number; firstTouchAt: Date | null; status: string;
}
export interface BoardAppointment {
  id: string; lead: string; consultant: string; consultantId: string; startsAt: Date; cq: "received" | "missing"; agent: string | null; status: string;
}
export interface Board {
  hasData: boolean;
  consultants: BoardConsultant[];
  ownership: { consultantId: string; consultant: string; leads: BoardLead[] }[];
  upcoming: BoardAppointment[];
  awaitingDisposition: BoardAppointment[];
  takeBackQueue: { assignmentId: string; lead: string; consultant: string; agent: string | null; hoursSinceAssign: number }[];
  slaCounts: Record<SlaState, number>;
  stageMix: Record<OpportunityStage, number>;
  funnel: { label: string; count: number; medianHours: number | null }[];
  agents: { id: string; name: string; avatarSlug: string | null; handoffs: number; activeAssignments: number; address: string | null }[];
  kpis: {
    speedToConsultHours: number | null; consultsThisWeek: number; consultTargetThisWeek: number; cqBeforeConsultRate: number | null;
    liveOpportunities: number; pipelineValue: number; medianFirstTouchHours: number | null; showRate: number | null;
    slaBreaches48h: number; takeBacks30d: number; positiveReplies: number; handoffs: number;
  };
}

/** SLA state of one live assignment awaiting first touch. */
export function slaFor(a: { firstTouchAt: Date | null; offeredAt: Date; status: string }, now: Date): SlaState {
  if (a.status === "taken_back") return "take_back";
  if (a.firstTouchAt) return "on_track";
  const elapsed = now.getTime() - a.offeredAt.getTime();
  if (elapsed >= TAKE_BACK_AFTER_MS) return "take_back";
  if (elapsed >= NUDGE_LADDER[2]!.afterMs) return "escalated";
  if (elapsed >= NUDGE_LADDER[0]!.afterMs) return "nudged";
  return "on_track";
}

const worst = (states: SlaState[]): SlaState => {
  const order: SlaState[] = ["take_back", "escalated", "nudged", "on_track"];
  return order.find((s) => states.includes(s)) ?? "on_track";
};

/** Everything the Consultant Command board shows, from live tables only. */
export async function loadBoard(db: EmitTx, orgId: string, now = new Date()): Promise<Board> {
  const [stats, consultants, live, appts, stageRows, funnelRow, personas, replies] = await Promise.all([
    consultantStats(db, orgId, now),
    rows<{ id: string; name: string; avatar_slug: string | null; status: "active" | "paused"; max_load: number; active_load: number }>(await db.execute(sql`
      select c.id, c.name, c.avatar_slug, c.status, c.max_load,
        (select count(*)::int from assignment a where a.consultant_id = c.id and a.status in ('offered','accepted')) as active_load
      from consultant c where c.org_id = ${orgId} order by c.name`)),
    rows<{
      id: string; candidate_id: string; consultant_id: string; status: string; offered_at: string; first_touch_at: string | null;
      lead: string | null; email: string | null; agent: string | null; stage: OpportunityStage | null; stage_updated_at: string | null; brand: string | null;
    }>(await db.execute(sql`
      select a.id, a.candidate_id, a.consultant_id, a.status, a.offered_at, a.first_touch_at,
        cand.full_name as lead, cand.primary_email as email, p.name as agent,
        o.stage, o.stage_updated_at,
        (select ca.value #>> '{}' from candidate_attribute ca where ca.candidate_id = a.candidate_id and ca.superseded_by_id is null
           and ca.key in ('brand','campaign_brand','franchise_interest','interest') order by ca.created_at desc limit 1) as brand
      from assignment a
      join candidate cand on cand.id = a.candidate_id
      left join persona_mailbox p on p.id = a.persona_mailbox_id
      left join opportunity o on o.candidate_id = a.candidate_id and o.stage not in ('closed_funded','closed_lost')
      where a.org_id = ${orgId} and a.status in ('offered','accepted')
      order by a.offered_at desc`)),
    rows<{ id: string; lead: string | null; consultant: string; consultant_id: string; starts_at: string; status: string; has_cq: boolean; has_disposition: boolean; agent: string | null; ends_at: string }>(await db.execute(sql`
      select ap.id, cand.full_name as lead, c.name as consultant, c.id as consultant_id, ap.starts_at, ap.ends_at, ap.status,
        exists (select 1 from questionnaire q where q.candidate_id = ap.candidate_id and q.kind = 'cq_complete') as has_cq,
        exists (select 1 from disposition d where d.appointment_id = ap.id) as has_disposition,
        (select p.name from assignment a join persona_mailbox p on p.id = a.persona_mailbox_id
           where a.candidate_id = ap.candidate_id order by a.offered_at desc limit 1) as agent
      from appointment ap join candidate cand on cand.id = ap.candidate_id join consultant c on c.id = ap.consultant_id
      where ap.org_id = ${orgId} and ap.kind = 'consultation' and ap.status = 'scheduled'
        and ap.starts_at between ${new Date(now.getTime() - 3 * 86_400_000).toISOString()}::timestamptz and ${new Date(now.getTime() + 7 * 86_400_000).toISOString()}::timestamptz
      order by ap.starts_at`)),
    rows<{ stage: OpportunityStage; n: number; value: number }>(await db.execute(sql`
      select stage, count(*)::int as n, coalesce(sum(value_usd), 0)::float as value from opportunity where org_id = ${orgId} group by stage`)),
    rows<{ assigned: number; touched: number; cq: number; consults: number; advancing: number; touch_median: number | null; cq_median: number | null; consult_median: number | null }>(await db.execute(sql`
      with a as (select * from assignment where org_id = ${orgId} and offered_at >= ${new Date(now.getTime() - 90 * 86_400_000).toISOString()}::timestamptz),
      t as (select a.id, a.candidate_id, a.offered_at, a.first_touch_at,
              (select min(coalesce(q.completed_at, q.created_at)) from questionnaire q where q.candidate_id = a.candidate_id and q.kind = 'cq_complete' and coalesce(q.completed_at, q.created_at) >= a.offered_at) as cq_at,
              (select min(ap.starts_at) from appointment ap join disposition d on d.appointment_id = ap.id
                 where ap.candidate_id = a.candidate_id and ap.kind = 'consultation' and ap.status = 'showed' and ap.starts_at >= a.offered_at) as consult_at,
              exists (select 1 from disposition d join appointment ap on ap.id = d.appointment_id
                 where ap.candidate_id = a.candidate_id and d.code = '1' and ap.starts_at >= a.offered_at) as advancing
            from a)
      select count(*)::int as assigned,
        count(first_touch_at)::int as touched, count(cq_at)::int as cq, count(consult_at)::int as consults,
        count(*) filter (where advancing)::int as advancing,
        percentile_cont(0.5) within group (order by extract(epoch from (first_touch_at - offered_at))/3600) filter (where first_touch_at is not null) as touch_median,
        percentile_cont(0.5) within group (order by extract(epoch from (cq_at - offered_at))/3600) filter (where cq_at is not null) as cq_median,
        percentile_cont(0.5) within group (order by extract(epoch from (consult_at - offered_at))/3600) filter (where consult_at is not null) as consult_median
      from t`)),
    rows<{ id: string; name: string; avatar_slug: string | null; address: string | null; handoffs: number; active: number }>(await db.execute(sql`
      select p.id, p.name, p.avatar_slug, p.address,
        (select count(*)::int from assignment a where a.persona_mailbox_id = p.id) as handoffs,
        (select count(*)::int from assignment a where a.persona_mailbox_id = p.id and a.status in ('offered','accepted')) as active
      from persona_mailbox p where p.org_id = ${orgId} order by p.name`)),
    rows<{ n: number }>(await db.execute(sql`
      select count(*)::int as n from message where org_id = ${orgId} and direction = 'inbound' and classification in ('positive','interested')`)),
  ]);

  const leadsByConsultant = new Map<string, BoardLead[]>();
  const takeBackQueue: Board["takeBackQueue"] = [];
  const slaCounts: Record<SlaState, number> = { on_track: 0, nudged: 0, escalated: 0, take_back: 0 };
  const consultantName = new Map(consultants.map((c) => [c.id, c.name]));
  for (const a of live) {
    const offeredAt = new Date(a.offered_at);
    const firstTouchAt = a.first_touch_at ? new Date(a.first_touch_at) : null;
    const sla = slaFor({ firstTouchAt, offeredAt, status: a.status }, now);
    slaCounts[sla] += 1;
    const hoursSinceAssign = (now.getTime() - offeredAt.getTime()) / 3_600_000;
    const stage = a.stage ?? "lead_in";
    const lead: BoardLead = {
      assignmentId: a.id, candidateId: a.candidate_id, lead: a.lead ?? "Unnamed", email: a.email, brand: a.brand, agent: a.agent,
      stage, stageLabel: STAGE_LABELS[stage],
      daysInStage: a.stage_updated_at ? Math.floor((now.getTime() - new Date(a.stage_updated_at).getTime()) / 86_400_000) : 0,
      sla, hoursSinceAssign, firstTouchAt, status: a.status,
    };
    (leadsByConsultant.get(a.consultant_id) ?? leadsByConsultant.set(a.consultant_id, []).get(a.consultant_id)!).push(lead);
    if (!firstTouchAt && hoursSinceAssign >= 24) {
      takeBackQueue.push({ assignmentId: a.id, lead: lead.lead, consultant: consultantName.get(a.consultant_id) ?? "?", agent: a.agent, hoursSinceAssign });
    }
  }
  takeBackQueue.sort((x, y) => y.hoursSinceAssign - x.hoursSinceAssign);

  const boardConsultants: BoardConsultant[] = consultants.map((c) => {
    const leads = leadsByConsultant.get(c.id) ?? [];
    const brands = [...new Set(leads.map((l) => l.brand).filter((b): b is string => Boolean(b)))].slice(0, 3);
    return {
      id: c.id, name: c.name, avatarSlug: c.avatar_slug, status: c.status, activeLoad: Number(c.active_load), maxLoad: c.max_load,
      stats: stats.get(c.id) ?? { offered: 0, accepted: 0, declined: 0, takeBacks30d: 0, firstTouchMedianHours: null, showed: 0, noShow: 0, consultsThisWeek: 0, speedToConsultMedianHours: null, cqBeforeConsultRate: null },
      sla: worst(leads.map((l) => l.sla)), brands,
    };
  }).sort((a, b) => b.activeLoad - a.activeLoad || a.name.localeCompare(b.name));

  const ownership = boardConsultants.filter((c) => (leadsByConsultant.get(c.id) ?? []).length > 0)
    .map((c) => ({ consultantId: c.id, consultant: c.name, leads: leadsByConsultant.get(c.id) ?? [] }));

  const toAppt = (r: (typeof appts)[number]): BoardAppointment => ({
    id: r.id, lead: r.lead ?? "Unnamed", consultant: r.consultant, consultantId: r.consultant_id, startsAt: new Date(r.starts_at),
    cq: r.has_cq ? "received" : "missing", agent: r.agent, status: r.status,
  });
  const upcoming = appts.filter((r) => new Date(r.starts_at) >= now).map(toAppt);
  const awaitingDisposition = appts.filter((r) => new Date(r.ends_at) < now && !r.has_disposition).map(toAppt);

  const stageMix = Object.fromEntries(PIPELINE_STAGES.concat(["closed_lost"]).map((s) => [s, 0])) as Record<OpportunityStage, number>;
  let pipelineValue = 0;
  let liveOpportunities = 0;
  for (const r of stageRows) {
    stageMix[r.stage] = Number(r.n);
    if (r.stage !== "closed_funded" && r.stage !== "closed_lost") { liveOpportunities += Number(r.n); pipelineValue += Number(r.value); }
  }

  const f = funnelRow[0];
  const funnel = [
    { label: "Assigned", count: Number(f?.assigned ?? 0), medianHours: null },
    { label: "First touch", count: Number(f?.touched ?? 0), medianHours: f?.touch_median == null ? null : Number(f.touch_median) },
    { label: "CQ received", count: Number(f?.cq ?? 0), medianHours: f?.cq_median == null ? null : Number(f.cq_median) },
    { label: "Real consult held", count: Number(f?.consults ?? 0), medianHours: f?.consult_median == null ? null : Number(f.consult_median) },
    { label: "Advancing after consult", count: Number(f?.advancing ?? 0), medianHours: null },
  ];

  const all = [...stats.values()];
  const sum = (k: keyof ConsultantStats) => all.reduce((acc, s) => acc + Number(s[k] ?? 0), 0);
  const showed = sum("showed");
  const noShow = sum("noShow");
  const consultsThisWeek = sum("consultsThisWeek");
  const cqRates = all.map((s) => s.cqBeforeConsultRate).filter((x): x is number => x != null);
  const takeBacks30d = sum("takeBacks30d");

  return {
    hasData: live.length > 0 || stageRows.length > 0 || appts.length > 0,
    consultants: boardConsultants,
    ownership, upcoming, awaitingDisposition, takeBackQueue, slaCounts, stageMix, funnel,
    agents: personas.map((p) => ({ id: p.id, name: p.name, avatarSlug: p.avatar_slug, handoffs: Number(p.handoffs), activeAssignments: Number(p.active), address: p.address })),
    kpis: {
      speedToConsultHours: f?.consult_median == null ? null : Number(f.consult_median),
      consultsThisWeek,
      consultTargetThisWeek: boardConsultants.filter((c) => c.status === "active").length * WEEKLY_CONSULT_TARGET,
      cqBeforeConsultRate: cqRates.length ? Math.round((cqRates.reduce((a, b) => a + b, 0) / cqRates.length) * 100) : null,
      liveOpportunities, pipelineValue,
      medianFirstTouchHours: f?.touch_median == null ? null : Number(f.touch_median),
      showRate: showed + noShow > 0 ? Math.round((100 * showed) / (showed + noShow)) : null,
      slaBreaches48h: slaCounts.take_back, takeBacks30d,
      positiveReplies: Number(replies[0]?.n ?? 0), handoffs: sum("offered"),
    },
  };
}

export { startOfWeek };
