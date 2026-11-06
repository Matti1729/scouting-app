-- Sicherheit: externe Scouts und fremde Konten (Matti 2026-11-06).
-- Registrieren kann sich per API jeder, deshalb darf ein Konto ohne Rolle nichts sehen.
-- Bisher konnten Scouts und fremde Konten die KMH-Daten lesen (Spieler, Finanzen,
-- Termine, Dateien), sich selbst zum Admin machen und Spieler-Zugänge löschen.
--
-- Prinzip: zusätzliche RESTRICTIVE-Regeln. Für Berater, Trainer und Spieler ändert
-- sich nichts, ihre bisherigen Regeln gelten weiter. Die Service-Role umgeht RLS.
-- Rückweg: DROP POLICY kmh_only je Tabelle, DROP TRIGGER guard_advisor_rights.
-- Ausführung im SQL-Editor, nicht per db push (Migrations-Drift).

BEGIN;

-- 1. Wer gehört zur KMH-App? ------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_kmh_access()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM advisors WHERE id = auth.uid() AND access_kmh IS TRUE)
      OR EXISTS (SELECT 1 FROM player_details WHERE linked_user_id = auth.uid());
$$;
REVOKE ALL ON FUNCTION public.has_kmh_access() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.has_kmh_access() TO authenticated;

-- 2. advisors: Kontaktdaten nur für die eigene Zeile, Rechte nur durch Admins ---
DROP POLICY IF EXISTS advisors_select ON public.advisors;
CREATE POLICY advisors_select ON public.advisors
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR (SELECT public.has_kmh_access()) OR (SELECT public.is_scouting_staff()));

-- Konten entstehen nur noch über consume_staff_invitation (SECURITY DEFINER)
DROP POLICY IF EXISTS advisors_insert_own ON public.advisors;

CREATE OR REPLACE FUNCTION public.guard_advisor_rights()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- current_user ist nur bei direkten Zugriffen aus den Apps authenticated,
  -- in SECURITY-DEFINER-Funktionen und der Service-Role nicht
  IF current_user NOT IN ('authenticated', 'anon') OR public.is_admin() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'Konten entstehen nur über eine Einladung';
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.access_kmh IS DISTINCT FROM OLD.access_kmh
     OR NEW.access_scouting IS DISTINCT FROM OLD.access_scouting THEN
    RAISE EXCEPTION 'Rechte ändern nur Admins';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_advisor_rights ON public.advisors;
CREATE TRIGGER guard_advisor_rights
  BEFORE INSERT OR UPDATE ON public.advisors
  FOR EACH ROW EXECUTE FUNCTION public.guard_advisor_rights();

-- 3. Alle übrigen Tabellen: nur mit KMH-Zugang ------------------------------
-- Ausgenommen: Tabellen mit eigenen Scout-Regeln (20261106120000/130000) und area_*
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity
      AND c.relname <> ALL (ARRAY[
        'advisors', 'staff_invitations', 'area_clubs', 'area_games', 'area_leagues',
        'player_evaluations', 'scouting_matches', 'scouting_lineups',
        'berater_watchlist', 'berater_player_evaluations', 'player_notes',
        'stipendium_entries', 'berater_alert_subs', 'berater_alert_notifications',
        'berater_players', 'berater_clubs', 'berater_leagues',
        'berater_player_stats', 'berater_changes', 'berater_scan_state',
        'scout_watchlist', 'scouting_match_attendance', 'scouting_match_notes',
        'player_scout_summaries', 'scout_activity_seen'
      ])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS kmh_only ON public.%I', r.relname);
    EXECUTE format(
      'CREATE POLICY kmh_only ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
         USING ((SELECT public.has_kmh_access())) WITH CHECK ((SELECT public.has_kmh_access()))',
      r.relname
    );
  END LOOP;
END $$;

-- 4. Spieldaten: Scouts lesen, schreiben nur die KMH-App und die Syncs ------
DROP POLICY IF EXISTS area_clubs_rw ON public.area_clubs;
DROP POLICY IF EXISTS area_games_rw ON public.area_games;
DROP POLICY IF EXISTS area_leagues_rw ON public.area_leagues;

CREATE POLICY area_clubs_read ON public.area_clubs FOR SELECT TO authenticated
  USING ((SELECT public.has_kmh_access()) OR (SELECT public.has_scouting_access()));
CREATE POLICY area_games_read ON public.area_games FOR SELECT TO authenticated
  USING ((SELECT public.has_kmh_access()) OR (SELECT public.has_scouting_access()));
CREATE POLICY area_leagues_read ON public.area_leagues FOR SELECT TO authenticated
  USING ((SELECT public.has_kmh_access()) OR (SELECT public.has_scouting_access()));

CREATE POLICY area_clubs_write ON public.area_clubs FOR ALL TO authenticated
  USING ((SELECT public.has_kmh_access())) WITH CHECK ((SELECT public.has_kmh_access()));
CREATE POLICY area_games_write ON public.area_games FOR ALL TO authenticated
  USING ((SELECT public.has_kmh_access())) WITH CHECK ((SELECT public.has_kmh_access()));
CREATE POLICY area_leagues_write ON public.area_leagues FOR ALL TO authenticated
  USING ((SELECT public.has_kmh_access())) WITH CHECK ((SELECT public.has_kmh_access()));

-- 5. Spielerstamm: ändern nur Berater, Scouts lesen und legen neue Spieler an ---
DROP POLICY IF EXISTS berater_players_update ON public.berater_players;
CREATE POLICY berater_players_update ON public.berater_players
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_scouting_staff())) WITH CHECK ((SELECT public.is_scouting_staff()));

-- 6. Funktionen mit Sonderrechten -------------------------------------------
-- Löschte den Login eines Spielers: reichte bisher jede advisors-Zeile (auch Scout)
CREATE OR REPLACE FUNCTION public.reset_player_access(p_player_id uuid, p_new_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid;
BEGIN
  IF NOT public.is_kmh_staff() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT linked_user_id INTO v_uid FROM player_details WHERE id = p_player_id;

  -- Alten Auth-Account entfernen (kaskadiert Sessions/Tokens).
  IF v_uid IS NOT NULL THEN
    DELETE FROM auth.users WHERE id = v_uid;
  END IF;

  -- Verknüpfung lösen + neuen Code setzen.
  UPDATE player_details
    SET linked_user_id = NULL, invitation_code = p_new_code
    WHERE id = p_player_id;
END;
$$;
REVOKE ALL ON FUNCTION public.reset_player_access(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reset_player_access(uuid, text) TO authenticated;

-- Laufen per Cron, nicht aus den Apps
REVOKE ALL ON FUNCTION public.apply_due_transfers() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_birthday_notifications() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_due_transfers() TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_birthday_notifications() TO service_role;

REVOKE ALL ON FUNCTION public.get_entry_added_by(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_entry_added_by(text) TO authenticated;

-- 7. Dateien: nur mit KMH-Zugang --------------------------------------------
DROP POLICY IF EXISTS kmh_only_storage ON storage.objects;
CREATE POLICY kmh_only_storage ON storage.objects
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.has_kmh_access())) WITH CHECK ((SELECT public.has_kmh_access()));

-- Ohne Anmeldung keine Dateilisten von Verträgen und Angeboten
DROP POLICY IF EXISTS no_public_listing ON storage.objects;
CREATE POLICY no_public_listing ON storage.objects
  AS RESTRICTIVE FOR SELECT TO anon
  USING (bucket_id NOT IN ('contracts', 'offers'));

COMMIT;

NOTIFY pgrst, 'reload schema';
