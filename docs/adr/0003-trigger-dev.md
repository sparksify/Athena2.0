# ADR 0003: Trigger.dev for durable jobs

**Status:** Accepted · 2026-08-30

Athena needs durable runs, retries, schedules, and a run UI for agent jobs. Alternatives: Graphile Worker (in-Postgres, no run UI, more glue to write), BullMQ (adds Redis, a second load-bearing dependency), n8n/workflow builders (banned by CLAUDE.md). Trigger.dev provides durability and observability with plain TypeScript tasks. It sits behind the `JobRunner` contract and the transactional outbox is `agent_job` rows in Postgres, so Graphile Worker could replace it without touching `packages/core`.
