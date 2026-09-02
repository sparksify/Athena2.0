import { and, eq } from "drizzle-orm";
import { suppression } from "@athena/db/schema";
import { emit, type EmitTx } from "../events/emit";

export interface AddSuppressionArgs {
  orgId: string;
  channel: "email" | "sms";
  identifier: string;
  reason: string;
  source?: string;
  correlationId?: string;
}

/**
 * Idempotent hard-suppression insert. Returns the new row id, or null when
 * the identifier was already suppressed (no duplicate event is emitted).
 */
export async function addSuppression(tx: EmitTx, args: AddSuppressionArgs): Promise<string | null> {
  const identifier = args.identifier.trim().toLowerCase();
  const rows = await tx
    .insert(suppression)
    .values({
      orgId: args.orgId,
      channel: args.channel,
      identifier,
      reason: args.reason,
      source: args.source,
    })
    .onConflictDoNothing()
    .returning({ id: suppression.id });
  const row = rows[0];
  if (!row) return null;
  await emit(tx, {
    orgId: args.orgId,
    type: "suppression.added",
    entityType: "suppression",
    entityId: row.id,
    payload: { channel: args.channel, identifier, reason: args.reason, source: args.source },
    correlationId: args.correlationId,
  });
  return row.id;
}

/** The hard gate. Called in code before every send — never delegated. */
export async function isSuppressed(
  tx: EmitTx,
  orgId: string,
  channel: "email" | "sms",
  identifier: string,
): Promise<boolean> {
  const rows = await tx
    .select({ id: suppression.id })
    .from(suppression)
    .where(
      and(
        eq(suppression.orgId, orgId),
        eq(suppression.channel, channel),
        eq(suppression.identifier, identifier.trim().toLowerCase()),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
