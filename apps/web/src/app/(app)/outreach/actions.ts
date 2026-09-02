"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@athena/db";
import { approveDraft, rejectDraft } from "@athena/core";
import { supabaseServer } from "@/lib/supabase/server";

// 100% human approval queue. Approval is a role-gated human action; the role
// check lives in the action because the write goes through the service
// connection (RLS does not protect it).
const APPROVE_ROLES = new Set(["super_admin", "fcc_admin", "manager"]);

export interface ReviewActionResult {
  ok: boolean;
  error?: string;
}

async function reviewer() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { data: me } = await supabase.from("user").select("role, org_id").eq("id", user.id).single();
  if (!me || !APPROVE_ROLES.has(me.role)) {
    return { error: `Role '${me?.role ?? "none"}' may not approve outreach.` };
  }
  if (!process.env.DATABASE_URL) {
    return { error: "DATABASE_URL is not configured on this deployment." };
  }
  return { userId: user.id, orgId: me.org_id as string };
}

export async function approve(draftId: string): Promise<ReviewActionResult> {
  const who = await reviewer();
  if ("error" in who) return { ok: false, error: who.error };
  const res = await approveDraft(getDb(), { orgId: who.orgId, draftId, userId: who.userId });
  revalidatePath("/outreach");
  return res.ok ? { ok: true } : { ok: false, error: res.reason };
}

export async function reject(draftId: string, reason?: string): Promise<ReviewActionResult> {
  const who = await reviewer();
  if ("error" in who) return { ok: false, error: who.error };
  const res = await rejectDraft(getDb(), { orgId: who.orgId, draftId, userId: who.userId, reason });
  revalidatePath("/outreach");
  return res.ok ? { ok: true } : { ok: false, error: res.reason };
}
