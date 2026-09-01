export { emit, type EmitArgs, type EmitResult, type EmitTx } from "./events/emit.js";
export { LlmGateway, type GatewayCallContext } from "./llm/gateway.js";
export { createLogger } from "./log.js";
export {
  importFile,
  batchReport,
  importReport,
  pendingVerificationJobs,
  type ImportFileArgs,
  type ImportReport,
} from "./ingest/import.js";
export { runVerificationJob } from "./ingest/verification.js";
export {
  computeScore,
  buildContexts,
  scoreCandidates,
  explainScore,
  SCORE_VERSION,
} from "./intelligence/score.js";
export { FACTORS } from "./intelligence/factors/index.js";
export type { ScoringContext, FactorResult, ScoringFactor } from "./intelligence/types.js";
export {
  applyResolution,
  pendingReviews,
  AUTO_LINK_THRESHOLD,
  REVIEW_THRESHOLD,
  type ResolvedPair,
  type ResolutionResult,
} from "./identity/resolve.js";
export * from "./ingest/normalize.js";
export { PARSERS } from "./ingest/parsers/index.js";
export type { ParsedRecord, SourceParser } from "./ingest/types.js";
