-- One-time setup so the app can apply its OWN schema changes — no more pasting SQL.
-- This creates a locked-down function that ONLY the app's server (service) key can
-- call. The app runs its idempotent migrations through it automatically (hourly and
-- from Admin -> Apply database updates). After this, new fields just appear.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.

create or replace function exec_ddl(stmt text) returns void
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  execute stmt;
end;
$$;

-- Lock it down: not callable by the public/anon/logged-in API roles, only the
-- server-side service role the Worker uses.
revoke all on function exec_ddl(text) from public, anon, authenticated;
grant execute on function exec_ddl(text) to service_role;
