import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ghlAuthorizeUrl } from "@athena/crm-ghl";
import { supabaseServer } from "@/lib/supabase/server";
import { ghlRedirectUri } from "@/lib/ghl";

export const dynamic = "force-dynamic";

/** Sends a manager to GoHighLevel to install the Athena app on the agency. */
export async function GET() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = user ? await supabase.from("user").select("role").eq("id", user.id).single() : { data: null };
  if (!["super_admin", "fcc_admin", "manager"].includes(me?.role ?? "")) return NextResponse.json({ error: "managers only" }, { status: 403 });
  const clientId = process.env.GHL_CLIENT_ID;
  if (!clientId) return NextResponse.json({ error: "GHL_CLIENT_ID is not set" }, { status: 503 });
  const state = randomUUID();
  (await cookies()).set("ghl_oauth_state", state, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/ghl/oauth", maxAge: 600 });
  return NextResponse.redirect(ghlAuthorizeUrl({ clientId, redirectUri: ghlRedirectUri(), state }));
}
