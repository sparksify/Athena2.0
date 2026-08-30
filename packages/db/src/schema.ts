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
    status: text("status").notNull().default("new"),
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
    sourceBatchId: text("source_batch_id"),
    contentHash: text("content_hash").notNull(),
    payload: jsonb("payload").notNull(),
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
