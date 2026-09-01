import { candidate, identityReview } from "@athena/db/schema";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { EmitTx } from "../events/emit.js";

type Db = EmitTx & {
  transaction: <T>(fn: (tx: EmitTx) => Promise<T>) => Promise<T>;
};

/** CLAUDE.md Phase 2 thresholds: auto-link ≥ 0.85, review 0.60–0.85, ignore below. */
export const AUTO_LINK_THRESHOLD = 0.85;
export const REVIEW_THRESHOLD = 0.6;

export interface ResolvedPair {
  candidateAId: string;
  candidateBId: string;
  confidence: number;
  evidence?: Record<string, unknown>;
}

export interface ResolutionResult {
  autoMerged: number;
  queuedForReview: number;
  ignored: number;
  skipped: number;
}

/**
 * Routes scored candidate pairs from the IdentityResolver into the review
 * machinery. Auto-links call the same merge_candidates() SQL function the
 * review UI uses — one merge implementation everywhere. Pairs involving an
 * already-merged candidate or an open review are skipped.
 */
export async function applyResolution(
  db: Db,
  orgId: string,
  pairs: ResolvedPair[],
  method: "splink" | "manual" = "splink",
): Promise<ResolutionResult> {
  const result: ResolutionResult = { autoMerged: 0, queuedForReview: 0, ignored: 0, skipped: 0 };

  for (const pair of pairs) {
    if (pair.confidence < REVIEW_THRESHOLD) {
      result.ignored += 1;
      continue;
    }

    const merged = await db
      .select({ id: candidate.id })
      .from(candidate)
      .where(
        and(
          inArray(candidate.id, [pair.candidateAId, pair.candidateBId]),
          isNull(candidate.mergedIntoId),
        ),
      );
    if (merged.length !== 2) {
      result.skipped += 1; // one side already merged away
      continue;
    }

    const [review] = await db
      .insert(identityReview)
      .values({
        orgId,
        candidateAId: pair.candidateAId,
        candidateBId: pair.candidateBId,
        score: pair.confidence.toFixed(4),
        method,
        evidence: pair.evidence ?? {},
      })
      .onConflictDoNothing()
      .returning({ id: identityReview.id });
    if (!review) {
      result.skipped += 1; // open review already exists for this pair
      continue;
    }

    if (pair.confidence >= AUTO_LINK_THRESHOLD) {
      await db.execute(sql`select public.merge_candidates(${review.id}::uuid)`);
      result.autoMerged += 1;
    } else {
      result.queuedForReview += 1;
    }
  }

  return result;
}

/** Pending reviews with both candidates' display fields, for the review UI/CLI. */
export async function pendingReviews(db: Db, orgId: string, limit = 100) {
  return db
    .select()
    .from(identityReview)
    .where(and(eq(identityReview.orgId, orgId), eq(identityReview.status, "pending")))
    .limit(limit);
}
