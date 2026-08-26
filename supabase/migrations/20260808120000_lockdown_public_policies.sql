-- Sicherheitsfix: offene (anon/public) RLS-Policies auf "authenticated" einschränken.
-- Hintergrund: Mehrere Tabellen (berater_*, scouting_*, player_evaluations, stipendium_entries …)
-- hatten Policies mit "USING (true)" bzw. "WITH CHECK (true)" für die Rolle PUBLIC oder anon.
-- Damit konnte jeder mit dem öffentlichen anon-Key alle Daten LESEN (und bei FOR ALL auch
-- ÄNDERN/LÖSCHEN). Die scouting-app meldet Nutzer an (authenticated); alle Scraper/Sync-Jobs
-- laufen serverseitig via service-role (umgeht RLS). Der öffentliche Zugriff wird also von
-- nichts Legitimem gebraucht.
--
-- Dieses Statement ändert NUR die Rolle betroffener, voll-offener Policies (PUBLIC/anon ->
-- authenticated). Es verschärft ausschließlich und kann keinen Zugriff öffnen. Idempotent.
-- Bereits per auth.uid()/is_admin() abgesicherte Policies (z. B. advisors_update_admin,
-- advisor_access_insert_own) bleiben unangetastet.
-- Angewendet auf Produktion (Projekt ozggtruvnwozhwjbznsm) am 2026-08-08 via SQL-Editor;
-- Gegentest: anon-Key sieht 0 Zeilen, service-role unverändert; noch_offen = 0.

DO $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN
    SELECT c.relname AS tbl, p.polname AS pol
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public'
      AND (
        p.polroles = ARRAY[0]::oid[]  -- PUBLIC (schließt anon ein)
        OR (SELECT oid FROM pg_roles WHERE rolname = 'anon') = ANY (p.polroles)
      )
      AND (
        coalesce(pg_get_expr(p.polqual, c.oid), '') = 'true'
        OR coalesce(pg_get_expr(p.polwithcheck, c.oid), '') = 'true'
      )
  LOOP
    EXECUTE format('ALTER POLICY %I ON public.%I TO authenticated', r.pol, r.tbl);
    n := n + 1;
    RAISE NOTICE 'Policy eingeschraenkt: % auf %', r.pol, r.tbl;
  END LOOP;
  RAISE NOTICE 'Insgesamt % Policies eingeschraenkt', n;
END $$;
