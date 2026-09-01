# Consultant accountability — requirements from the Athena 1.0 command center

Source: screenshots of the current FCC Executive Command Center (Athena 1.0,
Heroku) provided by Steve on 2026-09-01, plus his notes on what Nick and Pete
watch. This document feeds Phase 7 (routing + accountability) and Phase 9
(analytics). It records the vocabulary and behaviors Athena 2.0 must preserve
or improve; it does not authorize building ahead of phase.

## What Nick cares about (verbatim priorities)

1. **Consultants book appointments, respond in a timely fashion, and move
   people through the pipeline.** This is the #1 signal.
2. **Paid-lead visibility.** If he is paying for leads he wants to see where
   every person is in the process, at any time.
3. **Performance has consequences.** Consultants who perform well get
   rewarded (more/better leads). Consultants who do not comply get their
   leads **taken back** and rerouted.
4. **LeadOS-style automations** keep consultants on top of leads: speed-to-
   lead timers, nudges, escalation to managers. Athena 2.0's nudge engine
   (Phase 7: +1h / +4h / +24h-to-manager) is the successor.

## CRM stage vocabulary (adopt verbatim)

The whole company thinks in these stages. Athena 2.0's `opportunity.stage`
and the GHL sync must use them, in this order:

| # | Stage | 1.0 example count |
|---|---|---|
| 1 | Lead In | 66 |
| 2 | Contact Made | 25 |
| 3 | CQ Sent | 9 |
| 4 | CQ Received | 4 |
| 5 | Talking to Zors | 11 |
| 6 | D-Day Scheduled | 0 |
| 7 | Contract Out | 1 |
| 8 | Closed / Funded | 0 |

Each stage is displayed with its count and its % of visible opportunities.

## What the 1.0 dashboard shows (structure worth keeping)

- **Time scopes**: Today / 7 days / 30 days / Lifetime — every number scoped.
- **Views**: Executive, Pipeline, Consultants, Brands, AI Agents, Operations.
- **Headline KPIs**: production status, CRM opportunities (162), open CRM
  pipeline value ($749,000), positive replies (343), consultant handoffs
  (427), open opportunities in scope, data-refresh timestamp.
- **Global cross-filter**: any view filterable by consultant, brand, or AI
  agent (e.g. "Consultant: Aaron Bakken"), with a clear-all.
- **Executive narrative**: a generated plain-English summary addressed to the
  reader ("Good morning Pete. 58,287 emails were sent… 427 qualified
  consultant handoffs landed… Top consultant right now is… Attention
  required: …"). Athena 2.0's insight banner is the successor; it must stay
  grounded in live queries.
- **CRM stage mix donut** over the selected scope.
- **Consultant ownership panel** (the panel Nick actually reads):
  - Ranked list of consultants by live opportunity count (Rob Petka 31,
    Adam Gruen 19, Paulette Callender 16, Michael Stavrinakis 16, Lane
    Klastow 15, Dave Sullivan 14, Mariel Miller 13, Stephen Rotay 11, …).
  - Expandable per-consultant lead list: lead name + email, brand/campaign
    (4EverCharge, CRS, Subcontain, Resting Rainbow, Sung Athena, FCC
    Franchise Development Consulting, "Franchise Ownership Inquiry"), the
    **AI agent who assigned it** (Tim, Sophie, Claire, Rina), current stage,
    and the date it entered.
  - Stage filter chips across the top of the panel.

## Gaps in 1.0 that Athena 2.0 must close

1.0 shows *who owns what*; it does not show *whether they are acting*.
Nick's priorities require, per consultant:

- **Speed to first response** on each assignment (LeadOS's core metric).
- **Appointments booked / show rate**, not just stage counts.
- **Stage velocity** — time in stage; stalls surfaced, oldest first.
- **SLA state** on every assignment: on-time, nudged (+1h/+4h), escalated
  (+24h manager), and **breached → take-back**.
- **Take-back flow**: reclaiming a lead is a first-class action that leaves
  events, feeds routing (fewer/no new leads for the non-compliant
  consultant), and reroutes the candidate — never a silent CRM edit.
- **Reward loop**: the routing engine's load/priority weighting should favor
  consultants with strong accept-rate, first-touch, and show-rate numbers.

## Phase mapping

- **Phase 7** (routing + accountability): `consultant`, `assignment`,
  `opportunity` (with the 8 stages above), `appointment`, `disposition`,
  `consultant_nudge`; nudge timers; take-back rule; routing weights that use
  performance; consultant ownership panel with SLA state per assignment.
- **Phase 9** (analytics): leaderboard (contacted, accept rate, first-contact
  time, show rate, intro→close, revenue, load), cross-filters by
  consultant/brand/campaign, stage-weighted pipeline value, time scopes.

## Decisions (Steve, 2026-09-01)

1. **Take-back at 48h no-touch.** If a consultant has not made first contact
   48 hours after assignment, the lead is reclaimed and rerouted. Escalation
   ladder: nudge +1h → nudge +4h → manager +24h → take-back at 48h. The
   take-back writes events, updates the assignment, and feeds routing.
2. **Reward = lead allocation.** High performers get new leads, more leads,
   and the best (highest-scored) leads. The routing engine's weights must
   express this directly: performance (first-touch time, accept rate, show
   rate) raises both volume and lead quality allocated.
3. **Stage wording carries over verbatim**, including "Talking to Zors" and
   "D-Day Scheduled", in the Athena 2.0 UI and GHL sync.
4. **Tim, Sophie, Claire, and Rina are persistent named agents.** They carry
   into the Athena 2.0 dashboard with their persona images. Data model
   implication for Phase 7: the persona concept is plural — one row per
   named agent (name, avatar image, mailbox where applicable), and
   assignments/interactions attribute to the agent that made them, so the
   ownership panel can show "Assigned by Sophie" with her avatar as today.

Outstanding (non-blocking): Steve to supply the four persona avatar images
(from the Athena 1.0 personas assets) so they ship with the Phase 7 UI.

## Update — Nick's email, 2026-08-30 (consult-first priorities)

Nick, after reviewing the first Consultant Command preview:

1. **Speed to consultation is the KPI with the most bearing.** Not just
   first touch — how fast an assigned person gets to a real consultation.
2. **A CQ must be in hand before the consult.**
3. **The magic number is three real consults per consultant per week.**
   Real = a deep dive into the person and what they're looking to do, not a
   check-in call.
4. The **first substantive conversation** differs for a lead we marketed a
   specific brand to versus a general inquiry; he wants to define that
   conversation and track the activities that cause the deal from there.

## Decisions (Steve, 2026-09-01, second round)

5. **Consult clock starts at assignment.** Speed to consultation is
   measured assignment → completed consult, so it measures what the
   consultant controls and pairs with the 48h first-touch SLA.
6. **Real consult = completed consultation-type appointment with a logged
   disposition.** Deterministic; rides on the Phase 7
   `appointment`/`disposition` model. Weekly target: 3 per consultant.
7. **CQ-before-consult is tracked and chased now, hard-gated later.** The
   dashboard shows CQ compliance per consultant and flags upcoming
   consults missing a CQ; the booking hard-gate (no consult scheduled
   until CQ received) is the Phase 7 rule.
8. **Brand-marketed vs. general leads stay blended for now.** Revisit the
   split when the first-substantive-conversation tracking (item 4 above)
   gets designed with Nick.
