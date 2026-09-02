import { and, eq, isNull } from "drizzle-orm";
import {
  angle as angleTable, campaign, campaignMembership, candidate, candidateAttribute, outreachDraft,
} from "@athena/db/schema";
import { emit, type EmitTx } from "../events/emit";
import type { LlmGateway } from "../llm/gateway";
import { isSuppressed } from "./suppress";

export const DRAFT_MODEL = process.env.OUTREACH_DRAFT_MODEL ?? "claude-sonnet-5";

const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    subject: { type: "string" },
    bodyText: { type: "string" },
    citedFactIds: { type: "array", items: { type: "string" } },
  },
  required: ["subject", "bodyText", "citedFactIds"],
  additionalProperties: false,
} as const;

export type DraftResult =
  | { drafted: true; draftId: string }
  | { drafted: false; reason: string };

/**
 * Drafts one email for one candidate using ONLY provenance-backed facts
 * (candidate_attribute rows all carry source_record_id/agent_job_id by CHECK
 * constraint). The model must cite which facts it used; citations are
 * validated against the allowed set, never trusted. Output goes to the 100%
 * human approval queue — status 'draft', nothing sends from here.
 */
export async function draftOutreach(
  db: EmitTx,
  llm: LlmGateway,
  args: { orgId: string; campaignId: string; candidateId: string; angleId: string; agentJobId?: string },
): Promise<DraftResult> {
  const [cand] = await db
    .select({
      id: candidate.id,
      fullName: candidate.fullName,
      email: candidate.primaryEmail,
      city: candidate.city,
      state: candidate.state,
      mergedIntoId: candidate.mergedIntoId,
    })
    .from(candidate)
    .where(and(eq(candidate.orgId, args.orgId), eq(candidate.id, args.candidateId)))
    .limit(1);
  if (!cand || cand.mergedIntoId) return { drafted: false, reason: "candidate_unavailable" };
  const email = cand.email?.trim().toLowerCase();
  if (!email) return { drafted: false, reason: "no_email" };

  // Don't spend tokens on someone we can never send to.
  if (await isSuppressed(db, args.orgId, "email", email)) {
    await db.transaction(async (tx) => {
      await tx
        .update(campaignMembership)
        .set({ status: "excluded" })
        .where(
          and(
            eq(campaignMembership.campaignId, args.campaignId),
            eq(campaignMembership.candidateId, args.candidateId),
          ),
        );
      await emit(tx, {
        orgId: args.orgId,
        type: "outreach.draft_skipped",
        entityType: "candidate",
        entityId: args.candidateId,
        payload: { reason: "suppressed", campaignId: args.campaignId },
      });
    });
    return { drafted: false, reason: "suppressed" };
  }

  const [ang] = await db
    .select({ id: angleTable.id, name: angleTable.name, description: angleTable.description, active: angleTable.active })
    .from(angleTable)
    .where(and(eq(angleTable.orgId, args.orgId), eq(angleTable.id, args.angleId)))
    .limit(1);
  if (!ang || !ang.active) return { drafted: false, reason: "angle_unavailable" };

  const [camp] = await db
    .select({ name: campaign.name })
    .from(campaign)
    .where(eq(campaign.id, args.campaignId))
    .limit(1);
  if (!camp) return { drafted: false, reason: "campaign_not_found" };

  // Provenance-backed facts only: current (non-superseded) attributes.
  const facts = await db
    .select({ id: candidateAttribute.id, key: candidateAttribute.key, value: candidateAttribute.value })
    .from(candidateAttribute)
    .where(
      and(
        eq(candidateAttribute.orgId, args.orgId),
        eq(candidateAttribute.candidateId, args.candidateId),
        isNull(candidateAttribute.supersededById),
      ),
    );
  const allowedIds = new Set(facts.map((f) => f.id));

  const factLines = facts.map((f) => `- [${f.id}] ${f.key}: ${JSON.stringify(f.value)}`).join("\n");
  const res = await llm.complete(
    {
      model: DRAFT_MODEL,
      system: [
        "You write short, personal, plain-text emails for a franchise consulting firm reconnecting with people who previously explored franchise ownership.",
        "Rules: sound like one person writing to another; no templates, no marketing language, no links, no images; 60-120 words; one question at the end; sign off with just a first name placeholder {{sender_first_name}}.",
        "You may reference ONLY the facts provided, and you must list the ids of the facts you actually used in citedFactIds. If you use no facts, return an empty citedFactIds array and keep the email generic but warm.",
        `Angle: ${ang.name} — ${ang.description}`,
      ].join("\n"),
      messages: [
        {
          role: "user",
          content: [
            `Candidate: ${cand.fullName ?? "unknown name"}${cand.city ? `, ${cand.city}, ${cand.state ?? ""}` : ""}`,
            "Known facts (cite by id):",
            factLines || "- (none)",
            "Write the email.",
          ].join("\n"),
        },
      ],
      maxTokens: 600,
      jsonSchema: DRAFT_SCHEMA as unknown as Record<string, unknown>,
    },
    { orgId: args.orgId, agentJobId: args.agentJobId, traceName: "outreach.draft" },
  );

  const out = res.json as { subject?: string; bodyText?: string; citedFactIds?: string[] } | undefined;
  if (!out?.subject || !out?.bodyText) return { drafted: false, reason: "bad_llm_output" };
  // Provenance gate: keep only citations that exist with provenance.
  const cited = (out.citedFactIds ?? []).filter((id) => allowedIds.has(id));

  const draftId = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(outreachDraft)
      .values({
        orgId: args.orgId,
        campaignId: args.campaignId,
        candidateId: args.candidateId,
        angleId: args.angleId,
        subject: out.subject!,
        bodyText: out.bodyText!,
        citedAttributeIds: cited,
        status: "draft",
        agentJobId: args.agentJobId,
      })
      .returning({ id: outreachDraft.id });
    if (!row) throw new Error("outreach_draft insert returned no row");
    await tx
      .update(campaignMembership)
      .set({ status: "drafted" })
      .where(
        and(
          eq(campaignMembership.campaignId, args.campaignId),
          eq(campaignMembership.candidateId, args.candidateId),
        ),
      );
    await emit(tx, {
      orgId: args.orgId,
      type: "outreach.drafted",
      entityType: "outreach_draft",
      entityId: row.id,
      payload: { campaignId: args.campaignId, candidateId: args.candidateId, citedFacts: cited.length },
    });
    return row.id;
  });

  return { drafted: true, draftId };
}
