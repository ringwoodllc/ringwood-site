-- Per-location QuickBooks connections. Each Ringwood client (location) connects to
-- its own QuickBooks company, so the roster for that location can be reconciled
-- against that company's employee list. One Intuit developer app (the Cloudflare
-- secrets QBO_CLIENT_ID / QBO_CLIENT_SECRET) authorizes all of them; each row here
-- holds one company's realm id and tokens. Written by the Worker with the service
-- key only, never exposed to the browser. Read-only against QuickBooks: the app
-- never writes to QBO, and it does not create payroll employees (Intuit does not
-- allow third parties to do that by API, so new people are added in QuickBooks by
-- hand and the reconcile view tells you who).
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.

create table if not exists qbo_connections (
  client_id     uuid primary key references clients(id) on delete cascade,
  realm_id      text not null,          -- the QBO company id
  company_name  text,                   -- for display, e.g. "United Star LLC"
  refresh_token text,
  access_token  text,
  expires_at    timestamptz,
  updated_at    timestamptz not null default now()
);
