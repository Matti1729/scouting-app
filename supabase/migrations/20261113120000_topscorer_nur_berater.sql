-- Topscorer-Liste nur für Berater (Matti 2026-11-13: „für die Berater, nicht für die Scouts“).
-- Lesen ging bisher mit jedem Scouting-Zugang (berater_player_stats_select);
-- übrig bleibt berater_player_stats_staff (is_scouting_staff) für Lesen und Schreiben.
-- Ausführung im SQL-Editor, nicht per db push (Migrations-Drift).

DROP POLICY IF EXISTS berater_player_stats_select ON public.berater_player_stats;

SELECT policyname, cmd, roles, qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'berater_player_stats';
