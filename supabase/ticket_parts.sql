-- Parts & materials needed for a ticket, and the office "Parts to buy" list.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Until this table exists, the parts UI and the Parts-to-buy page degrade
-- gracefully (they show "not set up yet").

create table if not exists ticket_parts (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid references tickets(id) on delete cascade,
  item text not null,
  quantity numeric not null default 1,
  unit text,
  status text not null default 'Needed',   -- 'Needed' | 'Ordered' | 'Received'
  est_cost numeric,
  source text,                              -- where to buy it (vendor/store)
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists ticket_parts_ticket on ticket_parts(ticket_id, created_at);
create index if not exists ticket_parts_status on ticket_parts(status);
