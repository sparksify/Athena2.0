import { and, eq } from "drizzle-orm";
import { integrationCredential } from "@athena/db/schema";
import type { EmitTx } from "../events/emit";

/**
 * The GoHighLevel marketplace app's agency credential. Athena stores it
 * once at install and refreshes the access token ahead of its ~24h expiry.
 * The refresher is injected (core never imports an adapter).
 */
export const GHL_PROVIDER = "ghl";
const REFRESH_AHEAD_MS = 10 * 60_000;

export interface GhlRefreshed { accessToken: string; refreshToken: string | null; expiresIn: number; scope: string | null; companyId: string | null }
export type GhlRefresher = (refreshToken: string) => Promise<GhlRefreshed>;

export async function saveGhlCredential(db: EmitTx, args: {
  orgId: string; companyId: string | null; accessToken: string; refreshToken: string | null; expiresIn: number; scope: string | null; installedBy: string | null;
}): Promise<void> {
  const now = new Date();
  const values = {
    orgId: args.orgId, provider: GHL_PROVIDER, externalId: args.companyId, accessToken: args.accessToken, refreshToken: args.refreshToken,
    expiresAt: new Date(now.getTime() + args.expiresIn * 1000), scope: args.scope, installedBy: args.installedBy, updatedAt: now,
  };
  await db.insert(integrationCredential).values(values)
    .onConflictDoUpdate({ target: [integrationCredential.orgId, integrationCredential.provider], set: { ...values, createdAt: undefined } });
}

export interface GhlAgencyAccess { agencyToken: string; companyId: string | null; expiresAt: Date | null; scope: string | null }

/** The current agency access token (refreshed when close to expiry), or null when the app is not installed. */
export async function ghlAgencyAccess(db: EmitTx, orgId: string | undefined, refresh: GhlRefresher | null): Promise<GhlAgencyAccess | null> {
  const [row] = await db.select().from(integrationCredential)
    .where(orgId ? and(eq(integrationCredential.provider, GHL_PROVIDER), eq(integrationCredential.orgId, orgId)) : eq(integrationCredential.provider, GHL_PROVIDER))
    .limit(1);
  if (!row) return null;
  const stale = row.expiresAt != null && row.expiresAt.getTime() - Date.now() < REFRESH_AHEAD_MS;
  if (stale && row.refreshToken && refresh) {
    try {
      const r = await refresh(row.refreshToken);
      const expiresAt = new Date(Date.now() + r.expiresIn * 1000);
      await db.update(integrationCredential).set({
        accessToken: r.accessToken, refreshToken: r.refreshToken ?? row.refreshToken, expiresAt, scope: r.scope ?? row.scope,
        externalId: r.companyId ?? row.externalId, updatedAt: new Date(),
      }).where(eq(integrationCredential.id, row.id));
      return { agencyToken: r.accessToken, companyId: r.companyId ?? row.externalId, expiresAt, scope: r.scope ?? row.scope };
    } catch (err) {
      console.warn(`[ghl] agency token refresh failed: ${String(err)}`);
      if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;
    }
  }
  return { agencyToken: row.accessToken, companyId: row.externalId, expiresAt: row.expiresAt, scope: row.scope };
}

export async function forgetGhlCredential(db: EmitTx, orgId: string): Promise<void> {
  await db.delete(integrationCredential).where(and(eq(integrationCredential.provider, GHL_PROVIDER), eq(integrationCredential.orgId, orgId)));
}
