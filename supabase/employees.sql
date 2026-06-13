-- Employee roster for a food-service client (the "ID" section): name, phone,
-- POS login key, payroll name, role/privilege, crew number, and pay rates.
-- Foundation for the weekly schedule and payroll-check summary.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.

create table if not exists employees (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid references clients(id) on delete cascade,
  name         text not null,
  phone        text,
  pos_key      text,                 -- POS # / login key, e.g. 8011
  pos_password text,                 -- POS password, e.g. 3625388011
  payroll_name text,                 -- e.g. "Alam, Mohammed"
  role         text,                 -- e.g. "Crew Plus / DD Shift", "Manager"
  crew_no      text,                 -- e.g. "Crew 0"
  rate         numeric(10,2),        -- hourly rate
  ot_rate      numeric(10,2),        -- overtime rate
  active       boolean not null default true,
  sort         int not null default 0,
  created_at   timestamptz not null default now()
);
-- If the table already existed, make sure the newer columns are present:
alter table employees add column if not exists pos_password text;
create index if not exists employees_client on employees(client_id, sort, created_at);
