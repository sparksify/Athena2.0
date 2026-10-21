import { getDb } from "@athena/db";
import { ghlAgencyAccess, type GhlAgencyAccess } from "@athena/core";
import { refreshGhlAccess } from "@athena/crm-ghl";

/** The installed GoHighLevel app's agency credential, refreshed as needed; null when not configured or not installed. */
export async function ghlAgency(orgId?: string): Promise<GhlAgencyAccess | null> {
  const clientId = process.env.GHL_CLIENT_ID;
  const clientSecret = process.env.GHL_CLIENT_SECRET;
  if (!process.env.DATABASE_URL) return null;
  return ghlAgencyAccess(getDb(), orgId, clientId && clientSecret
    ? (refreshToken) => refreshGhlAccess({ clientId, clientSecret, refreshToken })
    : null);
}

export const ghlAppConfigured = () => Boolean(process.env.GHL_CLIENT_ID && process.env.GHL_CLIENT_SECRET);

export const ghlRedirectUri = () => `${process.env.APP_URL ?? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "athena2-0.vercel.app"}`}/api/ghl/oauth/callback`;
