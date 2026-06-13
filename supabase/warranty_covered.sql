-- Warranty handling on a job.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
--
-- A part or a vendor quote can be "covered by warranty": it stays on the
-- record for the history, but it counts as $0 toward the job cost (the
-- manufacturer or vendor pays for it, not us). Ringwood still bills its own
-- service / PM fee on top, so a warranty call is not a free call.

alter table ticket_parts  add column if not exists warranty_covered boolean not null default false;
alter table ticket_quotes add column if not exists warranty_covered boolean not null default false;
