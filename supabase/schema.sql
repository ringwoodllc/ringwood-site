-- Ringwood backend schema for Supabase (Postgres)
-- Run this once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query -> paste -> Run).
-- It creates every table, the relationships (foreign keys), seeds the master
-- lists, and locks the data down so only the server can read/write it.

create extension if not exists "pgcrypto";

-- ============================================================
-- Master / lookup tables (each value has a permanent id;
-- rename the name and every row that references it follows.)
-- ============================================================
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  status text not null default 'Active',        -- Active | Prospect | Churned
  legal_name text,
  primary_contact text,
  email text,
  phone text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists equipment_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 100,
  active boolean not null default true
);

create table if not exists locations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 100,
  active boolean not null default true
);

create table if not exists service_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 100,
  active boolean not null default true
);

create table if not exists ticket_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 100,
  active boolean not null default true,
  photo_required boolean not null default false,
  notes text
);

-- ============================================================
-- Core data tables
-- ============================================================
create table if not exists assets (
  id uuid primary key default gen_random_uuid(),
  name text,
  description text,
  make text,
  model text,
  serial text,
  equipment_type_id uuid references equipment_types(id),
  location_id uuid references locations(id),
  client_id uuid references clients(id),
  notes text,
  verification text not null default 'Pending',   -- Pending | AI suggested | Verified
  nameplate_reading text,
  overall_photo_url text,
  nameplate_photo_url text,
  serial_photo_url text,
  qr_tag text,
  logged_at timestamptz not null default now()
);
create index if not exists assets_client_idx on assets (client_id);
create index if not exists assets_type_idx on assets (equipment_type_id);
-- Assets now hold any number of photos in one list (overall first, then the
-- nameplate, then whatever else). The three legacy columns above still work for
-- older rows; the app reads photo_urls when it is present.
alter table assets add column if not exists photo_urls text[];

create table if not exists tickets (
  id uuid primary key default gen_random_uuid(),
  ref text,
  title text,
  category_id uuid references ticket_categories(id),
  client_id uuid references clients(id),
  description text,
  location text,
  status text not null default 'Open',            -- Open | Closed | Archived
  photo_url text,
  photo_urls text[],
  created_at timestamptz not null default now()
);
create index if not exists tickets_client_idx on tickets (client_id);
create index if not exists tickets_status_idx on tickets (status);
-- For databases created before multi-photo tickets:
alter table tickets add column if not exists photo_urls text[];

create table if not exists service_records (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid references assets(id),
  client_id uuid references clients(id),
  service_type_id uuid references service_types(id),
  service_date date,
  technician text,
  notes text,
  cost numeric(12,2),
  photo_urls text[],
  logged_at timestamptz not null default now()
);
create index if not exists service_asset_idx on service_records (asset_id);

create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  phone text,
  company text,
  stage text,
  timeline text,
  message text,
  status text not null default 'New',
  created_at timestamptz not null default now()
);

-- ============================================================
-- Seed the master lists (your current values)
-- ============================================================
insert into clients (name) values ('Moment'),('Robin'),('United')
  on conflict (name) do nothing;

insert into equipment_types (name, sort_order) values
  ('Office Equipment',10),('HVAC',20),('AV',30),('Beverage',40),
  ('Refrigeration / Freezer',50),('Other',99)
  on conflict (name) do nothing;

insert into locations (name, sort_order) values
  ('Office',10),('Conference Room',20),('Kitchen / Break Room',30),('Reception / Lobby',40),
  ('Hallway',50),('Restroom',60),('Storage / Closet',70),('Server / IT Room',80),
  ('Mechanical Room',90),('Basement',100),('Rooftop',110),('Attic',120),
  ('Exterior / Grounds',130),('Garage / Parking',140),('Other',999)
  on conflict (name) do nothing;

insert into service_types (name, sort_order) values
  ('Inspection',10),('Maintenance',20),('Repair',30),('Install',40),('Replacement',50),('Other',99)
  on conflict (name) do nothing;

insert into ticket_categories (name, sort_order, notes) values
  ('Repair',10,'Something broke or is not working.'),
  ('Maintenance',20,'Routine or preventive upkeep.'),
  ('Install / Setup',30,'Add or set up something new.'),
  ('Buildout / Project',40,'Larger planned work.'),
  ('Other',99,'Catch-all when nothing else fits.')
  on conflict (name) do nothing;

-- ============================================================
-- Security: turn on row-level security with NO public policies.
-- That denies the anon/public key entirely. The worker uses the
-- service_role key, which bypasses RLS, and the browser never
-- talks to Supabase directly. So the data is private by default.
-- ============================================================
alter table clients          enable row level security;
alter table equipment_types  enable row level security;
alter table locations        enable row level security;
alter table service_types    enable row level security;
alter table ticket_categories enable row level security;
alter table assets           enable row level security;
alter table tickets          enable row level security;
alter table service_records  enable row level security;
alter table contacts         enable row level security;
