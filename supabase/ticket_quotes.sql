-- Vendor quotes on a ticket (getting prices before dispatching the work).
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Accepting a quote assigns the vendor and writes the vendor cost onto the
-- ticket's service call; the others are marked Declined as a record of
-- diligence.

create table if not exists ticket_quotes (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid references tickets(id) on delete cascade,
  vendor text not null,
  amount numeric(12,2),
  notes text,
  status text not null default 'Pending',   -- 'Pending' | 'Accepted' | 'Declined'
  created_at timestamptz not null default now()
);
create index if not exists ticket_quotes_ticket on ticket_quotes(ticket_id, created_at);
