-- ============================================================================
-- pg_cron: Spieler-Rankings einmal pro Woche aktualisieren
-- Ruft die Edge Function per pg_net HTTP-Request auf
-- Jeden Montag um 06:00 Uhr UTC
-- ============================================================================

-- Extensions aktivieren (idempotent, falls noch nicht vorhanden)
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Alten Job entfernen falls vorhanden
SELECT cron.unschedule('weekly-player-rankings')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'weekly-player-rankings'
);

-- Neuer Cron-Job: Jeden Montag um 06:00 UTC
SELECT cron.schedule(
  'weekly-player-rankings',
  '0 6 * * 1',
  $$
  SELECT net.http_post(
    url := 'https://ozggtruvnwozhwjbznsm.supabase.co/functions/v1/fetch-player-rankings?action=fetch_all',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96Z2d0cnV2bndvemh3amJ6bnNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5NDI5ODYsImV4cCI6MjA4MjUxODk4Nn0.QCaSqAQPrIl-DXKiT82wbWAJ23KbeOTpRvq8YI46hCY'
    ),
    body := '{}'::jsonb
  );
  $$
);
