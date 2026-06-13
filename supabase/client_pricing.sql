-- Per-client default pricing, and the per-ticket pricing it seeds.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
--
-- markup_pct is one percentage applied to the whole job cost (labor + parts +
-- the selected vendor quote). service_fee is a flat add. A client carries the
-- defaults; a ticket carries its own values (seeded from the client, then
-- overridable on the ticket).

alter table clients add column if not exists markup_pct  numeric(6,2);
alter table clients add column if not exists service_fee numeric(12,2);

alter table tickets add column if not exists markup_pct  numeric(6,2);
alter table tickets add column if not exists service_fee numeric(12,2);
