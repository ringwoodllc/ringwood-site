-- Magic-link logins for clients (no password). A token maps to an app_users
-- account; visiting its link signs that client in to their own scoped data.
-- Long-lived and revocable. The worker (service key) is the only reader.
--
-- Run once: Supabase SQL Editor -> New query -> paste -> Run.

create table if not exists login_tokens (
  token text primary key,
  user_email text not null references app_users(email) on update cascade on delete cascade,
  label text,
  expires_at timestamptz,
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);
alter table login_tokens enable row level security;
-- Allow editing a login's email without breaking its magic links:
alter table login_tokens drop constraint if exists login_tokens_user_email_fkey;
alter table login_tokens add constraint login_tokens_user_email_fkey
  foreign key (user_email) references app_users(email) on update cascade on delete cascade;
