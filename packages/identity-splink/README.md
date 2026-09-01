# @athena/identity-splink

Probabilistic identity resolution behind the `IdentityResolver` contract.
Deterministic exact matching happens at import (Phase 1); this finds the
non-exact duplicates — same human, different email — with a confidence score.

- `service/` — Python FastAPI service wrapping Splink 4 (`model.py` holds the
  blocking rules and comparisons; trains unsupervised at resolve time).
- `src/client.ts` — TypeScript `IdentityResolver` client (`SPLINK_URL`).
- `service/evaluate.py` — precision/recall against a labeled pair sample.
  Phase 2 gate: precision ≥ 0.97 on auto-links (≥ 0.85) and recall ≥ 0.85 on
  surfaced pairs (≥ 0.60 — the review queue counts; a surfaced pair reaches a
  human).
- `service/make_fixtures.py` — synthetic labeled data. Current result on
  2,300 records / 600 labeled pairs (300 hard negatives):
  **precision 0.996, recall 0.993 — PASS**. The official proof re-runs on
  Steve's labeled sample of real records.

```bash
cd service
pip install -r requirements.txt
uvicorn main:app --port 8100
python make_fixtures.py && python evaluate.py fixtures/records.csv fixtures/labels.csv
```
