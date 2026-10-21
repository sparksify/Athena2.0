import { sql } from "drizzle-orm";
import type { EmitTx } from "../events/emit";
import { rows } from "../db-rows";
import { EMPTY_STATS, type ConsultantStats } from "./types";

interface StatRow {
  consultant_id: string;
  offered: number; accepted: number; declined: number; take_backs_30d: number;
  first_touch_median_hours: number | null;
  showed: number; no_show: number; consults_this_week: number;
  speed_to_consult_median_hours: number | null;
  cq_before_consult_rate: number | null;
}

/**
 * Per-consultant performance over the last 90 days, computed from the
 * assignment/appointment/disposition tables (never from CRM notes). Feeds
 * both the routing reward loop and the Consultant Command board.
 */
export async function consultantStats(db: EmitTx, orgId: string, now = new Date()): Promise<Map<string, ConsultantStats>> {
  // Raw sql templates must carry ISO strings: Drizzle's postgres-js driver passes Date objects through unserialized.
  const since = new Date(now.getTime() - 90 * 86_400_000).toISOString();
  const since30 = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const weekStart = startOfWeek(now).toISOString();
  const result = await db.execute(sql`
    with a as (
      select consultant_id,
        count(*)::int as offered,
        count(*) filter (where status = 'accepted' or first_touch_at is not null)::int as accepted,
        count(*) filter (where status = 'declined')::int as declined,
        count(*) filter (where status = 'taken_back' and ended_at >= ${since30}::timestamptz)::int as take_backs_30d,
        percentile_cont(0.5) within group (order by extract(epoch from (first_touch_at - offered_at)) / 3600)
          filter (where first_touch_at is not null) as first_touch_median_hours
      from assignment
      where org_id = ${orgId} and offered_at >= ${since}::timestamptz
      group by consultant_id
    ),
    ap as (
      select ap.consultant_id,
        count(*) filter (where ap.status = 'showed')::int as showed,
        count(*) filter (where ap.status = 'no_show')::int as no_show,
        count(*) filter (where ap.status = 'showed' and ap.kind = 'consultation' and d.id is not null
                           and ap.starts_at >= ${weekStart}::timestamptz)::int as consults_this_week,
        percentile_cont(0.5) within group (order by extract(epoch from (ap.starts_at - asg.offered_at)) / 3600)
          filter (where ap.status = 'showed' and ap.kind = 'consultation' and d.id is not null and asg.offered_at is not null)
          as speed_to_consult_median_hours,
        avg(case when exists (select 1 from questionnaire q where q.candidate_id = ap.candidate_id
                              and q.kind = 'cq_complete' and coalesce(q.completed_at, q.created_at) <= ap.starts_at)
                 then 1.0 else 0.0 end)
          filter (where ap.status = 'showed' and ap.kind = 'consultation' and d.id is not null)
          as cq_before_consult_rate
      from appointment ap
      left join disposition d on d.appointment_id = ap.id
      left join assignment asg on asg.id = (
        select id from assignment x where x.candidate_id = ap.candidate_id and x.consultant_id = ap.consultant_id
        order by offered_at desc limit 1)
      where ap.org_id = ${orgId} and ap.starts_at >= ${since}::timestamptz
      group by ap.consultant_id
    )
    select c.id as consultant_id,
      coalesce(a.offered, 0) as offered, coalesce(a.accepted, 0) as accepted, coalesce(a.declined, 0) as declined,
      coalesce(a.take_backs_30d, 0) as take_backs_30d, a.first_touch_median_hours,
      coalesce(ap.showed, 0) as showed, coalesce(ap.no_show, 0) as no_show,
      coalesce(ap.consults_this_week, 0) as consults_this_week,
      ap.speed_to_consult_median_hours, ap.cq_before_consult_rate
    from consultant c
    left join a on a.consultant_id = c.id
    left join ap on ap.consultant_id = c.id
    where c.org_id = ${orgId}
  `);
  const out = new Map<string, ConsultantStats>();
  for (const r of rows<StatRow>(result)) {
    out.set(r.consultant_id, {
      offered: Number(r.offered), accepted: Number(r.accepted), declined: Number(r.declined),
      takeBacks30d: Number(r.take_backs_30d),
      firstTouchMedianHours: r.first_touch_median_hours == null ? null : Number(r.first_touch_median_hours),
      showed: Number(r.showed), noShow: Number(r.no_show), consultsThisWeek: Number(r.consults_this_week),
      speedToConsultMedianHours: r.speed_to_consult_median_hours == null ? null : Number(r.speed_to_consult_median_hours),
      cqBeforeConsultRate: r.cq_before_consult_rate == null ? null : Number(r.cq_before_consult_rate),
    });
  }
  return out;
}

export function statsFor(map: Map<string, ConsultantStats>, id: string): ConsultantStats {
  return map.get(id) ?? EMPTY_STATS;
}

/** Monday 00:00 in server time — the weekly consult target resets here. */
export function startOfWeek(now: Date): Date {
  const d = new Date(now);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d;
}
