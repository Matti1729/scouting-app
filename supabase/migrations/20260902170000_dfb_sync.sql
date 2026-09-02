-- ============================================================================
-- DFB-Termine + Kader automatisch abgleichen (Edge Function dfb-sync)
-- ============================================================================

-- Herkunft + stabiler Schlüssel je DFB-Termin, Kader-Änderungserkennung
ALTER TABLE scouting_matches ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE scouting_matches ADD COLUMN IF NOT EXISTS source_key TEXT;
ALTER TABLE scouting_matches ADD COLUMN IF NOT EXISTS kader_hash TEXT;
ALTER TABLE scouting_matches ADD COLUMN IF NOT EXISTS kader_source TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_scouting_matches_source_key
  ON scouting_matches(source_key) WHERE source_key IS NOT NULL;

-- Verein je Kader-Spieler + Herkunft der Aufstellungszeile
ALTER TABLE scouting_lineups ADD COLUMN IF NOT EXISTS club TEXT;
ALTER TABLE scouting_lineups ADD COLUMN IF NOT EXISTS source TEXT;

-- Täglicher Cron: 04:20 UTC (06:20 MESZ) — DFB pflegt die Seiten tagsüber
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

SELECT cron.unschedule('daily-dfb-sync')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-dfb-sync');

SELECT cron.schedule(
  'daily-dfb-sync',
  '20 4 * * *',
  $$
  SELECT net.http_post(
    url := 'https://ozggtruvnwozhwjbznsm.supabase.co/functions/v1/dfb-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96Z2d0cnV2bndvemh3amJ6bnNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5NDI5ODYsImV4cCI6MjA4MjUxODk4Nn0.QCaSqAQPrIl-DXKiT82wbWAJ23KbeOTpRvq8YI46hCY'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
