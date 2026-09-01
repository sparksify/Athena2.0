import { task } from "@trigger.dev/sdk";
import { getDb } from "@athena/db";
import { candidate } from "@athena/db/schema";
import { applyResolution, createLogger } from "@athena/core";
import { SplinkResolver } from "@athena/identity-splink";
import { and, eq, isNull } from "drizzle-orm";

/**
 * Runs probabilistic identity resolution over an org's unmerged candidates.
 * Pairs route through applyResolution: auto-merge ≥ 0.85 (same SQL function
 * the review UI uses), 0.60–0.85 to the human queue, ignore below.
 */
export const identityResolve = task({
  id: "identity.resolve",
  run: async (payload: { orgId: string; limit?: number }) => {
    const db = getDb();
    const log = createLogger();
    const resolver = new SplinkResolver();

    const candidates = await db
      .select({
        id: candidate.id,
        fullName: candidate.fullName,
        primaryEmail: candidate.primaryEmail,
        primaryPhone: candidate.primaryPhone,
        city: candidate.city,
        state: candidate.state,
      })
      .from(candidate)
      .where(and(eq(candidate.orgId, payload.orgId), isNull(candidate.mergedIntoId)))
      .limit(payload.limit ?? 50_000);

    if (candidates.length < 2) return { pairs: 0 };

    const pairs = await resolver.resolve(
      candidates.map((c) => ({
        id: c.id,
        fields: {
          full_name: c.fullName,
          email: c.primaryEmail,
          phone: c.primaryPhone,
          city: c.city,
          state: c.state,
        },
      })),
    );

    const result = await applyResolution(
      db,
      payload.orgId,
      pairs.map((p) => ({ candidateAId: p.leftId, candidateBId: p.rightId, confidence: p.confidence })),
    );
    log.info("identity.resolve completed", { pairs: pairs.length, ...result });
    return { pairs: pairs.length, ...result };
  },
});
