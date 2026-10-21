import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDb } from "@athena/db";
import { saveGhlCredential } from "@athena/core";
import { exchangeGhlCode } from "@athena/crm-ghl";
import { supabaseServer } from "@/lib/supabase/server";
import { ghlRedirectUri } from "@/lib/ghl";

export const dynamic = "force-dynamic";

/** GoHighLevel sends the installer back here with ?code=; the code becomes the stored agency credential. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (q: string) => NextResponse.redirect(new URL(`/ops/connections?${q}`, url.origin));
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const jar = await cookies();
  const expected = jar.get("ghl_oauth_state")?.value;
  jar.delete("ghl_oauth_state");
  if (!code) return back(`ghl=error&reason=${encodeURIComponent(url.searchParams.get("error") ?? "no code returned")}`);
  if (!expected || state !== expected) return back("ghl=error&reason=state%20mismatch%20(start%20the%20install%20from%20the%20Connections%20page)");

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = user ? await supabase.from("user").select("role, org_id").eq("id", user.id).single() : { data: null };
  if (!user || !me || !["super_admin", "fcc_admin", "manager"].includes(me.role)) return back("ghl=error&reason=sign%20in%20as%20a%20manager%20first");
  const clientId = process.env.GHL_CLIENT_ID;
  const clientSecret = process.env.GHL_CLIENT_SECRET;
  if (!clientId || !clientSecret || !process.env.DATABASE_URL) return back("ghl=error&reason=GHL_CLIENT_ID%2FGHL_CLIENT_SECRET%20not%20set");

  try {
    const t = await exchangeGhlCode({ clientId, clientSecret, code, redirectUri: ghlRedirectUri() });
    if ((t.userType && t.userType.toLowerCase() !== "company") || (!t.companyId && t.locationId)) {
      return back(`ghl=error&reason=${encodeURIComponent(`GHL installed the app on one sub-account only (${t.locationId ?? t.userType}). Start the install from the agency and choose all sub-accounts.`)}`);
    }
    await saveGhlCredential(getDb(), {
      orgId: me.org_id as string, companyId: t.companyId, accessToken: t.accessToken, refreshToken: t.refreshToken,
      expiresIn: t.expiresIn, scope: t.scope, installedBy: user.id,
    });
    return back("ghl=connected");
  } catch (err) {
    return back(`ghl=error&reason=${encodeURIComponent(String(err instanceof Error ? err.message : err).slice(0, 200))}`);
  }
}
