-- A rejected draft can be rewritten from the reviewer's note; the new draft
-- points at the one it replaces so the queue can show what changed and why.
alter table "outreach_draft" add column "revision_of" uuid references "outreach_draft"("id");
