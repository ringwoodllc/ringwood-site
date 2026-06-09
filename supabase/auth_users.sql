-- Login accounts for the app. The worker verifies passwords against this table
-- (PBKDF2) and issues a signed session carrying the role and client scope.
-- A 'master' sees every client. A 'client' login only sees its own data.
--
-- Run once: Supabase SQL Editor -> New query -> paste -> Run.
-- After signing in, change the temporary passwords (see note at the bottom).

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  role text not null default 'client',          -- 'master' | 'client'
  client_id uuid references clients(id),         -- null for master
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table app_users enable row level security;   -- worker uses service key; browser never reads this

-- Master account (sees all clients).
insert into app_users (email, password_hash, role, client_id) values
  ('tbone39@gmail.com', 'pbkdf2$100000$9-_tNGfkYcUVPMtIj2pEXg$w5UD3E8NazEOaQoGzJkMSTczvdeUypGsk4n0wnx2_gk', 'master', null)
  on conflict (email) do nothing;

-- Sample client login (scoped to Moment).
insert into app_users (email, password_hash, role, client_id)
select 'moment@ringwood.ai', 'pbkdf2$100000$K-O6lBbWhR4msyZXj0Fx1w$yE5uPxHd-HnFK2yHz-hODDY88BTIBybLS06fKjdk2bU', 'client',
       (select id from clients where name = 'Moment')
  on conflict (email) do nothing;

-- Temporary passwords (change after first sign-in via the app):
--   tbone39@gmail.com   ->  Ringwood-Master-7421     (master, all clients)
--   moment@ringwood.ai  ->  Moment-2026              (client, Moment only)
--
-- To add another client login later, create the client in the clients table,
-- then add a row here. Generate the password_hash by signing in to the app as
-- master and using the account tools, or ask Claude to generate one.
