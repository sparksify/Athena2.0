# ADR 0001: Postgres (Supabase) is the canonical store

**Status:** Accepted · 2026-08-30

Every fact Athena owns — candidates, identities, events, jobs, costs, suppression — lives in one Supabase Postgres database. The problem is data fragmentation across vendor tools; the alternatives were a CRM-as-source-of-truth (Twenty, GHL) or a split store per concern. One Postgres with RLS gives transactional state+event writes, org isolation in SQL, and lets every vendor sit behind a replaceable adapter. It is the only load-bearing dependency; everything else can be swapped.
