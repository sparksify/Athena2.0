-- Upload label: what the operator typed about the batch (event name, city,
-- which consultant handed it back). Lives on the batch; each candidate also
-- gets a source_label attribute with the source record as provenance.
alter table "import_batch" add column "label" text;
