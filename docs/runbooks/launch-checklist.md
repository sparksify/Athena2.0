# Launch checklist — from "envs set" to the first 100 cold emails

Ordered by dependency. Each block names who does it and how you know it worked.
The Connections page (`/ops/connections`, Agent Ops → Connections) is the
scoreboard: every row should read **OK** before the first send.

## A. Database (blocks everything)

1. **Reset the database password** — Supabase → Project Settings → Database → *Reset database password*.
2. **Set `DATABASE_URL` in Vercel** to the shared-pooler string (Vercel cannot reach the direct `db.` host):
   `postgres://postgres.baaddaravxmnevmovpad:<password>@aws-0-ca-central-1.pooler.supabase.com:6543/postgres`
3. **Redeploy** — Vercel → Deployments → latest → Redeploy. Env changes only apply to new deployments.
4. **Check:** `/ops/connections` → Database row OK, candidate count shown. Cron errors stop in Vercel logs.

## B. Remaining environment variables (Vercel → Settings → Environment Variables, then redeploy once)

5. `CRON_SECRET` — any long random string. Vercel sends it on every cron tick automatically.
6. `SMARTLEAD_WEBHOOK_SECRET` — random string; the same value goes into Smartlead's webhook config (step 15).
7. `GHL_WEBHOOK_SECRET` — random string; the same value goes into the GHL webhook URL (step 11).
8. `MANAGER_SMS_TO` — the mobile that receives the +24h escalation when a consultant stays silent.
9. `APP_URL` — `https://athena.eyeballsos.com` (already aliased) so links in intros use the real domain.

## C. GoHighLevel (one sub-account per consultant)

10a. **GoHighLevel app** — an agency-level private integration cannot read inside sub-accounts, so Athena installs its own marketplace app. In marketplace.gohighlevel.com (developer sign-in): create an app named Athena, distribution *Agency*, private; scopes Contacts (read/write), Conversations (read), Conversation Messages (read/write), Opportunities (read/write), Calendar Events (read), Locations (read), Companies (read), Users (read), OAuth (read/write); redirect URL `https://athena.eyeballsos.com/api/integrations/crm/callback`. Put the Client ID and Secret in Vercel as `GHL_CLIENT_ID` / `GHL_CLIENT_SECRET`, redeploy, then Connections → *Connect GoHighLevel* → pick the FCC agency, allow all sub-accounts. The token refreshes itself.
10. **Match consultants** — Consultants → Roster & agents → *Match consultants to GHL sub-accounts*. Fix any leftover by pasting the sub-account id into the consultant's "GHL sub-account (location) ID" field.
11. **Pipeline per sub-account** — Connections page → "GoHighLevel pipeline" row. Pipeline ids differ per sub-account; if it matches only one, replace `GHL_PIPELINE_ID` with `GHL_PIPELINE_NAME=<the pipeline's name>` and redeploy.
12. **Webhooks from GHL** — in each participating sub-account, a workflow with two triggers, *Opportunity stage changed* and *Customer replied (SMS)*, each with a Webhook action to
    `https://athena.eyeballsos.com/api/webhooks/ghl?key=<GHL_WEBHOOK_SECRET>` (POST, JSON). This is how stage changes flow back and how a consultant's "1"/"2"/"3"/"4" SMS becomes a disposition.

## D. Cold email (Smartlead)

13. **Google Workspace admin** — Security → API controls → Manage third-party app access → trust Smartlead. Without this, OAuth sign-in for the mailboxes fails.
14. **Connect the five sending mailboxes** in Smartlead → Email Accounts → Add → Google OAuth. Keep the main company domain out of the pool; cold volume belongs on the secondary domains only. Check each account's SPF/DKIM/DMARC and warm-up status in Smartlead.
15. **The API campaign** (`SMARTLEAD_API_CAMPAIGN_ID`) must have exactly one sequence step whose subject is `{{custom_subject}}` and whose body is `{{custom_email_message}}` — Athena writes those two fields per lead; Smartlead renders them verbatim. Attach all five accounts to this campaign. Set per-account daily limits at or below 30 for the pilot.
16. **Smartlead webhooks** — campaign → Settings → Webhooks: *Email Replied*, *Email Bounced*, *Lead Unsubscribed*, *Email Sent* → `https://athena.eyeballsos.com/api/webhooks/smartlead`, secret = `SMARTLEAD_WEBHOOK_SECRET`.
17. **Pull the pool into Athena** — Outreach → Campaigns & mailboxes → *Pull mailboxes from Smartlead*. Each account becomes an active mailbox (cap 30/day) with its Smartlead id.
18. **MillionVerifier credits** — Connections page shows the balance; keep it above the size of the next import. Nothing sends to an unverified or non-valid address.

## E. People

19. **Invite users** — Supabase → Authentication → Users → Invite (Pete, and anyone else). New signups land as `read_only`; send Claude the email + intended role (super_admin, fcc_admin, manager, consultant, analyst, read_only) and the role is set.
20. **Participating consultants** — on the roster, each needs email, mobile (nudges go by SMS from their own sub-account), timezone and specialties/territories if routing should use them. Pause everyone who is not in the first test.

## F. Data

21. **Athena 1.0 contacted list** (from Pete) — Claude runs the one-time retirement import: every contacted address → suppression, history → source records. Nothing in this list is ever cold-emailed again.
22. **Pilot leads file** — Import page → pick the source type (trade show, resume, purchased, …), add the label (e.g. "IFA Expo Las Vegas 2026"), upload. Verification, GHL history lookups, scoring and research run on their own within 10 minutes.
23. **Check the cohort** — Candidates list shows scores; Candidate 360 shows "In the CRM" and "Research" panels filled for the top of the list.

## G. First sends (Phase 5 proof)

24. **Create a campaign** — Outreach → Campaigns → New: minimum score, angle. Enrolls the cohort.
25. **Draft a batch** → drafts land in the approval queue. Every email is human-approved; nothing auto-sends.
26. **Approve** → the scheduler sends approved drafts every 10 minutes through the pool, under each mailbox's cap and window, after the suppression and verification gates.
27. **Proof** (Claude runs it): 100 approved emails across the pool; a test unsubscribe lands in suppression within 60 s and blocks the next send; a duplicate send is refused and logged.

## H. After replies start (Phases 6–7)

28. **Replies** are classified; `asks_what_this_is` and `needs_info` at ≥ 0.90 get an auto-reply, everything else goes to Conversations (flagged first).
29. **Coordinator persona** — a new warmed Google Workspace domain for Tim/Sophie/Claire/Rina, a service account with domain-wide delegation (scope `gmail.send`), `GMAIL_SERVICE_ACCOUNT_JSON` in Vercel, and each persona's address on the roster. Warm intros to consultants go from here.
30. **Calendly** — webhook subscription to `https://athena.eyeballsos.com/api/webhooks/calendly` (invitee created/canceled) and `CALENDLY_WEBHOOK_SIGNING_KEY` in Vercel. Appointments then drive the +1h/+4h/+24h disposition ladder.
