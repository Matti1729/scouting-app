-- Spieler-Konten sehen nur noch ihre eigenen Daten, Verträge und Angebote werden privat
-- (Matti 2026-11-06). Erst ausführen, wenn die KMH-App mit signedFileUrl online ist.
-- Ausführung im SQL-Editor, nicht per db push (Migrations-Drift).

BEGIN;

-- Team = Berater und Trainer mit KMH-Zugang, Spieler zählen nicht dazu
CREATE OR REPLACE FUNCTION public.has_team_access()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM advisors WHERE id = auth.uid() AND access_kmh IS TRUE);
$$;
REVOKE ALL ON FUNCTION public.has_team_access() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.has_team_access() TO authenticated;

-- Tabellen, die die Spieler-Ansicht nicht nutzt
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'access_requests', 'advisor_access', 'ae_berechnungen', 'finance_documents',
    'player_career', 'player_season_clubs', 'scouted_players', 'scouting_game_players',
    'scouting_game_teams', 'scouting_games', 'searching_clubs', 'settings', 'termine',
    'transfer_clubs'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS kmh_team_only ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY kmh_team_only ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
         USING ((SELECT public.has_team_access())) WITH CHECK ((SELECT public.has_team_access()))',
      t
    );
  END LOOP;
END $$;

-- Spielerakten: Spieler nur die eigene Zeile
DROP POLICY IF EXISTS player_details_own_only ON public.player_details;
CREATE POLICY player_details_own_only ON public.player_details
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT public.has_team_access()) OR linked_user_id = auth.uid());

-- Dateien: Verträge, Angebote und Dokumente nur fürs Team
DROP POLICY IF EXISTS team_only_storage ON storage.objects;
CREATE POLICY team_only_storage ON storage.objects
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (bucket_id NOT IN ('contracts', 'offers', 'documents') OR (SELECT public.has_team_access()))
  WITH CHECK (bucket_id NOT IN ('contracts', 'offers', 'documents') OR (SELECT public.has_team_access()));

UPDATE storage.buckets SET public = false WHERE id IN ('contracts', 'offers');

-- Verknüpfung nur mit dem passenden Code, sonst reichte die Spieler-ID
CREATE OR REPLACE FUNCTION public.handle_player_account_link()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pd_id uuid;
BEGIN
  IF (new.raw_user_meta_data->>'role') = 'player' THEN
    pd_id := nullif(new.raw_user_meta_data->>'player_details_id', '')::uuid;
    IF pd_id IS NOT NULL THEN
      UPDATE player_details
        SET linked_user_id = new.id,
            email_player = coalesce(nullif(email_player, ''), new.email)
        WHERE id = pd_id
          AND linked_user_id IS NULL
          AND invitation_code = upper(trim(new.raw_user_meta_data->>'invitation_code'));
    END IF;
  END IF;
  RETURN new;
END;
$$;

COMMIT;
