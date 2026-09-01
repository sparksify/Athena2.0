// All vendor adapter interfaces. packages/core depends only on these;
// implementations live in packages/adapters/* and are injected at the edges
// (worker tasks, API routes). Interfaces are intentionally minimal in
// Phase 0 and grow in the phase that implements them.

// ---------------------------------------------------------------- LLM

export interface LlmRequest {
  /** Model identifier, provider-specific (e.g. claude-sonnet-4-5). */
  model: string;
  system?: string;
  messages: { role: "user" | "assistant"; content: string }[];
  maxTokens?: number;
  /** When set, the provider must return JSON conforming to this schema. */
  jsonSchema?: Record<string, unknown>;
}

export interface LlmResponse {
  text: string;
  /** Parsed JSON when jsonSchema was requested. */
  json?: unknown;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface LlmProvider {
  readonly name: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
}

// ---------------------------------------------------------------- Email

export interface OutboundEmail {
  to: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  /** Which mailbox/persona sends it; provider-specific reference. */
  mailboxRef: string;
}

export interface EmailProvider {
  readonly name: string;
  sendEmail(email: OutboundEmail): Promise<{ providerMessageId: string }>;
}

// ---------------------------------------------------------------- SMS

export interface SmsProvider {
  readonly name: string;
  sendSms(msg: { to: string; body: string }): Promise<{ providerMessageId: string }>;
}

// ---------------------------------------------------------------- Verification

export type EmailVerificationResult = "valid" | "invalid" | "risky" | "unknown";

export interface EmailVerifier {
  readonly name: string;
  verify(email: string): Promise<{ result: EmailVerificationResult; raw: unknown }>;
}

// ---------------------------------------------------------------- Enrichment

export interface EnrichmentProvider {
  readonly name: string;
  enrich(input: { email?: string; fullName?: string; company?: string }): Promise<{
    attributes: Record<string, unknown>;
    costUsd: number;
    raw: unknown;
  }>;
}

// ---------------------------------------------------------------- Signals

export interface SignalProvider {
  readonly name: string;
  fetchSignals(input: { email?: string; linkedinUrl?: string }): Promise<
    { type: string; observedAt: Date; payload: Record<string, unknown> }[]
  >;
}

// ---------------------------------------------------------------- Calendar

export interface CalendarProvider {
  readonly name: string;
  /** Normalize a provider webhook into Athena's appointment event shape. */
  parseWebhook(payload: unknown): {
    kind: "scheduled" | "canceled" | "completed";
    externalRef: string;
    startsAt: Date;
    inviteeEmail: string;
  } | null;
}

// ---------------------------------------------------------------- CRM

export interface CrmSyncAdapter {
  readonly name: string;
  upsertOpportunity(input: {
    externalContactRef?: string;
    name: string;
    stage: string;
  }): Promise<{ externalRef: string }>;
  parseStageWebhook(payload: unknown): { externalRef: string; stage: string } | null;
}

// ---------------------------------------------------------------- Audiences

export interface AudienceSync {
  readonly name: string;
  syncAudience(input: {
    name: string;
    members: { email?: string; phone?: string }[];
  }): Promise<{ externalRef: string; memberCount: number }>;
}

// ---------------------------------------------------------------- Identity

export interface IdentityResolver {
  readonly name: string;
  /** Score candidate pairs for probabilistic identity. ids are candidate ids. */
  resolve(records: { id: string; fields: Record<string, unknown> }[]): Promise<
    { leftId: string; rightId: string; confidence: number }[]
  >;
}

// ---------------------------------------------------------------- Jobs

/** Abstraction over the durable job runner (Trigger.dev today). */
export interface JobRunner {
  readonly name: string;
  trigger(taskId: string, payload: Record<string, unknown>): Promise<{ runId: string }>;
}
