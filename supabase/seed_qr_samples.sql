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
