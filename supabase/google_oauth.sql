-- One org-wide Google connection (the admin's Gmail) so the app can create a
-- ready draft in Gmail automatically. Tokens are written by the Worker with the
-- service key only; never exposed to the browser.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.

create table if not exists app_oauth (
  provider      text primary key,        -- 'google'
  email         text,                    -- the connected Gmail address
  refresh_token text,
  access_token  text,
  expires_at    timestamptz,
  updated_at    timestamptz not null default now()
);
