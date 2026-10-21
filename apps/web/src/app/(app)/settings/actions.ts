"use server";

import { revalidatePath } from "next/cache";
import { and, count, eq, ne } from "drizzle-orm";
import { createClient } from "@supabase/supabase-js";
import { getDb } from "@athena/db";
import { appUser, consultant } from "@athena/db/schema";
import { emit } from "@athena/core";
import { supabaseServer } from "@/lib/supabase/server";
import { SUPABASE_URL } from "@/lib/supabase/config";

import { ROLES, type Role } from "./roles";

const ADMIN_ROLES = new Set<string>(["super_admin", "fcc_admin"]);

export interface SettingsResult { ok: boolean; error?: string; detail?: string }

async function admin() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { data: me } = await supabase.from("user").select("role, org_id").eq("id", user.id).single();
  if (!me || !ADMIN_ROLES.has(me.role)) return { error: "Only admins manage users." };
  if (!process.env.DATABASE_URL) return { error: "DATABASE_URL is not configured." };
  return { userId: user.id, orgId: me.org_id as string, role: me.role as Role };
}

/** Supabase Auth admin client: needs the service-role key, which never reaches the browser. */
function authAdmin() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createClient(SUPABASE_URL, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
export const authAdminConfigured = async () => Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

const appUrl = () => process.env.APP_URL ?? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "athena2-0.vercel.app"}`;

/** Invite by email: Supabase sends the invitation, the signup trigger creates the row, and the role is set here. */
export async function inviteUser(formData: FormData): Promise<SettingsResult> {
  const who = await admin();
  if ("error" in who) return { ok: false, error: who.error };
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const fullName = String(formData.get("full_name") ?? "").trim() || null;
  const role = String(formData.get("role") ?? "read_only") as Role;
  if (!email.includes("@")) return { ok: false, error: "Enter an email address." };
  if (!ROLES.includes(role)) return { ok: false, error: "Unknown role." };
  if (role === "super_admin" && who.role !== "super_admin") return { ok: false, error: "Only a super admin can create another." };
  const auth = authAdmin();
  if (!auth) return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY is not set on Vercel (Supabase → Project Settings → API keys → service_role)." };

  const { data, error } = await auth.auth.admin.inviteUserByEmail(email, { data: { full_name: fullName }, redirectTo: `${appUrl()}/login` });
  if (error) return { ok: false, error: error.message };
  const id = data.user?.id;
  if (!id) return { ok: false, error: "Supabase returned no user id." };
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.insert(appUser).values({ id, orgId: who.orgId, email, fullName, role })
      .onConflictDoUpdate({ target: appUser.id, set: { role, fullName, disabledAt: null } });
    await emit(tx, { orgId: who.orgId, type: "user.invited", entityType: "user", entityId: id, actorType: "user", actorId: who.userId, payload: { email, role } });
  });
  revalidatePath("/settings");
  return { ok: true, detail: `Invitation sent to ${email} as ${role.replace("_", " ")}.` };
}

export async function setUserRole(id: string, role: Role): Promise<SettingsResult> {
  const who = await admin();
  if ("error" in who) return { ok: false, error: who.error };
  if (!ROLES.includes(role)) return { ok: false, error: "Unknown role." };
  if (id === who.userId && role !== who.role) return { ok: false, error: "Change your own role from another admin's login." };
  if (role === "super_admin" && who.role !== "super_admin") return { ok: false, error: "Only a super admin can grant super admin." };
  const db = getDb();
  const [target] = await db.select({ role: appUser.role }).from(appUser).where(and(eq(appUser.id, id), eq(appUser.orgId, who.orgId))).limit(1);
  if (!target) return { ok: false, error: "User not found." };
  if (target.role === "super_admin" && role !== "super_admin") {
    const [n] = await db.select({ n: count() }).from(appUser).where(and(eq(appUser.orgId, who.orgId), eq(appUser.role, "super_admin"), ne(appUser.id, id)));
    if (!n?.n) return { ok: false, error: "That is the last super admin." };
  }
  await db.transaction(async (tx) => {
    await tx.update(appUser).set({ role }).where(eq(appUser.id, id));
    await emit(tx, { orgId: who.orgId, type: "user.role_changed", entityType: "user", entityId: id, actorType: "user", actorId: who.userId, payload: { from: target.role, to: role } });
  });
  revalidatePath("/settings");
  return { ok: true, detail: "Role updated." };
}

/** Remove the login. The row stays (approvals and installs point at it) marked disabled; consultant links are cleared. */
export async function removeUser(id: string): Promise<SettingsResult> {
  const who = await admin();
  if ("error" in who) return { ok: false, error: who.error };
  if (id === who.userId) return { ok: false, error: "You cannot remove yourself." };
  const auth = authAdmin();
  if (!auth) return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY is not set on Vercel." };
  const db = getDb();
  const [target] = await db.select({ role: appUser.role, email: appUser.email }).from(appUser).where(and(eq(appUser.id, id), eq(appUser.orgId, who.orgId))).limit(1);
  if (!target) return { ok: false, error: "User not found." };
  if (target.role === "super_admin") return { ok: false, error: "Demote a super admin before removing them." };
  const { error } = await auth.auth.admin.deleteUser(id);
  if (error && !/not found/i.test(error.message)) return { ok: false, error: error.message };
  await db.transaction(async (tx) => {
    await tx.update(consultant).set({ userId: null }).where(eq(consultant.userId, id));
    await tx.update(appUser).set({ role: "read_only", disabledAt: new Date() }).where(eq(appUser.id, id));
    await emit(tx, { orgId: who.orgId, type: "user.removed", entityType: "user", entityId: id, actorType: "user", actorId: who.userId, payload: { email: target.email } });
  });
  revalidatePath("/settings");
  return { ok: true, detail: `${target.email} can no longer sign in.` };
}

/** Send the password-reset / magic-link email again for someone who lost the invitation. */
export async function resendInvite(id: string): Promise<SettingsResult> {
  const who = await admin();
  if ("error" in who) return { ok: false, error: who.error };
  const auth = authAdmin();
  if (!auth) return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY is not set on Vercel." };
  const [target] = await getDb().select({ email: appUser.email }).from(appUser).where(and(eq(appUser.id, id), eq(appUser.orgId, who.orgId))).limit(1);
  if (!target) return { ok: false, error: "User not found." };
  const { error } = await auth.auth.admin.generateLink({ type: "recovery", email: target.email, options: { redirectTo: `${appUrl()}/login` } });
  if (error) return { ok: false, error: error.message };
  const { error: e2 } = await auth.auth.resetPasswordForEmail(target.email, { redirectTo: `${appUrl()}/login` });
  if (e2) return { ok: false, error: e2.message };
  return { ok: true, detail: `Password-reset email sent to ${target.email}.` };
}
