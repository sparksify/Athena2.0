import { getDb } from "@athena/db";
import { ghlAgencyAccess, type GhlAgencyAccess } from "@athena/core";
import { refreshGhlAccess } from "@athena/crm-ghl";

/** The installed GoHighLevel app's agency credential (refreshed as needed), or null. */
export async function ghlAgency(): Promise<GhlAgencyAccess | null> {
  const clientId = process.env.GHL_CLIENT_ID;
  const clientSecret = process.env.GHL_CLIENT_SECRET;
  return ghlAgencyAccess(getDb(), undefined, clientId && clientSecret ? (refreshToken) => refreshGhlAccess({ clientId, clientSecret, refreshToken }) : null);
}
