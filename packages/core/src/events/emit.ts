import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { agentJob, event } from "@athena/db/schema";

/**
 * Any drizzle Postgres handle — the `tx` from db.transaction(), or the root
 * db for events with no accompanying state change. Covers both the
 * postgres-js driver (production) and PGlite (tests).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EmitTx = PgDatabase<PgQueryResultHKT, any, any>;

export interface EmitArgs {
  orgId: string;
  type: string;
  entityType: string;
  entityId?: string;
  actorType?: "system" | "user" | "agent";
  actorId?: string;
  payload?: Record<string, unknown>;
  correlationId?: string;
  /** Jobs to enqueue atomically with the event (transactional outbox). */
  enqueue?: { type: string; payload?: Record<string, unknown> }[];
}

export interface EmitResult {
  eventId: string;
  jobIds: string[];
}

/**
 * Writes an event row and any outbox agent_job rows. MUST be called inside
 * the same transaction as the state change it describes — pass the drizzle
 * `tx`, never the root db, when a state row is involved.
 */
export async function emit(tx: EmitTx, args: EmitArgs): Promise<EmitResult> {
  const [ev] = await tx
    .insert(event)
    .values({
      orgId: args.orgId,
      type: args.type,
      entityType: args.entityType,
      entityId: args.entityId,
      actorType: args.actorType ?? "system",
      actorId: args.actorId,
      payload: args.payload ?? {},
      correlationId: args.correlationId,
    })
    .returning({ id: event.id });
  if (!ev) throw new Error("event insert returned no row");

  const jobIds: string[] = [];
  for (const job of args.enqueue ?? []) {
    const [row] = await tx
      .insert(agentJob)
      .values({
        orgId: args.orgId,
        type: job.type,
        payload: job.payload ?? {},
        correlationId: args.correlationId,
      })
      .returning({ id: agentJob.id });
    if (!row) throw new Error("agent_job insert returned no row");
    jobIds.push(row.id);
  }

  return { eventId: ev.id, jobIds };
}
