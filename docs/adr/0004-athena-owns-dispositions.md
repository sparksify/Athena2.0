# ADR 0004: Athena owns post-handoff accountability

**Status:** Accepted · 2026-08-30

Appointments, dispositions, and consultant nudge timers live in Athena, not LeadOS/GHL. The problem: once a candidate is handed to a consultant, the CRM records whatever the consultant types (often nothing), and revenue attribution dies. Alternative — trust GHL stages as truth — was rejected because Athena cannot enforce timers or reconcile funnels from data it doesn't own. Athena writes `appointment`/`disposition` rows, drives nudges over `SmsProvider`, and syncs to GHL as a downstream mirror via `CrmSyncAdapter`.
