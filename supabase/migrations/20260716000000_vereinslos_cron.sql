-- Eigene Nebenspur für vereinslose Spieler: alle 5 Minuten (um 2 Min versetzt
-- zum Haupt-Vereins-Scan), 20 Profile pro Lauf. So werden vereinslose Spieler
-- unabhängig von der Vereins-Runde schnell nachgeprüft.
SELECT cron.unschedule('berater-vereinslos-scan')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'berater-vereinslos-scan');

SELECT cron.schedule(
  'berater-vereinslos-scan',
  '2,7,12,17,22,27,32,37,42,47,52,57 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://ozggtruvnwozhwjbznsm.supabase.co/functions/v1/berater-scan',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96Z2d0cnV2bndvemh3amJ6bnNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5NDI5ODYsImV4cCI6MjA4MjUxODk4Nn0.QCaSqAQPrIl-DXKiT82wbWAJ23KbeOTpRvq8YI46hCY'
    ),
    body := '{"action": "cleanup_vereinslose"}'::jsonb
  );
  $$
);
