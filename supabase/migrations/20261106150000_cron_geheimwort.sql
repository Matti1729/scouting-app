-- Zeitpläne schicken ein Geheimwort mit, die Edge Functions prüfen es (Matti 2026-11-06).
-- Das Wort selbst liegt im Vault (Name cron_secret) und als Function-Secret CRON_SECRET,
-- nie in dieser Datei. Ausführung im SQL-Editor, nicht per db push (Migrations-Drift).

DO $$
DECLARE j record;
BEGIN
  FOR j IN
    SELECT jobid, command FROM cron.job
    WHERE command LIKE '%functions/v1/%' AND command NOT LIKE '%x-cron-secret%'
  LOOP
    PERFORM cron.alter_job(j.jobid, command := regexp_replace(
      j.command,
      'headers\s*:=\s*',
      'headers := jsonb_build_object(''x-cron-secret'', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''cron_secret'')) || ',
      'g'
    ));
  END LOOP;
END $$;
