"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@athena/db";
import { consultant, personaMailbox } from "@athena/db/schema";
import {
  acceptAssignment, declineAssignment, recordDisposition, recordFirstTouch, routeCandidate, takeBackAssignment,
  type DispositionCode, type TouchChannel,
} from "@athena/core";
import { GhlCrmAdapter } from "@athena/crm-ghl";
import { supabaseServer } from "@/lib/supabase/server";

const MANAGER_ROLES = new Set(["super_admin", "fcc_admin", "manager"]);
const WORK_ROLES = new Set([...MANAGER_ROLES, "consultant"]);

export interface ActionResult { ok: boolean; error?: string; detail?: string }

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

/**
 * The normal way onto the roster: pick the consultant's GHL sub-account.
 * Name, email, phone and timezone come from the sub-account; ghl_ref is set
 * so nudges, the pipeline mirror and lead lookups go to the right place.
 * Re-adding an existing name just links the sub-account.
 */
export async function addConsultantFromSubAccount(locationId: string): Promise<ActionResult> {
  const who = await actor(MANAGER_ROLES);
  if ("error" in who) return { ok: false, error: who.error };
  if (!locationId) return { ok: false, error: "Pick a sub-account." };
  const listed = (await GhlCrmAdapter.listLocations({ scope: [] })).find((l) => l.id === locationId);
  const details = await GhlCrmAdapter.getLocation(locationId).catch(() => null);
  const name = (details?.name ?? listed?.name ?? "").trim();
  if (!name) return { ok: false, error: "That sub-account has no name in GHL." };
  const db = getDb();
  const [existing] = await db.select({ id: consultant.id, ghlRef: consultant.ghlRef }).from(consultant)
    .where(and(eq(consultant.orgId, who.orgId), eq(consultant.name, name))).limit(1);
  if (existing) {
    await db.update(consultant).set({ ghlRef: locationId }).where(eq(consultant.id, existing.id));
  } else {
    await db.insert(consultant).values({
      orgId: who.orgId, name, email: details?.email ?? null, phone: details?.phone ?? null,
      timezone: details?.timezone ?? "America/New_York", ghlRef: locationId,
      avatarSlug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
    });
  }
  revalidatePath("/consultants/roster"); revalidatePath("/consultants");
  return { ok: true, detail: existing ? `${name} linked to the sub-account.` : `${name} added${details?.email ? ` (${details.email})` : ""}. Set their mobile if GHL had none.` };
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

/**
 * Pulls the agency's sub-accounts from GHL and fills ghl_ref for every
 * consultant whose name matches a sub-account name. Never overwrites a
 * value someone typed. Returns what matched and what didn't so the gaps
 * can be filled by hand.
 */
export async function syncGhlSubAccounts(): Promise<ActionResult & { matched?: string[]; filled?: string[]; unmatchedConsultants?: string[]; unmatchedLocations?: string[] }> {
  const who = await actor(MANAGER_ROLES);
  if ("error" in who) return { ok: false, error: who.error };
  if (!process.env.GHL_API_KEY || !(process.env.GHL_COMPANY_ID || process.env.GHL_LOCATION_IDS)) {
    return { ok: false, error: "Set GHL_API_KEY (agency token) and GHL_COMPANY_ID (agency id) first." };
  }
  let locations: { id: string; name: string | null }[];
  try { locations = await GhlCrmAdapter.listLocations(); } catch (err) { return { ok: false, error: String(err) }; }
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z]/g, "");
  const db = getDb();
  const rows = await db.select({ id: consultant.id, name: consultant.name, ghlRef: consultant.ghlRef }).from(consultant).where(eq(consultant.orgId, who.orgId));
  const matched: string[] = [];
  const usedLoc = new Set<string>();
  for (const c of rows) {
    if (c.ghlRef) { usedLoc.add(c.ghlRef); continue; }
    const [first, ...rest] = c.name.split(" ");
    const last = rest.at(-1) ?? "";
    const hit = locations.find((l) => l.name && !usedLoc.has(l.id) && (norm(l.name) === norm(c.name) || (norm(l.name).includes(norm(first ?? "")) && norm(l.name).includes(norm(last)))));
    if (hit) {
      await db.update(consultant).set({ ghlRef: hit.id }).where(eq(consultant.id, c.id));
      usedLoc.add(hit.id);
      matched.push(`${c.name} → ${hit.name}`);
    }
  }
  // Fill blanks (email, phone, timezone) from the sub-account's contact details.
  const filled: string[] = [];
  const linked = await db.select({ id: consultant.id, name: consultant.name, ghlRef: consultant.ghlRef, email: consultant.email, phone: consultant.phone })
    .from(consultant).where(eq(consultant.orgId, who.orgId));
  for (const c of linked) {
    if (!c.ghlRef || (c.email && c.phone)) continue;
    const d = await GhlCrmAdapter.getLocation(c.ghlRef).catch(() => null);
    if (!d) continue;
    const patch: { email?: string; phone?: string; timezone?: string } = {};
    if (!c.email && d.email) patch.email = d.email;
    if (!c.phone && d.phone) patch.phone = d.phone;
    if (d.timezone) patch.timezone = d.timezone;
    if (patch.email || patch.phone) { await db.update(consultant).set(patch).where(eq(consultant.id, c.id)); filled.push(c.name); }
  }
  revalidatePath("/consultants/roster");
  return {
    ok: true,
    matched,
    filled,
    unmatchedConsultants: rows.filter((c) => !c.ghlRef && !matched.some((m) => m.startsWith(c.name))).map((c) => c.name),
    unmatchedLocations: locations.filter((l) => !usedLoc.has(l.id)).map((l) => `${l.name ?? "?"} (${l.id})`),
  };
}
