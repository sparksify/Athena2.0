# ATHENA 2.0 — LEAD ARCHITECT & BUILD BRIEF

You are the lead architect and principal engineer for a production application called Athena 2.0.

Your job is not merely to generate code. Your job is to design and build the simplest, most reliable architecture capable of accomplishing the business objective below.

Challenge unnecessary complexity. Do not add frameworks simply because they are popular. Prefer boring, deterministic software for deterministic jobs and AI/agents only where reasoning or autonomous work creates real value.

Before implementing any major architectural decision, ask:

Does Athena need to own this, or is there mature open-source infrastructure we should use instead?

## 1. WHAT ATHENA IS

Athena 2.0 is an AI-powered franchise candidate intelligence, reactivation, outreach, conversation, and revenue attribution platform.

It is being built for a large franchise consulting organization with approximately 10 years of historical candidate/lead data.

The organization may possess hundreds of thousands to potentially ~1 million historical records from sources including:

* Facebook leads
* Resume/job-board leads
* Completed franchise questionnaires
* Partial questionnaires
* Website inquiries
* Trade shows
* Franchise inquiries
* Territory checks
* Previous consultant conversations
* Previous franchise presentations
* Email campaigns
* SMS campaigns
* Appointment records
* No-shows
* Referrals
* Old CRM records
* Purchased datasets
* Other historical lead sources

The core thesis:

This historical dataset is an underutilized revenue asset.

Athena should continuously transform this fragmented historical data into structured candidate intelligence, identify people worth reactivating, determine why they should be contacted, personalize outreach, conduct conversations, qualify interest, match candidates with appropriate franchise opportunities, make warm consultant introductions, and track the candidate through eventual outcome.

This is NOT simply an AI cold-email tool.

It is intended to become the organization's candidate intelligence and revenue operating system.

## 2. EXISTING ATHENA 1.0

A primitive version already exists.

It uses approximately five AI agents operating through OpenClaw. Each agent has its own email identity/profile. Historical records are uploaded. Agents conduct basic email outreach. When a prospect responds positively, the system performs a warm email introduction to a human franchise consultant.

This system has already demonstrated that historical lead reactivation can produce revenue.

Athena 2.0 should preserve what works while fundamentally improving:

* intelligence
* personalization
* data normalization
* candidate understanding
* deliverability
* matching
* routing
* conversation quality
* consultant accountability
* attribution
* analytics
* learning from outcomes

Do NOT assume OpenClaw must remain the underlying runtime. It may be supported through an adapter, but Athena must never depend upon OpenClaw.

## 3. THE MOST IMPORTANT ARCHITECTURAL PRINCIPLE

ATHENA OWNS THE DATA.

Athena's canonical database must remain the source of truth.

No agent framework, CRM interface, workflow tool, email provider, enrichment vendor, or model provider may become the canonical source of candidate state.

External systems are replaceable adapters.

Think:

ATHENA → adapters → external systems

NOT:

external platform → Athena built inside it

If Paperclip disappears, Athena survives. If the email provider changes, Athena survives. If OpenClaw disappears, Athena survives. If an enrichment vendor disappears, Athena survives. If we change LLM providers, Athena survives.

## 4. PROPOSED TECHNOLOGY DIRECTION

We are currently considering:

**Supabase / PostgreSQL** — Canonical data layer. Potential responsibilities:

* PostgreSQL
* authentication
* row-level security
* vector storage where useful
* realtime functionality
* file/storage functionality

**Twenty CRM** — Evaluate using or forking Twenty as Athena's operator-facing CRM foundation rather than recreating commodity CRM functionality. Potential reusable functionality:

* people
* companies
* records
* custom objects
* search
* filtering
* views
* pipelines
* activities
* permissions
* operator UX

Do NOT blindly adopt Twenty. Evaluate whether adapting Twenty saves more complexity than it introduces.

**Paperclip** — Evaluate as an agent workforce/control plane. Potential responsibilities:

* agent registry
* agent execution
* goals
* tasks
* budgets
* governance
* monitoring
* worker management

Again: Paperclip must remain replaceable.

**OpenClaw** — Optional worker/runtime adapter. Athena should be capable of dispatching work to OpenClaw but must not be architecturally dependent upon it.

**Email infrastructure** — Use dedicated outbound email infrastructure rather than sending high-volume reactivation email through the organization's primary corporate domains/mailboxes.

Athena determines: WHO to contact, WHY to contact them, WHEN to contact them, WHAT to say, HOW to respond. The email provider simply handles delivery infrastructure. Design a provider abstraction so Smartlead, Instantly, or another provider could be substituted.

## 5. TECHNOLOGIES WE DO NOT WANT BY DEFAULT

Do NOT introduce n8n. Do NOT build Athena as a collection of visual automations. Do NOT add CrewAI merely because multiple agents exist. Do NOT introduce Dify unless you can demonstrate a compelling architectural reason that outweighs another stateful dependency. Do NOT turn deterministic application behavior into AI agents. Do NOT create "agent theater."

For example: Receiving an email webhook and updating a status is normal application code. Scheduling a follow-up is normal application code. Writing an event to PostgreSQL is normal application code. Routing based upon explicit business rules is normal application code.

AI/agent work is appropriate for tasks such as:

* researching a candidate
* interpreting messy historical records
* resolving ambiguous identity
* summarizing years of interactions
* determining likely candidate intent
* evaluating candidate/franchise fit
* selecting an outreach angle
* composing highly personalized outreach
* interpreting replies
* conducting nuanced conversations
* recommending next actions

## 6. THE CANDIDATE GRAPH

Athena needs to construct a unified identity for each human. A person may appear multiple times across 10 years.

Example:

Robert Smith · robert@gmail.com · bob.smith@company.com · 214-555-XXXX
Facebook Lead — 2019 · Resume Lead — 2020 · CQ — 2022 · Consultant Call — 2022 · Facebook Lead — 2025

These should not necessarily remain five disconnected leads. Athena should attempt to determine: these records represent the same human.

Design identity resolution with confidence scoring and human-review mechanisms for ambiguous merges. Never perform destructive merging without provenance. Every imported record must remain traceable to its source.

A unified candidate profile should potentially contain:

* canonical identity
* aliases
* emails
* phone numbers
* geography
* employment history
* professional background
* historical lead sources
* original source data
* financial information
* liquidity
* net worth
* investment preferences
* franchise interests
* industries considered
* brands previously presented
* consultants previously involved
* questionnaires
* appointments
* shows/no-shows
* communications
* territory checks
* objections
* timing
* intent signals
* enrichment
* AI-derived attributes
* current scoring
* recommended brands
* current opportunity
* final outcomes

Every derived fact should have provenance where practical.

## 7. CHEAP SIGNALS BEFORE EXPENSIVE SIGNALS

Do NOT enrich every historical record indiscriminately. Athena should use progressive intelligence.

* STAGE 0 — Ingest and normalize.
* STAGE 1 — Identity resolution.
* STAGE 2 — Analyze existing internal data.
* STAGE 3 — Cheap deterministic scoring.
* STAGE 4 — AI analysis where warranted.
* STAGE 5 — External enrichment only where expected value justifies cost.
* STAGE 6 — Deep research only for high-value candidates.

We may eventually process approximately 1 million records. A $0.10 unnecessary operation across 1 million records costs $100,000. Cost-awareness must therefore be architectural, not an afterthought.

Track AI, enrichment and communication costs by candidate/job/workflow wherever practical.

## 8. CANDIDATE REACTIVATION SCORE

Athena should develop a transparent scoring system estimating whether a historical candidate is worth contacting.

Potential factors:

* recency
* prior engagement
* CQ completion
* financial qualification
* liquidity
* net worth
* professional background
* previous appointments
* previous show/no-show
* franchise interest
* consultant notes
* previous responses
* geography
* territory availability
* current employment
* previous brands considered
* historical objections
* enrichment confidence
* contactability
* previous opt-out
* email quality
* predicted purchase fit

The score must be explainable. An operator should be able to ask: "Why is Robert a 91?" and receive understandable reasons. Do not hide the entire decision inside an opaque LLM call.

## 9. FRANCHISE INVENTORY / MATCHING

Athena needs a structured franchise inventory. Each brand should eventually contain data such as:

* industry/category
* business model
* investment range
* minimum liquidity
* net worth requirements
* owner-operator vs semi-absentee
* geography
* territory availability
* ideal candidate characteristics
* experience preferences
* lifestyle characteristics
* business characteristics
* known objections
* differentiators
* historical performance inside FCC
* candidate conversion data

Athena should rank candidate ↔ franchise fit. Initial matching may combine deterministic constraints with AI reasoning. Over time, outcomes should improve ranking.

## 10. OUTREACH

Athena should create outreach based upon actual candidate context.

BAD: "Hi Robert, are you interested in owning a franchise?"

BETTER — Athena knows:

* Robert spoke with FCC previously
* he explored home services
* he had approximately $250K liquidity
* he wanted semi-absentee ownership
* he stopped because timing was wrong
* his professional situation may have changed
* FCC now represents several opportunities fitting those preferences

The outreach should naturally reflect appropriate context without becoming creepy or revealing unnecessary enrichment.

Athena should support:

* sequences
* experiments
* message variants
* send windows
* suppression
* opt-outs
* deliverability controls
* mailbox rotation
* throttling
* campaign cohorts
* response handling
* human intervention

Compliance and suppression rules must override agent autonomy.

## 11. CONVERSATION ENGINE

Athena should understand inbound replies. Potential classifications:

* positive
* interested
* maybe later
* needs information
* asks what this is
* asks about specific brand
* asks about investment
* wrong person
* not interested
* unsubscribe
* hostile
* already owns franchise
* already working with consultant
* ambiguous

Athena may continue appropriate conversations automatically. However, confidence thresholds should determine when human review is required. Maintain complete conversation history.

The AI should receive relevant candidate memory without blindly stuffing every historical record into every prompt. Design intelligent context retrieval.

## 12. WARM INTRODUCTION + CONSULTANT ROUTING

When qualified interest exists, Athena should determine the appropriate consultant. Potential routing factors:

* consultant availability
* round robin
* workload
* specialty
* candidate history
* geography
* franchise expertise
* existing consultant relationship
* performance
* explicit assignment rules

Then perform a warm introduction. But Athena MUST NOT stop tracking at introduction.

## 13. CONSULTANT ACCOUNTABILITY

Track:

candidate interested → introduction → consultant assigned → consultant accepted → first contact → appointment scheduled → appointment showed → CQ → brands presented → territory check → application → discovery → awarded → closed → lost → lost reason

Athena should expose funnel metrics by:

* consultant
* source
* campaign
* candidate cohort
* franchise
* outreach angle
* agent/workflow
* time period

The objective is eventual revenue attribution.

## 14. FEEDBACK LOOP

This is one of Athena's most important long-term advantages. Every outcome becomes training/evaluation data.

Athena should eventually learn: Which historical candidate characteristics predict reactivation? Which outreach angles generate replies? Which replies predict appointments? Which candidate profiles fit which brands? Which consultant is best for which candidate? Which combinations produce actual franchise sales?

Do not prematurely build autonomous ML systems. But architect event/outcome collection correctly NOW so the dataset exists later.

## 15. EVENT-DRIVEN ARCHITECTURE

Athena should maintain an immutable or append-oriented event history where practical.

Examples: candidate.imported · identity.matched · candidate.scored · candidate.enriched · candidate.researched · brand.matched · outreach.queued · email.sent · email.delivered · email.replied · reply.classified · candidate.interested · consultant.assigned · consultant.accepted · appointment.booked · appointment.showed · brand.presented · territory.checked · application.started · candidate.closed · candidate.lost

Current state can be derived/materialized for fast application access. We want both: "What is true now?" and "Exactly how did we get here?"

## 16. OBSERVABILITY

Every autonomous action should be inspectable. We should be able to determine:

* what happened
* which service/agent did it
* why
* model used
* prompt/version where relevant
* inputs
* output
* confidence
* cost
* latency
* errors
* retries
* human overrides

Never create an autonomous black box.

## 17. ATHENA OPERATOR EXPERIENCE

Pete, Nick, administrators and eventually consultants should NOT need to understand the underlying agent infrastructure. They interact with one product: ATHENA.

Potential home dashboard — TODAY: Candidates evaluated · Candidates researched · Candidates contacted · Replies · Positive conversations · Qualified candidates · Consultant introductions · Appointments · Opportunities · Projected pipeline · Closed revenue

Potential sections: Dashboard · Candidates · Conversations · Opportunities · Consultants · Franchises · Campaigns · Intelligence · Analytics · Agent Operations · Settings

A candidate record should make it immediately obvious:

WHO IS THIS? WHY DO WE CARE? WHAT DO WE KNOW? WHAT HAS HAPPENED? WHAT DOES ATHENA RECOMMEND? WHAT HAPPENS NEXT?

## 18. SECURITY / MULTI-TENANCY

Design production-grade authentication and authorization. Roles may include: Super Admin, FCC Admin, Manager, Consultant, Analyst, Read Only.

Consultants should generally see only records appropriate to them. Administrative users may see organization-wide intelligence. Sensitive financial information requires appropriate access control. All important changes should be auditable. Do not expose internal agent infrastructure directly to normal users.

## 19. DEPLOYMENT

Assume modern cloud deployment. Prefer:

* Dockerized services where appropriate
* environment-based configuration
* migrations
* CI/CD
* staging + production
* structured logging
* error monitoring
* queue-backed asynchronous jobs
* retry policies
* dead-letter handling
* idempotent webhook processing

Do not create an unnecessarily distributed microservice architecture. A well-structured modular monolith is preferable initially unless there is a concrete scaling reason to split services. We need to process potentially very large datasets, but that does NOT automatically justify microservices.

## 20. DESIGN PRINCIPLE

The application should feel like: Palantir meets a modern CRM meets an AI workforce — for franchise candidate intelligence.

Not a generic SaaS template. Not a chatbot with a sidebar. Not a collection of automation workflows. Not an AI demo.

Athena should feel like a serious intelligence and revenue operations platform. Information density is good when organized properly. Operators should feel like they are sitting at a command center.

## 21. WHAT I WANT YOU TO DO FIRST

DO NOT begin by generating thousands of lines of code. First produce:

**A. ARCHITECTURE REVIEW** — Challenge the proposed stack. Specifically evaluate: Twenty, Supabase/Postgres, Paperclip, OpenClaw adapter, dedicated outbound email provider, direct LLM APIs. Tell me what you would KEEP, REMOVE, REPLACE, BUILD OURSELVES. Do not introduce additional frameworks unless they solve a concrete problem.

**B. SYSTEM ARCHITECTURE** — Produce the proposed Athena architecture and clearly identify: Athena-owned components, third-party/open-source components, replaceable adapters, data boundaries, agent boundaries, deterministic-code boundaries.

**C. DATA MODEL** — Design the initial PostgreSQL schema/domain model. Prioritize: Candidate, Identity, SourceRecord, CandidateAttribute, Interaction, Conversation, Message, Questionnaire, FinancialProfile, Franchise, CandidateFranchiseMatch, Consultant, Assignment, Campaign, Opportunity, Outcome, Event, AgentJob, CostRecord, Suppression. Modify this list where appropriate.

**D. REPOSITORY STRUCTURE** — Recommend the actual monorepo/project structure. Optimize for AI-assisted development by keeping modules explicit and understandable.

**E. BUILD SEQUENCE** — Break Athena into phases where every phase produces something testable. Suggested progression: Phase 0 infrastructure · 1 data ingestion · 2 candidate identity graph · 3 operator interface · 4 intelligence/scoring · 5 franchise matching · 6 outbound infrastructure · 7 AI conversation · 8 consultant routing · 9 attribution/analytics · 10 feedback/optimization. Challenge this order if necessary.

**F. FIRST VERTICAL SLICE** — Define the smallest end-to-end version capable of proving Athena's architecture. For example: Import 1,000 historical candidates → normalize → resolve duplicates → score → select 100 → research selected candidates → recommend franchise matches → generate personalized outreach → human approval → send → receive replies → classify → create warm introduction → track outcome.

**G. RISKS** — Identify the 10 largest technical/product risks before we start. Pay particular attention to: identity resolution, bad historical data, hallucinated candidate facts, email deliverability, compliance/suppression, runaway LLM/enrichment costs, framework dependency, duplicate outreach, autonomous-agent errors, inability to attribute outcomes.

## 22. HOW YOU SHOULD WORK THROUGHOUT THE BUILD

You are expected to behave as Athena's principal engineer.

Before adding a dependency, justify it. Before creating an agent, ask whether deterministic code is better. Before creating a new service, ask whether a module is sufficient. Before duplicating functionality, investigate whether our existing stack already provides it.

Protect the canonical database. Maintain strong typing. Maintain provenance. Make asynchronous operations idempotent. Design for retries. Design for failure. Write tests around business-critical logic. Document architectural decisions. Keep the system understandable enough that another senior engineer or AI coding agent can enter the repository and understand it. Do not sacrifice maintainability for impressive-looking complexity.

Most importantly:

We are not trying to build the most sophisticated multi-agent architecture possible. We are trying to build the most effective system possible for turning a massive dormant franchise candidate database into qualified conversations, consultant opportunities, franchise sales, and measurable revenue.

Start with sections A–G. Do not begin implementation until the architecture has been reviewed and accepted.
