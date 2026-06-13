-- A scanned business card / quote image kept on the vendor for human
-- verification. The image is AI-cropped to the card before it's saved.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.

alter table vendors add column if not exists card_url text;
