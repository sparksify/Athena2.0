export { emit, type EmitArgs, type EmitResult, type EmitTx } from "./events/emit";
export { LlmGateway, type GatewayCallContext } from "./llm/gateway";
export { createLogger } from "./log";
export {
  importFile,
  batchReport,
  importReport,
  pendingVerificationJobs,
  type ImportFileArgs,
  type ImportReport,
} from "./ingest/import";
export { runVerificationJob } from "./ingest/verification";
export {
  computeScore,
  buildContexts,
  scoreCandidates,
  explainScore,
  SCORE_VERSION,
} from "./intelligence/score";
export { FACTORS } from "./intelligence/factors/index";
export type { ScoringContext, FactorResult, ScoringFactor } from "./intelligence/types";
export {
  applyResolution,
  pendingReviews,
  AUTO_LINK_THRESHOLD,
  REVIEW_THRESHOLD,
  type ResolvedPair,
  type ResolutionResult,
} from "./identity/resolve";
export * from "./ingest/normalize";
export { PARSERS } from "./ingest/parsers/index";
export { parseCsv } from "./ingest/csv";
export type { ParsedRecord, SourceParser } from "./ingest/types";
