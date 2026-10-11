-- One-time setup for the Operant Supabase project (run in the SQL editor).
-- Tables themselves come from Drizzle migrations: `pnpm db:migrate`.

-- 1. Private bucket for attachments. The API uploads with the secret key and
--    hands out short-lived signed URLs, so no storage policies are needed.
insert into storage.buckets (id, name, public, file_size_limit)
values ('operant', 'operant', false, 26214400)
on conflict (id) do nothing;

-- 2. Realtime: members may only listen on their own org's topic ("org:<org uuid>").
--    The org_id claim comes from the short-lived token minted by /api/supabase-token.
--    Events carry ids only; the browser fetches content through the API, which
--    enforces channel membership and permissions.
alter table realtime.messages enable row level security;

drop policy if exists "operant members read own org channels" on realtime.messages;
drop policy if exists "operant members send to own org channels" on realtime.messages;
drop policy if exists "operant members listen to their org" on realtime.messages;
create policy "operant members listen to their org"
  on realtime.messages for select
  to authenticated
  using (realtime.topic() = 'org:' || (auth.jwt() ->> 'org_id'));

-- 3. Nightly member re-sync with Webrizen SSO (needs pg_cron + pg_net enabled
--    under Database → Extensions). Replace the URL and secret.
-- select cron.schedule(
--   'operant-sync-members', '30 20 * * *',  -- 02:00 IST
--   $$ select net.http_post(
--        url := 'https://app.siemmi.com/api/cron/sync-members',
--        headers := jsonb_build_object('authorization', 'Bearer <CRON_SECRET>')
--      ) $$
-- );

-- 4. Daily finance job: retainer invoices and overdue reminders (09:00 IST).
-- select cron.schedule(
--   'operant-finance', '30 3 * * *',
--   $$ select net.http_post(
--        url := 'https://app.siemmi.com/api/cron/finance',
--        headers := jsonb_build_object('authorization', 'Bearer <CRON_SECRET>')
--      ) $$
-- );
