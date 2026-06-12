-- Photos on quotes and parts: the quote sheet a vendor sent, the parts invoice
-- you photographed. Run once in Supabase.
alter table ticket_quotes add column if not exists photo_urls text[];
alter table ticket_parts  add column if not exists photo_urls text[];
