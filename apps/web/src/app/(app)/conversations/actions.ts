"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@athena/db";
import {
  ALL_CLASSIFICATIONS, assignConversation, closeConversation, humanReply, overrideClassification,
  type Classification,
} from "@athena/core";
import { SmartleadProvider } from "@athena/email-smartlead";
import { supabaseServer } from "@/lib/supabase/server";

const ROLES = new Set(["super_admin", "fcc_admin", "manager", "consultant"]);

export interface ConvActionResult { ok: boolean; error?: string }

async function actor() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { data: me } = await supabase.from("user").select("role, org_id").eq("id", user.id).single();
  if (!me || !ROLES.has(me.role)) return { error: `Role '${me?.role ?? "none"}' may not work conversations.` };
  if (!process.env.DATABASE_URL) return { error: "DATABASE_URL is not configured on this deployment." };
  return { userId: user.id, orgId: me.org_id as string };
}

export async function override(messageId: string, classification: string): Promise<ConvActionResult> {
  const who = await actor();
  if ("error" in who) return { ok: false, error: who.error };
  if (!(ALL_CLASSIFICATIONS as readonly string[]).includes(classification)) return { ok: false, error: "Unknown class." };
  const r = await overrideClassification(getDb(), { orgId: who.orgId, messageId, classification: classification as Classification, userId: who.userId });
  revalidatePath("/conversations");
  return r.ok ? { ok: true } : { ok: false, error: r.reason };
}

export async function reply(conversationId: string, formData: FormData): Promise<ConvActionResult> {
  const who = await actor();
  if ("error" in who) return { ok: false, error: who.error };
  const subject = String(formData.get("subject") ?? "").trim();
  const bodyText = String(formData.get("body") ?? "").trim();
  if (!subject || !bodyText) return { ok: false, error: "Subject and message are required." };
  if (!process.env.SMARTLEAD_API_KEY || !process.env.SMARTLEAD_API_CAMPAIGN_ID) {
    return { ok: false, error: "Sending isn't configured yet (Smartlead credentials)." };
  }
  const r = await humanReply(getDb(), new SmartleadProvider(), { orgId: who.orgId, conversationId, subject, bodyText, userId: who.userId });
  revalidatePath("/conversations");
  return r.ok ? { ok: true } : { ok: false, error: r.reason };
}

export async function close(conversationId: string): Promise<ConvActionResult> {
  const who = await actor();
  if ("error" in who) return { ok: false, error: who.error };
  await closeConversation(getDb(), { orgId: who.orgId, conversationId, userId: who.userId, reason: "closed in review" });
  revalidatePath("/conversations");
  return { ok: true };
}

export async function takeIt(conversationId: string): Promise<ConvActionResult> {
  const who = await actor();
  if ("error" in who) return { ok: false, error: who.error };
  await assignConversation(getDb(), { orgId: who.orgId, conversationId, assigneeId: who.userId, userId: who.userId });
  revalidatePath("/conversations");
  return { ok: true };
}
