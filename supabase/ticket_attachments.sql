-- Photos on quotes and parts: the quote sheet a vendor sent, the parts invoice
-- you photographed. Run once in Supabase.
alter table ticket_quotes add column if not exists photo_urls text[];
alter table ticket_parts  add column if not exists photo_urls text[];
-- Dialog thread on each quote (back-and-forth with the vendor), kept out of
-- the ticket's update log. Entries store a timestamp for later; not shown yet.
alter table ticket_quotes add column if not exists comments jsonb not null default '[]'::jsonb;
