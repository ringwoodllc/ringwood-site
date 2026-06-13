-- Roles / privileges for a food-service location, used by the employee setup
-- dropdown. Typically just a few per location (e.g. Crew Plus / DD Shift,
-- DD Shift, Manager). Run once in Supabase: SQL Editor -> New query -> Run.

create table if not exists employee_roles (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid references clients(id) on delete cascade,
  name       text not null,
  sort       int not null default 0,
  created_at timestamptz not null default now(),
  unique (client_id, name)
);
create index if not exists employee_roles_client on employee_roles(client_id, sort, created_at);
