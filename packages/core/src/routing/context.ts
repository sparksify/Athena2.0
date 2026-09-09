import { and, eq, isNull, sql } from "drizzle-orm";
import { candidate, candidateAttribute, consultant as consultantTable } from "@athena/db/schema";
import type { EmitTx } from "../events/emit";
import { rows } from "../db-rows";
import { consultantStats, statsFor } from "./stats";
import type { RoutingConsultant, RoutingContext } from "./types";

const INTEREST_KEYS = new Set(["interest", "interests", "brand", "brands", "industry", "franchise_category", "category", "campaign_brand"]);

/** Loads everything the rules need in a handful of queries. */
export async function buildRoutingContext(
  db: EmitTx,
  args: { orgId: string; candidateId: string; now?: Date },
): Promise<{ ctx: RoutingContext; consultants: RoutingConsultant[] }> {
  const now = args.now ?? new Date();
  const [cand] = await db
    .select({ id: candidate.id, score: candidate.currentScore, state: candidate.state })
    .from(candidate)
    .where(and(eq(candidate.orgId, args.orgId), eq(candidate.id, args.candidateId)))
    .limit(1);
  if (!cand) throw new Error("candidate not found");

  const attrs = await db
    .select({ key: candidateAttribute.key, value: candidateAttribute.value })
    .from(candidateAttribute)
    .where(and(eq(candidateAttribute.candidateId, args.candidateId), isNull(candidateAttribute.supersededById)));
  const interests: string[] = [];
  for (const a of attrs) {
    if (!INTEREST_KEYS.has(a.key)) continue;
    const v = a.value;
    const vals = Array.isArray(v) ? v : [v];
    for (const x of vals) if (typeof x === "string" && x.trim()) interests.push(x.trim().toLowerCase());
  }

  const prior = rows<{ consultant_id: string }>(
    await db.execute(sql`select distinct consultant_id from interaction where candidate_id = ${args.candidateId} and consultant_id is not null`),
  ).map((r) => r.consultant_id);

  const [consultantRows, loads, stats] = await Promise.all([
    db.select().from(consultantTable).where(eq(consultantTable.orgId, args.orgId)),
    db.execute(sql`
      select consultant_id,
        count(*) filter (where status in ('offered', 'accepted'))::int as active_load,
        max(offered_at) as last_assigned_at
      from assignment where org_id = ${args.orgId} group by consultant_id`),
    consultantStats(db, args.orgId, now),
  ]);
  const loadMap = new Map(
    rows<{ consultant_id: string; active_load: number; last_assigned_at: string | Date | null }>(loads).map((r) => [
      r.consultant_id,
      { activeLoad: Number(r.active_load), lastAssignedAt: r.last_assigned_at ? new Date(r.last_assigned_at) : null },
    ]),
  );

  const consultants: RoutingConsultant[] = consultantRows.map((c) => ({
    id: c.id,
    name: c.name,
    userId: c.userId,
    status: c.status,
    maxLoad: c.maxLoad,
    activeLoad: loadMap.get(c.id)?.activeLoad ?? 0,
    specialties: c.specialties ?? [],
    territories: c.territories ?? [],
    lastAssignedAt: loadMap.get(c.id)?.lastAssignedAt ?? null,
    stats: statsFor(stats, c.id),
  }));

  return {
    ctx: { candidate: { id: cand.id, score: cand.score == null ? null : Number(cand.score), state: cand.state, interests, priorConsultantIds: prior }, now },
    consultants,
  };
}
