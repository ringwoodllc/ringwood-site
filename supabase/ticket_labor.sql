-- Labor on a ticket (internal Ringwood hours) and the money model.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.

-- Each person/vendor carries an hourly rate, edited on the Vendors page.
-- Internal Ringwood people (e.g. Tamer = 150) use this for labor cost.
alter table vendors add column if not exists hourly_rate numeric(10,2);

-- What we BILL the client for this job (separate from what it costs us).
alter table tickets add column if not exists client_price numeric(12,2);

-- Labor lines: who, how many hours, and the rate snapshotted when added
-- (so later rate changes don't rewrite past jobs). Line cost = hours * rate.
create table if not exists ticket_labor (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid references tickets(id) on delete cascade,
  person text not null,
  hours numeric(8,2) not null default 0,
  rate numeric(10,2),
  created_at timestamptz not null default now()
);
create index if not exists ticket_labor_ticket on ticket_labor(ticket_id, created_at);
