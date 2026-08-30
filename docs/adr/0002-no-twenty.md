# ADR 0002: No Twenty (or any CRM) as a system of record

**Status:** Accepted · 2026-08-30

Twenty (and CRM-shaped tools generally) model pipelines, not candidate intelligence: provenance, identity resolution, scoring, suppression, and cost accounting have no home there, and building around a CRM's schema would make it load-bearing. The alternative considered was Twenty as the operator UI over synced data. Rejected: Athena's own Next.js UI reads the canonical Postgres directly; GHL is used strictly as a delivery/hand-off adapter behind `CrmSyncAdapter`.
