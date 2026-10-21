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
export { SOURCE_TYPES, SOURCE_QUALITY, sourceTypeLabel, type SourceTypeValue } from "./ingest/source-types";
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
  isAutoReplyEligible, isRouteEligible, ROUTE_CLASSES, ROUTE_THRESHOLD, type ReplyClass, type Classification,
} from "./conversation/classes";
export { buildConversationContext, type ConversationContext } from "./conversation/context";
export { classifyReply, routeClassification, CLASSIFY_MODEL, type ClassifyResult, type ConversationState } from "./conversation/classify";
export { sendAutoReply, AUTO_REPLY_MODEL, type AutoReplyOutcome } from "./conversation/auto-reply";
export { overrideClassification, closeConversation, assignConversation, humanReply, conversationMailbox } from "./conversation/state";
export { listConversations, overrideRate, conversationThread, type QueueRow } from "./conversation/queue";
// Phase 7
export type { RoutingRule, RoutingConsultant, RoutingContext, RuleResult, ConsultantStats } from "./routing/types";
export { ROUTING_RULES } from "./routing/rules/index";
export { rankConsultants, type RankedConsultant } from "./routing/rank";
export { buildRoutingContext } from "./routing/context";
export { consultantStats, startOfWeek } from "./routing/stats";
export { routeCandidate, type RouteResult, type RoutingTrigger } from "./routing/assign";
export { acceptAssignment, declineAssignment } from "./routing/respond";
export { recordFirstTouch, type TouchChannel } from "./routing/first-touch";
export { sendWarmIntro, listPersonas, INTRO_MODEL, type IntroOutcome, type IntroRefuseReason } from "./routing/intro";
export { STAGE_LABELS, PIPELINE_STAGES, advanceStage, nextStage, stageFromLabel, stageIndex } from "./accountability/stages";
export { NUDGE_LADDER, TAKE_BACK_AFTER_MS, nudgeText } from "./accountability/ladder";
export { runAccountabilityTick, openNudgesFor, type TickSummary, type SmsResolver } from "./accountability/nudges";
export { takeBackAssignment } from "./accountability/take-back";
export { handleCalendarEvent, type CalendarEvent, type AppointmentResult } from "./accountability/appointments";
export { DISPOSITION_CODES, parseDispositionReply, recordDisposition, handleInboundSms, type DispositionCode, type InboundSmsResult } from "./accountability/dispositions";
export { syncOpportunity, applyCrmStage } from "./accountability/crm";
export { drainRoutingJobs, ROUTING_JOB_TYPES, type ConsultantRef, type DrainDeps, type DrainSummary } from "./routing/drain";
export { loadBoard, slaFor, WEEKLY_CONSULT_TARGET, type Board, type BoardConsultant, type BoardLead, type BoardAppointment, type SlaState } from "./routing/board";
// Enrichment
export { enrichFromCrm, enqueueCrmLookups, drainCrmLookups, crmLookupScope, CRM_JOB_TYPE, CRM_ATTRIBUTE_KEYS, type CrmEnrichResult } from "./ingest/crm-enrich";
export {
  researchCandidate, enqueueResearch, drainResearch, researchSpentToday,
  RESEARCH_JOB_TYPE, RESEARCH_MODEL, RESEARCH_MIN_SCORE, RESEARCH_DAILY_BUDGET_USD, type ResearchResult,
} from "./intelligence/research";
export { saveGhlCredential, ghlAgencyAccess, forgetGhlCredential, GHL_PROVIDER, type GhlAgencyAccess, type GhlRefresher, type GhlRefreshed } from "./integrations/ghl-oauth";
