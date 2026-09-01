# Lessons

One line per correction from the operator; applied going forward.

- 2026-08-30: Keep the architecture as simple as production quality allows — no abstractions, refactors, or infrastructure that don't solve a present requirement.
- 2026-09-01: Ingestion preserves source truth and does deterministic-only identity (exact normalized email/phone, content hash); fuzzy/probabilistic/AI matching is Phase 2. Import reports are stored structurally (import_batch.report), not just printed.
