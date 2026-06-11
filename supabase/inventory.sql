-- Baskin Robbins inventory (photo-driven counts). Run once in Supabase.
-- A "count" is one inventory session (like a ticket). Photos are filed under a
-- count; the AI reads each photo into line items. Items carry the on-hand read
-- (tubs / 8-packs / a dipping-cabinet partial) and a "need to buy" quantity.

create table if not exists inventory_counts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  status text not null default 'open',          -- 'open' | 'done'
  note text,
  created_by text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists inventory_counts_client on inventory_counts(client_id, created_at desc);

create table if not exists inventory_photos (
  id uuid primary key default gen_random_uuid(),
  count_id uuid references inventory_counts(id) on delete cascade,
  client_id uuid references clients(id) on delete cascade,
  url text not null,
  kind text,                                     -- hint: 'tubs' | 'pack' | 'cabinet'
  created_at timestamptz not null default now()
);
create index if not exists inventory_photos_count on inventory_photos(count_id, created_at);

create table if not exists inventory_items (
  id uuid primary key default gen_random_uuid(),
  count_id uuid references inventory_counts(id) on delete cascade,
  client_id uuid references clients(id) on delete cascade,
  photo_id uuid references inventory_photos(id) on delete set null,
  product text not null default '',              -- readable name, e.g. "Strawberry Cheesecake"
  label text,                                    -- the abbreviation on the tub, e.g. "B-R STRBY CHS"
  kind text not null default 'tub',              -- 'tub' (3 gal) | 'pack' (8-pack) | 'cabinet' | 'other'
  qty numeric not null default 1,                -- count of tubs / packs (cabinet uses fullness)
  fullness text,                                 -- cabinet: 'full' | 'half' | 'low'
  placement text,
  need numeric,                                  -- suggested quantity to buy (user-entered for now)
  created_at timestamptz not null default now()
);
create index if not exists inventory_items_count on inventory_items(count_id, created_at);

-- Order / purchase history, by day. items is a JSON array of { product, qty }
-- (no cost). The page lays orders out as a trend grid to spot reorder timing.
create table if not exists inventory_orders (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  order_date date not null default current_date,
  label text,
  items jsonb not null default '[]',
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists inventory_orders_client on inventory_orders(client_id, order_date desc);
-- order_date holds the DELIVERY date (what the trend and "last delivered" sort by).
-- These keep the DFA order number and dollar amount alongside it.
alter table inventory_orders add column if not exists order_no text;
alter table inventory_orders add column if not exists amount numeric;
alter table inventory_orders add column if not exists ordered_on date;

-- Product catalog (the order form's list). Seeded from the app's built-in list;
-- grows when you identify an unknown line on an uploaded order.
create table if not exists inventory_products (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  name text not null,
  category text,
  created_at timestamptz not null default now()
);
create index if not exists inventory_products_client on inventory_products(client_id, name);
