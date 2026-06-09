-- Magic-link logins for clients (no password). A token maps to an app_users
-- account; visiting its link signs that client in to their own scoped data.
-- Long-lived and revocable. The worker (service key) is the only reader.
--
-- Run once: Supabase SQL Editor -> New query -> paste -> Run.

create table if not exists login_tokens (
  token text primary key,
  user_email text not null references app_users(email) on delete cascade,
  label text,
  expires_at timestamptz,
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);
alter table login_tokens enable row level security;
