# ADR 0006: Splink for identity resolution

**Status:** Accepted · 2026-08-30

The pilot's 5K records (resumes, trade shows, purchased lists) contain the same people under different emails, misspelled names, and stale phones. Alternatives: exact/fuzzy SQL matching (brittle, no confidence output) or LLM pairwise comparison (cost scales quadratically, unauditable). Splink does probabilistic record linkage with blocking rules, a trainable model, and per-pair confidence — auto-link ≥ 0.85, human review 0.60–0.85. It runs as a small Python service in `packages/identity-splink` behind the `IdentityResolver` contract; LLMs are reserved for tie-breaks.
