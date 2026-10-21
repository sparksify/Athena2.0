-- Each consultant's GHL sub-account has its own pipelines with its own
-- names, so the opportunity mirror needs a pipeline per consultant (id or
-- name inside their sub-account). Null = the sub-account's only pipeline,
-- or GHL_PIPELINE_NAME / GHL_PIPELINE_ID when that is set.
alter table "consultant" add column "ghl_pipeline" text;
