-- Small key/value store for org-wide app settings.
-- Used by "Send to printer" (email-to-print) to remember the printer's
-- print-by-email address. Written by the Worker with the service key only;
-- never exposed to the browser.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.

create table if not exists app_settings (
  key        text primary key,        -- e.g. 'printer_email'
  value      text,
  updated_at timestamptz not null default now()
);
alter table app_settings enable row level security;
