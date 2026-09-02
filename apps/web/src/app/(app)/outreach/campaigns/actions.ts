"use server";

import { revalidatePath } from "next/cache";
import { and, eq, gte, isNotNull, isNull } from "drizzle-orm";
import { getDb } from "@athena/db";
import {
  angle as angleTable, campaign, campaignMembership, candidate, mailbox,
} from "@athena/db/schema";
import { addSuppression, draftOutreach, emit, LlmGateway } from "@athena/core";
import { AnthropicProvider } from "@athena/llm-anthropic";
import { supabaseServer } from "@/lib/supabase/server";

// Same role gate as approval: these writes go through the service connection.
const MANAGE_ROLES = new Set(["super_admin", "fcc_admin", "manager"]);

export interface ManageResult {
  ok: boolean;
  error?: string;
  detail?: string;
}

async function operator() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { data: me } = await supabase.from("user").select("role, org_id").eq("id", user.id).single();
  if (!me || !MANAGE_ROLES.has(me.role)) {
    return { error: `Role '${me?.role ?? "none"}' may not manage outreach.` };
  }
  if (!process.env.DATABASE_URL) {
    return { error: "DATABASE_URL is not configured on this deployment." };
  }
  return { userId: user.id, orgId: me.org_id as string };
}

/** Create a campaign and enroll the cohort: scored ≥ minScore, has an email,
 *  not merged. Suppression/verification re-check at draft and send time. */
export async function createCampaign(formData: FormData): Promise<ManageResult> {
  const who = await operator();
  if ("error" in who) return { ok: false, error: who.error };
  const name = String(formData.get("name") ?? "").trim();
  const minScore = Number(formData.get("minScore") ?? 50);
  if (!name) return { ok: false, error: "Name the campaign." };
  if (!Number.isFinite(minScore) || minScore < 0 || minScore > 100) {
    return { ok: false, error: "Minimum score must be 0–100." };
  }

  const db = getDb();
  const cohort = await db
    .select({ id: candidate.id })
    .from(candidate)
    .where(
      and(
        eq(candidate.orgId, who.orgId),
        isNull(candidate.mergedIntoId),
        isNotNull(candidate.primaryEmail),
        gte(candidate.currentScore, minScore),
      ),
    )
    .limit(5000);
  if (cohort.length === 0) return { ok: false, error: `No candidates with score ≥ ${minScore}.` };

  await db.transaction(async (tx) => {
    const [camp] = await tx
      .insert(campaign)
      .values({ orgId: who.orgId, name, cohortDefinition: { minScore } })
      .returning({ id: campaign.id });
    if (!camp) throw new Error("campaign insert returned no row");
    await tx
      .insert(campaignMembership)
      .values(cohort.map((c) => ({ orgId: who.orgId, campaignId: camp.id, candidateId: c.id })))
      .onConflictDoNothing();
    await emit(tx, {
      orgId: who.orgId,
      type: "campaign.created",
      entityType: "campaign",
      entityId: camp.id,
      actorType: "user",
      actorId: who.userId,
      payload: { name, minScore, members: cohort.length },
    });
  });
  revalidatePath("/outreach/campaigns");
  return { ok: true, detail: `${cohort.length} candidates enrolled.` };
}

export async function setCampaignStatus(
  campaignId: string,
  status: "active" | "paused" | "done",
): Promise<ManageResult> {
  const who = await operator();
  if ("error" in who) return { ok: false, error: who.error };
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(campaign)
      .set({ status })
      .where(and(eq(campaign.id, campaignId), eq(campaign.orgId, who.orgId)));
    await emit(tx, {
      orgId: who.orgId,
      type: "campaign.status_changed",
      entityType: "campaign",
      entityId: campaignId,
      actorType: "user",
      actorId: who.userId,
      payload: { status },
    });
  });
  revalidatePath("/outreach/campaigns");
  return { ok: true };
}

/** Draft up to `limit` pending members. Requires ANTHROPIC_API_KEY. */
export async function draftBatch(campaignId: string, limit = 10): Promise<ManageResult> {
  const who = await operator();
  if ("error" in who) return { ok: false, error: who.error };
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, error: "ANTHROPIC_API_KEY is not configured — add it in Vercel env settings." };
  }
  const db = getDb();
  const [ang] = await db
    .select({ id: angleTable.id })
    .from(angleTable)
    .where(and(eq(angleTable.orgId, who.orgId), eq(angleTable.active, true)))
    .limit(1);
  if (!ang) return { ok: false, error: "No active angle. Add one first." };

  const members = await db
    .select({ candidateId: campaignMembership.candidateId })
    .from(campaignMembership)
    .where(
      and(
        eq(campaignMembership.campaignId, campaignId),
        eq(campaignMembership.orgId, who.orgId),
        eq(campaignMembership.status, "pending"),
      ),
    )
    .limit(Math.min(limit, 20));
  if (members.length === 0) return { ok: false, error: "No pending members left to draft." };

  const gateway = new LlmGateway(new AnthropicProvider(), db);
  let drafted = 0;
  let skipped = 0;
  for (const m of members) {
    const res = await draftOutreach(db, gateway, {
      orgId: who.orgId,
      campaignId,
      candidateId: m.candidateId,
      angleId: ang.id,
    });
    if (res.drafted) drafted += 1;
    else skipped += 1;
  }
  revalidatePath("/outreach/campaigns");
  revalidatePath("/outreach");
  return { ok: true, detail: `${drafted} drafted, ${skipped} skipped → approval queue.` };
}

export async function addMailbox(formData: FormData): Promise<ManageResult> {
  const who = await operator();
  if ("error" in who) return { ok: false, error: who.error };
  const address = String(formData.get("address") ?? "").trim().toLowerCase();
  const externalRef = String(formData.get("externalRef") ?? "").trim();
  const dailyCap = Number(formData.get("dailyCap") ?? 30);
  if (!address.includes("@")) return { ok: false, error: "Enter the mailbox address." };
  const domain = address.split("@")[1]!;
  const db = getDb();
  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(mailbox)
      .values({
        orgId: who.orgId,
        provider: "smartlead",
        address,
        domain,
        dailyCap: Number.isFinite(dailyCap) ? dailyCap : 30,
        externalRef: externalRef || null,
      })
      .onConflictDoNothing()
      .returning({ id: mailbox.id });
    if (row) {
      await emit(tx, {
        orgId: who.orgId,
        type: "mailbox.added",
        entityType: "mailbox",
        entityId: row.id,
        actorType: "user",
        actorId: who.userId,
        payload: { address, dailyCap },
      });
    }
  });
  revalidatePath("/outreach/campaigns");
  return { ok: true };
}

export async function setMailboxStatus(
  mailboxId: string,
  status: "warming" | "active" | "paused",
): Promise<ManageResult> {
  const who = await operator();
  if ("error" in who) return { ok: false, error: who.error };
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(mailbox)
      .set({ status })
      .where(and(eq(mailbox.id, mailboxId), eq(mailbox.orgId, who.orgId)));
    await emit(tx, {
      orgId: who.orgId,
      type: "mailbox.status_changed",
      entityType: "mailbox",
      entityId: mailboxId,
      actorType: "user",
      actorId: who.userId,
      payload: { status },
    });
  });
  revalidatePath("/outreach/campaigns");
  return { ok: true };
}

/** Manual suppression — same hard gate the webhooks feed. */
export async function suppressManually(formData: FormData): Promise<ManageResult> {
  const who = await operator();
  if ("error" in who) return { ok: false, error: who.error };
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const reason = String(formData.get("reason") ?? "manual").trim() || "manual";
  if (!email.includes("@")) return { ok: false, error: "Enter an email address." };
  const db = getDb();
  const id = await db.transaction((tx) =>
    addSuppression(tx, { orgId: who.orgId, channel: "email", identifier: email, reason, source: "operator" }),
  );
  revalidatePath("/outreach/campaigns");
  revalidatePath("/outreach");
  return id ? { ok: true } : { ok: true, detail: "Already suppressed." };
}
