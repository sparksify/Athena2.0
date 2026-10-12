# Lessons

One line per correction from the operator; applied going forward.

- 2026-08-30: Keep the architecture as simple as production quality allows — no abstractions, refactors, or infrastructure that don't solve a present requirement.
- 2026-09-01: Ingestion preserves source truth and does deterministic-only identity (exact normalized email/phone, content hash); fuzzy/probabilistic/AI matching is Phase 2. Import reports are stored structurally (import_batch.report), not just printed.
- 2026-10-11 (Steve): "upload a list and send emails" is what Athena 1.0 already does. Context is the product: every imported person is checked against the CRM history we already own (tags, stage, conversations, DND) and the top of the list gets a sourced research note before anyone drafts a word. Build the data-gathering step in the same phase as the thing that consumes it, not two phases later.
