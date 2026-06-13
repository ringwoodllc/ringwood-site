-- QuickBooks Online connection. Reuses the same app_oauth table as Google: one
-- org-wide connection, written by the Worker with the service key only, never
-- exposed to the browser. QBO needs the company id (realmId) too, so add a
-- realm_id column. The app uses this connection READ-ONLY, to reconcile the
-- employee roster against QuickBooks (who is in both, who is only in the app,
-- who is only in QBO). New payroll employees still get created in QuickBooks by
-- hand: Intuit does not allow third parties to create payroll employees by API.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.

create table if not exists app_oauth (
  provider      text primary key,        -- 'google' or 'qbo'
  email         text,
  refresh_token text,
  access_token  text,
  expires_at    timestamptz,
  updated_at    timestamptz not null default now()
);
alter table app_oauth add column if not exists realm_id text;  -- QBO company id
