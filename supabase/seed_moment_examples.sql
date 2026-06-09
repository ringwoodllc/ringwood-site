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
