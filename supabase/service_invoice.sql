-- Invoice detail on a service record, so a job can be billed later.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- `technician` stays as Tech 1; `cost` stays as the labor/service charge.

alter table service_records
  add column if not exists tech2 text,                 -- second technician
  add column if not exists travel_hours numeric(6,2),  -- travel time, hours
  add column if not exists vendor_cost numeric(12,2),  -- what an outside vendor charged
  add column if not exists parts text,                 -- parts purchased for the job
  add column if not exists parts_cost numeric(12,2),   -- cost of those parts
  add column if not exists ticket_id uuid references tickets(id);  -- the ticket this came from
create index if not exists service_ticket_idx on service_records (ticket_id);
