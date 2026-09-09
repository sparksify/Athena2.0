"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@athena/db";
import { consultant, personaMailbox } from "@athena/db/schema";
import {
  acceptAssignment, declineAssignment, recordDisposition, recordFirstTouch, routeCandidate, takeBackAssignment,
  type DispositionCode, type TouchChannel,
} from "@athena/core";
import { supabaseServer } from "@/lib/supabase/server";

const MANAGER_ROLES = new Set(["super_admin", "fcc_admin", "manager"]);
const WORK_ROLES = new Set([...MANAGER_ROLES, "consultant"]);

export interface ActionResult { ok: boolean; error?: string }

async function actor(roles: Set<string>) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { data: me } = await supabase.from("user").select("role, org_id").eq("id", user.id).single();
  if (!me || !roles.has(me.role)) return { error: `Role '${me?.role ?? "none"}' may not do this.` };
  if (!process.env.DATABASE_URL) return { error: "DATABASE_URL is not configured on this deployment." };
  return { userId: user.id, orgId: me.org_id as string, role: me.role as string, manager: MANAGER_ROLES.has(me.role) };
}

/** Consultants may only act on their own assignments/appointments. */
async function ownsAssignment(who: { userId: string; manager: boolean }, assignmentId: string) {
  if (who.manager) return true;
  const r = await getDb().execute(sql`select 1 from assignment a join consultant c on c.id = a.consultant_id where a.id = ${assignmentId} and c.user_id = ${who.userId}`);
  return (Array.isArray(r) ? r.length : (r as { rows?: unknown[] }).rows?.length ?? 0) > 0;
}
async function ownsAppointment(who: { userId: string; manager: boolean }, appointmentId: string) {
  if (who.manager) return true;
  const r = await getDb().execute(sql`select 1 from appointment a join consultant c on c.id = a.consultant_id where a.id = ${appointmentId} and c.user_id = ${who.userId}`);
  return (Array.isArray(r) ? r.length : (r as { rows?: unknown[] }).rows?.length ?? 0) > 0;
}
const done = (r: { ok: boolean; reason?: string }): ActionResult => (r.ok ? { ok: true } : { ok: false, error: r.reason ?? "failed" });
const refresh = () => { revalidatePath("/consultants"); revalidatePath("/consultants/queue"); revalidatePath("/"); };

export async function accept(assignmentId: string): Promise<ActionResult> {
  const who = await actor(WORK_ROLES);
  if ("error" in who) return { ok: false, error: who.error };
  if (!(await ownsAssignment(who, assignmentId))) return { ok: false, error: "Not your assignment." };
  const r = await acceptAssignment(getDb(), { orgId: who.orgId, assignmentId, actorType: "user", actorId: who.userId });
  refresh();
  return done(r);
}

export async function decline(assignmentId: string, reason: string): Promise<ActionResult> {
  const who = await actor(WORK_ROLES);
  if ("error" in who) return { ok: false, error: who.error };
  if (!(await ownsAssignment(who, assignmentId))) return { ok: false, error: "Not your assignment." };
  const r = await declineAssignment(getDb(), { orgId: who.orgId, assignmentId, reason: reason || undefined, actorType: "user", actorId: who.userId });
  refresh();
  if (r.ok && r.reroute && !r.reroute.assigned) return { ok: true, error: `Declined. No other consultant available (${r.reroute.reason}); flagged for a manager.` };
  return done(r);
}

export async function firstTouch(assignmentId: string, channel: string, note: string): Promise<ActionResult> {
  const who = await actor(WORK_ROLES);
  if ("error" in who) return { ok: false, error: who.error };
  if (!(await ownsAssignment(who, assignmentId))) return { ok: false, error: "Not your assignment." };
  const ch = (["call", "email_sent", "sms", "meeting"] as const).includes(channel as TouchChannel) ? (channel as TouchChannel) : "call";
  const r = await recordFirstTouch(getDb(), { orgId: who.orgId, assignmentId, channel: ch, note: note || undefined, actorType: "user", actorId: who.userId });
  refresh();
  return done(r);
}

export async function disposition(appointmentId: string, code: string, notes: string): Promise<ActionResult> {
  const who = await actor(WORK_ROLES);
  if ("error" in who) return { ok: false, error: who.error };
  if (!(await ownsAppointment(who, appointmentId))) return { ok: false, error: "Not your appointment." };
  if (!["1", "2", "3", "4"].includes(code)) return { ok: false, error: "Unknown code." };
  const r = await recordDisposition(getDb(), { orgId: who.orgId, appointmentId, code: code as DispositionCode, notes: notes || undefined, via: "ui", actorType: "user", actorId: who.userId });
  refresh();
  return done(r);
}

export async function takeBack(assignmentId: string): Promise<ActionResult> {
  const who = await actor(MANAGER_ROLES);
  if ("error" in who) return { ok: false, error: who.error };
  const r = await takeBackAssignment(getDb(), { orgId: who.orgId, assignmentId, reason: "manager", actorType: "user", actorId: who.userId });
  refresh();
  if (r.ok && r.reroute && !r.reroute.assigned) return { ok: true, error: `Taken back. No other consultant available (${r.reroute.reason}).` };
  return done(r);
}

/** Manual handoff from the candidate 360 / queue: runs the same rules as a positive reply. */
export async function routeNow(candidateId: string): Promise<ActionResult> {
  const who = await actor(MANAGER_ROLES);
  if ("error" in who) return { ok: false, error: who.error };
  const r = await routeCandidate(getDb(), { orgId: who.orgId, candidateId, trigger: "manual", actorType: "user", actorId: who.userId });
  refresh();
  revalidatePath(`/candidates/${candidateId}`);
  return r.assigned ? { ok: true } : { ok: false, error: r.reason };
}

// ---------------------------------------------------------------- roster

export async function upsertConsultant(formData: FormData): Promise<ActionResult> {
  const who = await actor(MANAGER_ROLES);
  if ("error" in who) return { ok: false, error: who.error };
  const id = String(formData.get("id") ?? "").trim() || null;
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Name is required." };
  const list = (k: string) => String(formData.get(k) ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const values = {
    name,
    email: String(formData.get("email") ?? "").trim().toLowerCase() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
    timezone: String(formData.get("timezone") ?? "").trim() || "America/New_York",
    specialties: list("specialties"),
    territories: list("territories").map((t) => t.toUpperCase()),
    maxLoad: Math.max(1, Number(formData.get("max_load") ?? 20) || 20),
    userId: String(formData.get("user_id") ?? "").trim() || null,
    ghlRef: String(formData.get("ghl_ref") ?? "").trim() || null,
  };
  const db = getDb();
  if (id) await db.update(consultant).set(values).where(and(eq(consultant.id, id), eq(consultant.orgId, who.orgId)));
  else await db.insert(consultant).values({ orgId: who.orgId, ...values, avatarSlug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") });
  revalidatePath("/consultants/roster"); revalidatePath("/consultants");
  return { ok: true };
}

export async function setConsultantStatus(id: string, status: "active" | "paused"): Promise<ActionResult> {
  const who = await actor(MANAGER_ROLES);
  if ("error" in who) return { ok: false, error: who.error };
  await getDb().update(consultant).set({ status }).where(and(eq(consultant.id, id), eq(consultant.orgId, who.orgId)));
  revalidatePath("/consultants/roster"); revalidatePath("/consultants");
  return { ok: true };
}

export async function updatePersona(formData: FormData): Promise<ActionResult> {
  const who = await actor(MANAGER_ROLES);
  if ("error" in who) return { ok: false, error: who.error };
  const id = String(formData.get("id") ?? "");
  const address = String(formData.get("address") ?? "").trim().toLowerCase() || null;
  await getDb().update(personaMailbox).set({
    address,
    domain: address ? address.split("@")[1] ?? null : null,
    signatureHtml: String(formData.get("signature") ?? ""),
    active: formData.get("active") === "on",
  }).where(and(eq(personaMailbox.id, id), eq(personaMailbox.orgId, who.orgId)));
  revalidatePath("/consultants/roster");
  return { ok: true };
}
