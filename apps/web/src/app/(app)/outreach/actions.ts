"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@athena/db";
import { approveDraft, LlmGateway, rejectAndRewrite } from "@athena/core";
import { AnthropicProvider } from "@athena/llm-anthropic";
import { supabaseServer } from "@/lib/supabase/server";

// 100% human approval queue. Approval is a role-gated human action; the role
// check lives in the action because the write goes through the service
// connection (RLS does not protect it).
const APPROVE_ROLES = new Set(["super_admin", "fcc_admin", "manager"]);

export interface ReviewActionResult {
  ok: boolean;
  error?: string;
  detail?: string;
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

/** Reject with the reviewer's note; by default the writer produces the next version from it right away. */
export async function reject(draftId: string, reason: string, rewrite = true): Promise<ReviewActionResult> {
  const who = await reviewer();
  if ("error" in who) return { ok: false, error: who.error };
  const note = reason.trim();
  if (rewrite && !note) return { ok: false, error: "Say what should change, so the rewrite has something to go on." };
  if (rewrite && !process.env.ANTHROPIC_API_KEY) return { ok: false, error: "ANTHROPIC_API_KEY is not configured; reject without rewrite instead." };
  const db = getDb();
  const res = await rejectAndRewrite(db, new LlmGateway(new AnthropicProvider(), db), {
    orgId: who.orgId, draftId, userId: who.userId, reason: note || "rejected in review", rewrite,
  });
  revalidatePath("/outreach");
  if (!res.ok) return { ok: false, error: res.reason };
  if (res.rewritten) return { ok: true, detail: `Rewritten (version ${res.attempt + 1}) — the new draft is in the queue.` };
  if (res.reason === "max_rewrites") return { ok: true, detail: `Rejected. This person has been rewritten ${res.attempt - 1} times already, so no new draft; handle by hand or exclude them.` };
  if (res.reason === "not_requested") return { ok: true, detail: "Rejected." };
  return { ok: true, detail: `Rejected; rewrite skipped (${res.reason}).` };
}
