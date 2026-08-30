# ADR 0005: Persona mailbox, not transactional email

**Status:** Accepted · 2026-08-30

Intros, nudges, and operator notifications must read as one human coordinator, or reply rates and deliverability collapse. Alternatives — Resend/Postmark-style transactional senders and templated email — are banned: they stamp transactional headers, break threading, and train recipients to ignore the address. Instead a named coordinator persona (`persona_mailbox` table) on its own warmed Google Workspace domain sends via the Gmail API with a real signature, behind the same `EmailProvider` contract the Smartlead cold pool implements.
