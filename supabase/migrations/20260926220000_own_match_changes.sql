-- "Meine Spiele" mit fussball.de abgleichen (Edge Function sync-own-matches):
-- Änderungshinweis je Spiel, bis Matti das Spiel in der App geöffnet hat.
alter table public.scouting_matches
  add column if not exists change_note text,
  add column if not exists changed_at timestamptz,
  add column if not exists change_seen_at timestamptz;

-- 07:00 (MESZ) alle eigenen Spiele über area_games (nach sync-area-games 04:37 UTC);
-- 12:00 Spieltag-Check für heute/morgen frisch von fussball.de
select cron.unschedule(jobname) from cron.job where jobname in ('sync-own-matches', 'sync-own-matches-gameday');
select cron.schedule(
  'sync-own-matches',
  '0 5 * * *',
  $$
  select net.http_post(
    url := 'https://ozggtruvnwozhwjbznsm.supabase.co/functions/v1/sync-own-matches',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);
select cron.schedule(
  'sync-own-matches-gameday',
  '0 10 * * *',
  $$
  select net.http_post(
    url := 'https://ozggtruvnwozhwjbznsm.supabase.co/functions/v1/sync-own-matches',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{"mode":"gameday"}'::jsonb
  );
  $$
);
