-- Warranty & purchase details for assets. Run once in Supabase.
-- Optional fields, usually read off a receipt, invoice, or warranty PDF via the
-- "Read from invoice or receipt" button on the asset editor.

alter table assets
  add column if not exists purchased_on date,
  add column if not exists purchased_from text,
  add column if not exists purchase_price numeric,
  add column if not exists warranty_provider text,
  add column if not exists warranty_length text,
  add column if not exists warranty_expires date,
  -- Extended / 2nd warranty (a protection plan, e.g. Allstate) that runs after
  -- the manufacturer's warranty ends.
  add column if not exists ext_warranty_provider text,
  add column if not exists ext_warranty_length text,
  add column if not exists ext_warranty_expires date,
  -- Who to call for support (for a Costco purchase this is Costco Concierge, not
  -- the manufacturer).
  add column if not exists support_contact text,
  add column if not exists warranty_notes text,
  -- Admin-only troubleshoot files: the invoices and screenshots used to fill the
  -- warranty in, kept for reference. [{url, name, type, at}]
  add column if not exists admin_docs jsonb default '[]'::jsonb;
