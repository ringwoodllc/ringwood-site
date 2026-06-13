-- ============================================================
-- Ringwood — ONE-SHOT SETUP. Run once in Supabase SQL Editor. Safe to re-run.
-- ============================================================

-- ===== 1) Core schema =====
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
  address text,
  color text,
  primary_contact text,
  email text,
  phone text,
  notes text,
  created_at timestamptz not null default now()
);
alter table clients add column if not exists address text;
alter table clients add column if not exists color text;

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
  nickname text,
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
alter table assets add column if not exists nickname text;

create table if not exists tickets (
  id uuid primary key default gen_random_uuid(),
  ref text,
  title text,
  category_id uuid references ticket_categories(id),
  client_id uuid references clients(id),
  asset_id uuid references assets(id),            -- optional: the asset this ticket is about
  description text,
  location text,
  status text not null default 'Open',            -- Open | Scheduled | In Progress | Complete | Archived
  photo_url text,
  photo_urls text[],
  created_at timestamptz not null default now()
);
create index if not exists tickets_client_idx on tickets (client_id);
create index if not exists tickets_status_idx on tickets (status);
-- For databases created before multi-photo tickets / asset links:
alter table tickets add column if not exists photo_urls text[];
alter table tickets add column if not exists asset_id uuid references assets(id);
-- Human review: tickets start "needs review" (AI/client wrote them); a person
-- confirms once they've checked it. Optional free-text assignee.
alter table tickets add column if not exists reviewed boolean not null default false;
alter table tickets add column if not exists assigned_to text;

-- Per-ticket update log: typed notes plus automatic events (status changes).
create table if not exists ticket_comments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets(id) on delete cascade,
  author text not null,                       -- "Ringwood" or the client name
  role text not null,                         -- 'master' | 'client'
  kind text not null default 'note',          -- 'note' | 'event'
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists ticket_comments_ticket_idx on ticket_comments (ticket_id);
-- A note can carry photos (shown inline in the log, in time order).
alter table ticket_comments add column if not exists photo_urls text[];
alter table ticket_comments enable row level security;

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

-- ===== 2) Login accounts =====
-- Login accounts for the app. The worker verifies passwords against this table
-- (PBKDF2) and issues a signed session carrying the role and client scope.
-- A 'master' sees every client. A 'client' login only sees its own data.
--
-- Run once: Supabase SQL Editor -> New query -> paste -> Run.
-- After signing in, change the temporary passwords (see note at the bottom).

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  username text unique,                          -- optional, simple sign-in name
  password_hash text not null,
  role text not null default 'client',          -- 'master' | 'client'
  client_id uuid references clients(id),         -- null for master
  active boolean not null default true,
  perms jsonb not null default '{"tickets":"edit","assets":"edit","service":"edit"}'::jsonb,  -- per-area: none|view|edit
  created_at timestamptz not null default now()
);
alter table app_users enable row level security;   -- worker uses service key; browser never reads this
-- For databases created before these columns existed:
alter table app_users add column if not exists perms jsonb not null default '{"tickets":"edit","assets":"edit","service":"edit"}'::jsonb;
alter table app_users add column if not exists username text unique;

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

-- ===== 3) Magic-link tokens =====
-- Magic-link logins for clients (no password). A token maps to an app_users
-- account; visiting its link signs that client in to their own scoped data.
-- Long-lived and revocable. The worker (service key) is the only reader.
--
-- Run once: Supabase SQL Editor -> New query -> paste -> Run.

create table if not exists login_tokens (
  token text primary key,
  user_email text not null references app_users(email) on update cascade on delete cascade,
  label text,
  expires_at timestamptz,
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);
alter table login_tokens enable row level security;
-- Allow editing a login's email without breaking its magic links:
alter table login_tokens drop constraint if exists login_tokens_user_email_fkey;
alter table login_tokens add constraint login_tokens_user_email_fkey
  foreign key (user_email) references app_users(email) on update cascade on delete cascade;

-- One org-wide Google connection (the admin's Gmail), so the app can create
-- drafts and send email (e.g. email-to-print). Written by the Worker only.
create table if not exists app_oauth (
  provider      text primary key,        -- 'google'
  email         text,
  refresh_token text,
  access_token  text,
  expires_at    timestamptz,
  updated_at    timestamptz not null default now()
);
alter table app_oauth enable row level security;

-- Small key/value store for org-wide app settings (e.g. the printer's
-- print-by-email address used by "Send to printer").
create table if not exists app_settings (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);
alter table app_settings enable row level security;

-- ===== 4) Sample QR assets =====
-- Three sample assets with QR tags (QR-1, QR-2, QR-3) so you can demo the
-- "scan a code, jump straight to the asset" flow without printing anything yet.
-- Run once: Supabase SQL Editor -> New query -> paste -> Run. Skips ones already there.

insert into assets (name, description, make, model, serial, equipment_type_id, location_id, client_id, verification, qr_tag, logged_at)
select
  v.name, v.description, v.make, v.model, v.serial,
  (select id from equipment_types where name = v.etype),
  (select id from locations where name = v.loc),
  (select id from clients where name = 'Moment'),
  'Verified', v.qr, now()
from (values
  ('HP Color LaserJet Pro Printer','Shared office printer near the copy area.','HP','M255dw','SN-HP-44821','Office Equipment','Office','QR-1'),
  ('Conference Room TV','Wall-mounted display used for Zoom rooms and all-hands.','Samsung','QN65Q60','SN-SS-90142','AV','Conference Room','QR-2'),
  ('Kitchen Refrigerator','Full-size fridge in the kitchen / break room.','GE','GFE26JYMFS','SN-GE-31775','Refrigeration / Freezer','Kitchen / Break Room','QR-3')
) as v(name, description, make, model, serial, etype, loc, qr)
where not exists (select 1 from assets a where a.qr_tag = v.qr);

-- ===== 5) Sample Moment tickets =====
-- Example tickets for Moment (395 Hudson office), drawn from the Office
-- Maintenance Overview. Gives real, varied data to review: Complete,
-- In Progress, Scheduled, and Open. No photos yet (add them from the app).
--
-- Run once: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
-- Safe to run more than once: it skips any ref it already inserted.

insert into tickets (ref, title, category_id, client_id, description, location, status, created_at)
select
  v.ref,
  v.title,
  (select id from ticket_categories where name = v.category),
  (select id from clients where name = 'Moment'),
  v.description,
  v.location,
  v.status,
  now() - (v.days || ' days')::interval
from (values
  -- Recently completed
  ('RW-3001','Repair Ceiling Light Timers and Floor Outlet','Repair','Office',
    'Reprogram and repair the ceiling light timers and repair a floor outlet. Licensed union electrician.','Complete',38),
  ('RW-3002','Reattach Kitchen Cabinet Door','Repair','Kitchen / Break Room',
    'Reattach a loose kitchen cabinet door. Union carpentry.','Complete',34),
  ('RW-3003','IT Closet Asset Disposition and Cleanup','Other','Server / IT Room',
    'Dispose of retired IT equipment (e-waste) and clean up the IT closet. Vendor.','Complete',30),
  ('RW-3004','Printer Repair and Install','Repair','Office',
    'Repair an existing printer and install a replacement. Vendor.','Complete',26),
  ('RW-3005','Restore Conference Room AV After Power Shutoff','Repair','Conference Room',
    'Restore conference room AV after a Con Edison power shutoff. In-house.','Complete',20),
  ('RW-3006','Install All-Hands Microphone','Install / Setup','Conference Room',
    'Install a microphone for all-hands meetings. In-house.','Complete',16),
  -- Scheduled / in progress
  ('RW-3007','Replace ADA Bathroom Toilet Paper Holder','Install / Setup','Restroom',
    'Replace the ADA bathroom toilet paper holder. Union.','In Progress',6),
  ('RW-3008','Reinstall Kitchen Glass Wall','Install / Setup','Kitchen / Break Room',
    'Reinstall the kitchen glass wall. Union.','In Progress',4),
  ('RW-3009','Repair Phone Booth Door','Repair','Office',
    'Repair the phone booth door. Under warranty, scheduling pending with the union vendor.','Scheduled',3),
  -- Upcoming
  ('RW-3010','Clean Up Conference Room Equipment','Maintenance','Conference Room',
    'High priority. Clean up and tidy conference room equipment for better functionality. Vendor.','Open',2),
  ('RW-3011','Configure and Name Printers','Install / Setup','Office',
    'High priority. Configure and name the printers, and document a how-to-connect walkthrough. In-house.','Open',2),
  ('RW-3012','Install TV Mount','Install / Setup','Office',
    'Install a TV wall mount. A part-time employee cancelled the visit twice; needs rescheduling. In-house.','Open',1),
  ('RW-3013','Patch Wall Under SOTM TV','Repair','Office',
    'Patch the wall under the State of the Month TV. Redo of an earlier part-time attempt. In-house.','Open',1),
  ('RW-3014','Repair Small Kitchen Fridge','Repair','Kitchen / Break Room',
    'Repair the small kitchen fridge, possibly add coolant. HVAC vendor, in-house preferred if possible.','Open',0),
  ('RW-3015','Install Conference Room Expansion Mic','Install / Setup','Conference Room',
    'Install an expansion microphone in a conference room. Equipment purchase needed first. In-house.','Open',0),
  ('RW-3016','Remove Monitor Mounts From Desks','Other','Office',
    'Remove monitor mounts from desks. Vendor.','Open',0)
) as v(ref, title, category, location, description, status, days)
where not exists (select 1 from tickets t where t.ref = v.ref);
