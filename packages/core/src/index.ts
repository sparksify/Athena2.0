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
export { addSuppression, isSuppressed, type AddSuppressionArgs } from "./outreach/suppress";
export { evaluateSendGates, windowOpen, localParts, type SendWindow, type GateResult } from "./outreach/gates";
export { sendApprovedDraft, type SendOutcome } from "./outreach/send";
export { handleEmailWebhook, type EmailWebhookEvent, type WebhookResult } from "./outreach/webhooks";
export { draftOutreach, DRAFT_MODEL, type DraftResult } from "./outreach/drafting";
export { approveDraft, rejectDraft } from "./outreach/approval";
export { runSendTick, outreachQueueCounts, type SendTickSummary } from "./outreach/scheduler";
export {
  REPLY_CLASSES, ALL_CLASSIFICATIONS, CLASS_DESCRIPTIONS, AUTO_REPLY_CLASSES, AUTO_REPLY_THRESHOLD,
  isAutoReplyEligible, type ReplyClass, type Classification,
} from "./conversation/classes";
export { buildConversationContext, type ConversationContext } from "./conversation/context";
export { classifyReply, routeClassification, CLASSIFY_MODEL, type ClassifyResult, type ConversationState } from "./conversation/classify";
export { sendAutoReply, AUTO_REPLY_MODEL, type AutoReplyOutcome } from "./conversation/auto-reply";
export { overrideClassification, closeConversation, assignConversation, humanReply, conversationMailbox } from "./conversation/state";
export { listConversations, overrideRate, conversationThread, type QueueRow } from "./conversation/queue";
