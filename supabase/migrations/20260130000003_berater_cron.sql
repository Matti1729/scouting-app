-- ============================================================================
-- pg_cron: Berater-Scan alle 5 Minuten automatisch ausführen
-- Ruft die Edge Function per pg_net HTTP-Request auf
-- ============================================================================

-- Extensions aktivieren (idempotent)
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Alten Job entfernen falls vorhanden
SELECT cron.unschedule('berater-auto-scan')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'berater-auto-scan'
);

-- Neuer Cron-Job: alle 5 Minuten scan_next_batch aufrufen
SELECT cron.schedule(
  'berater-auto-scan',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://ozggtruvnwozhwjbznsm.supabase.co/functions/v1/berater-scan',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96Z2d0cnV2bndvemh3amJ6bnNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5NDI5ODYsImV4cCI6MjA4MjUxODk4Nn0.QCaSqAQPrIl-DXKiT82wbWAJ23KbeOTpRvq8YI46hCY'
    ),
    body := '{"action": "scan_next_batch"}'::jsonb
  );
  $$
);
