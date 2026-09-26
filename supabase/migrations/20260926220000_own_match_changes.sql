-- "Meine Spiele" mit fussball.de abgleichen (Edge Function sync-own-matches):
-- Änderungshinweis je Spiel, bis Matti das Spiel in der App geöffnet hat.
alter table public.scouting_matches
  add column if not exists change_note text,
  add column if not exists changed_at timestamptz,
  add column if not exists change_seen_at timestamptz;

-- 3x täglich (nach den fussball.de-Syncs der KMH-App)
select cron.unschedule('sync-own-matches') where exists (
  select 1 from cron.job where jobname = 'sync-own-matches'
);
select cron.schedule(
  'sync-own-matches',
  '30 5,11,17 * * *',
  $$
  select net.http_post(
    url := 'https://ozggtruvnwozhwjbznsm.supabase.co/functions/v1/sync-own-matches',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);
