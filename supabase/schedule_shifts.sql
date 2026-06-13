-- Weekly schedule: one In/Out shift per employee per day. The schedule is
-- "typically the same week to week", so the app copies a prior week forward and
-- you tweak it. Times are stored as 24h "HH:MM" text.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.

create table if not exists schedule_shifts (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid references employees(id) on delete cascade,
  work_date   date not null,
  in_time     text,
  out_time    text,
  created_at  timestamptz not null default now(),
  unique (employee_id, work_date)
);
create index if not exists schedule_shifts_emp on schedule_shifts(employee_id, work_date);
