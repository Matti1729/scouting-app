-- Kader vor Lehrgängen öfter abgleichen: zusätzlich 18:00 Berlin (16:00 UTC) neben 06:20.
-- Änderungen an Kadern anstehender Termine meldet dfb-sync per Telegram an Matti.
SELECT cron.unschedule('evening-dfb-sync')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'evening-dfb-sync');

SELECT cron.schedule(
  'evening-dfb-sync',
  '0 16 * * *',
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
