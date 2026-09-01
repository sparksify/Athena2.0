# Dashboard mockup — spec (from Steve's image, 2026-09-01)

The reference mockup is a dark command-center. This document captures its
structure and palette; the Today screen implements it with real queries.
(The original was provided as an image; this is the canonical in-repo spec.)

## Chrome
- Left sidebar, dark: ATHENA wordmark + logo mark, then nav:
  Overview · Leads(Candidates) · Conversations · Opportunities · Consultants ·
  Appointments · Campaigns · Intelligence · Analytics · Agent Ops · Settings.
  Bottom: AI systems status chip + signed-in user card.
  Items for unbuilt phases render muted/disabled until their phase lands.
- Header: time-of-day greeting with first name, subtitle
  "Here's what's happening with Athena today.", date-range/filter/export on
  the right (later phase).

## Content
1. **KPI tile row** (8 tiles, each with a 7-day sparkline and delta):
   Evaluated · Contacted · Scripts(Drafts) · Positive · Qualified ·
   Consultant Intros · Appointments · Projected Pipeline ($, stage-weighted).
2. **Reactivation funnel (last 31 days)** — wide area/steps panel:
   Contacted → Replied → Positive → Qualified → Intro sent → Appointment →
   Showed → Presented → Application → Closed, each with count + % of contacted.
3. **Pipeline overview** — donut, $ by stage (Phase 9).
4. **Consultant performance (30d)** — table: contacted, accept rate, first
   contact time, show rate, intro→close, revenue, load (Phase 7+).
5. **Needs & Human** — queue counts: drafts awaiting approval, replies tagged
   for consultant, identity merges to review, dispositions overdue, intros
   pending, callbacks missed.
6. **Conversation health** — % + trend (Phase 6).
7. **Economics (30d)** — ad spend, cost per positive, ROAS (Phase 9).
8. **Athena AI Insight banner** — gradient bar with one model-written insight
   and a link to recommendations (Phase 6+/10).

## Palette
- Ground: near-black blue `#0B0F17`; panels `#121826` with `#1E2635` borders.
- Ink `#E2E8F0`; muted `#8B95A7`; faint `#64748B`.
- Accents: indigo/violet `#6366F1`→`#8B5CF6` (primary, gradients), cyan
  `#22D3EE`, green `#34D399` (positive/health), amber `#F59E0B`
  (attention), red `#F87171` (violations).
- Dark-only design (deliberate single theme).
- Tiles: rounded panels, icon chip top-left, big tabular number, small delta
  line, sparkline footer.
