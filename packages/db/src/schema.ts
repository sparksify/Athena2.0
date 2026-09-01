import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const org = pgTable("org", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Application users. id matches auth.users.id (Supabase Auth).
export const appUser = pgTable(
  "user",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id").notNull().references(() => org.id),
    email: text("email").notNull(),
    fullName: text("full_name"),
    role: text("role", {
      enum: ["super_admin", "fcc_admin", "manager", "consultant", "analyst", "read_only"],
    }).notNull().default("read_only"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("user_org_email_idx").on(t.orgId, t.email)],
);

export const candidate = pgTable(
  "candidate",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => org.id),
    fullName: text("full_name"),
    primaryEmail: text("primary_email"),
    primaryPhone: text("primary_phone"),
    city: text("city"),
    state: text("state"),
    status: text("status").notNull().default("new"),
    mergedIntoId: uuid("merged_into_id"),
    currentScore: integer("current_score"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("candidate_org_idx").on(t.orgId)],
);

export const sourceRecord = pgTable(
  "source_record",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => org.id),
    sourceType: text("source_type").notNull(),
    sourceBatchId: uuid("source_batch_id").references(() => importBatch.id),
    contentHash: text("content_hash").notNull(),
    payload: jsonb("payload").notNull(),
    normalized: jsonb("normalized"),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("source_record_org_hash_idx").on(t.orgId, t.contentHash)],
);

// Append-only audit stream. Every state change writes one of these in the
// same transaction as the state row (see @athena/core emit()).
export const event = pgTable(
  "event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => org.id),
    type: text("type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    actorType: text("actor_type", { enum: ["system", "user", "agent"] }).notNull().default("system"),
    actorId: uuid("actor_id"),
    payload: jsonb("payload").notNull().default({}),
    correlationId: uuid("correlation_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("event_org_created_idx").on(t.orgId, t.createdAt),
    index("event_entity_idx").on(t.entityType, t.entityId),
  ],
);

// Doubles as the transactional outbox: rows inserted with status 'queued'
// inside emit()'s transaction are picked up by the job runner.
export const agentJob = pgTable(
  "agent_job",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => org.id),
    type: text("type").notNull(),
    status: text("status", { enum: ["queued", "running", "succeeded", "failed"] })
      .notNull()
      .default("queued"),
    payload: jsonb("payload").notNull().default({}),
    result: jsonb("result"),
    error: text("error"),
    correlationId: uuid("correlation_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("agent_job_org_status_idx").on(t.orgId, t.status)],
);

export const costRecord = pgTable(
  "cost_record",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => org.id),
    agentJobId: uuid("agent_job_id").references(() => agentJob.id),
    category: text("category", {
      enum: ["llm", "enrichment", "verification", "message", "other"],
    }).notNull(),
    provider: text("provider").notNull(),
    amountUsd: numeric("amount_usd", { precision: 12, scale: 6 }).notNull(),
    detail: jsonb("detail").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("cost_record_org_created_idx").on(t.orgId, t.createdAt)],
);

// Hard suppression list, checked in code before every send.
export const suppression = pgTable(
  "suppression",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => org.id),
    channel: text("channel", { enum: ["email", "sms"] }).notNull(),
    identifier: text("identifier").notNull(),
    reason: text("reason").notNull(),
    source: text("source"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("suppression_org_channel_identifier_idx").on(t.orgId, t.channel, t.identifier)],
);

// Derived facts with provenance; corrections supersede, never update.
export const candidateAttribute = pgTable(
  "candidate_attribute",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => org.id),
    candidateId: uuid("candidate_id").notNull().references(() => candidate.id),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    confidence: numeric("confidence"),
    sourceRecordId: uuid("source_record_id").references(() => sourceRecord.id),
    agentJobId: uuid("agent_job_id").references(() => agentJob.id),
    supersededById: uuid("superseded_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("candidate_attribute_candidate_key_idx").on(t.candidateId, t.key)],
);

export const questionnaire = pgTable(
  "questionnaire",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => org.id),
    candidateId: uuid("candidate_id").notNull().references(() => candidate.id),
    sourceRecordId: uuid("source_record_id").references(() => sourceRecord.id),
    kind: text("kind", { enum: ["cq_complete", "cq_partial"] }).notNull(),
    answers: jsonb("answers").notNull().default({}),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("questionnaire_candidate_idx").on(t.candidateId)],
);

// Financial data in its own table so access control is a table policy.
export const financialProfile = pgTable("financial_profile", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => org.id),
  candidateId: uuid("candidate_id").notNull().unique().references(() => candidate.id),
  liquidityUsd: numeric("liquidity_usd"),
  netWorthUsd: numeric("net_worth_usd"),
  investableUsd: numeric("investable_usd"),
  sourceRecordId: uuid("source_record_id").references(() => sourceRecord.id),
  agentJobId: uuid("agent_job_id").references(() => agentJob.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// One timeline: historical interactions from imports and live activity.
export const interaction = pgTable(
  "interaction",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => org.id),
    candidateId: uuid("candidate_id").notNull().references(() => candidate.id),
    type: text("type", {
      enum: ["email_sent", "email_reply", "sms", "call", "meeting", "presentation", "territory_check", "import_history"],
    }).notNull(),
    direction: text("direction", { enum: ["inbound", "outbound"] }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    consultantId: uuid("consultant_id"),
    campaignId: uuid("campaign_id"),
    payload: jsonb("payload").notNull().default({}),
    sourceRecordId: uuid("source_record_id").references(() => sourceRecord.id),
    providerRef: text("provider_ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("interaction_candidate_time_idx").on(t.candidateId, t.occurredAt)],
);

export const scoreSnapshot = pgTable(
  "score_snapshot",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => org.id),
    candidateId: uuid("candidate_id").notNull().references(() => candidate.id),
    score: integer("score").notNull(),
    version: integer("version").notNull(),
    factors: jsonb("factors").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("score_snapshot_candidate_idx").on(t.candidateId, t.createdAt)],
);

export const identityReview = pgTable(
  "identity_review",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => org.id),
    candidateAId: uuid("candidate_a_id").notNull().references(() => candidate.id),
    candidateBId: uuid("candidate_b_id").notNull().references(() => candidate.id),
    score: numeric("score").notNull(),
    method: text("method", { enum: ["splink", "manual"] }).notNull(),
    status: text("status", { enum: ["pending", "merged", "rejected", "split"] })
      .notNull()
      .default("pending"),
    evidence: jsonb("evidence").notNull().default({}),
    mergeDetail: jsonb("merge_detail"),
    reviewedBy: uuid("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("identity_review_status_idx").on(t.orgId, t.status)],
);

export const importBatch = pgTable("import_batch", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => org.id),
  sourceType: text("source_type").notNull(),
  filename: text("filename").notNull(),
  status: text("status", { enum: ["running", "completed", "failed"] })
    .notNull()
    .default("running"),
  report: jsonb("report"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const candidateSourceLink = pgTable(
  "candidate_source_link",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => org.id),
    candidateId: uuid("candidate_id").notNull().references(() => candidate.id),
    sourceRecordId: uuid("source_record_id").notNull().references(() => sourceRecord.id),
    confidence: numeric("confidence").notNull().default("1.0"),
    method: text("method", { enum: ["exact", "splink", "manual", "agent"] }).notNull(),
    agentJobId: uuid("agent_job_id").references(() => agentJob.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("candidate_source_link_pair_idx").on(t.candidateId, t.sourceRecordId),
    index("candidate_source_link_source_idx").on(t.sourceRecordId),
  ],
);

// Contact identifiers extracted at import. candidate_id is linked
// deterministically (exact normalized match) in Phase 1; fuzzy links wait
// for Phase 2 identity resolution.
export const identifier = pgTable(
  "identifier",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => org.id),
    candidateId: uuid("candidate_id").references(() => candidate.id),
    type: text("type", { enum: ["email", "phone", "linkedin", "postal"] }).notNull(),
    valueNormalized: text("value_normalized").notNull(),
    valueRaw: text("value_raw").notNull(),
    firstSourceRecordId: uuid("first_source_record_id").references(() => sourceRecord.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("identifier_org_type_value_idx").on(t.orgId, t.type, t.valueNormalized),
    index("identifier_candidate_idx").on(t.candidateId),
  ],
);

export const emailVerification = pgTable(
  "email_verification",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => org.id),
    identifierId: uuid("identifier_id").notNull().references(() => identifier.id),
    provider: text("provider").notNull(),
    result: text("result", { enum: ["valid", "invalid", "risky", "unknown"] }).notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
    raw: jsonb("raw").notNull().default({}),
  },
  (t) => [index("email_verification_identifier_idx").on(t.identifierId)],
);

export const promptVersion = pgTable(
  "prompt_version",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => org.id),
    name: text("name").notNull(),
    version: integer("version").notNull(),
    content: text("content").notNull(),
    model: text("model"),
    active: boolean("active").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("prompt_version_org_name_version_idx").on(t.orgId, t.name, t.version)],
);
