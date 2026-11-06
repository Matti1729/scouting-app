-- Scouts in der Scouting-App (Matti 2026-11-06).
-- Einbahnstraße: Scouts tragen ein und sehen nur ihr Eigenes (Spiele, Berichte,
-- Watchlist, Notizen). Matti, Raffa, Philipp sehen alles. Bisher durfte jedes
-- angemeldete Konto alles lesen, ändern und löschen.
--
-- Berater = advisors.role in (admin, advisor, berater) + access_scouting.
-- Scout   = alle anderen mit access_scouting.
-- Haken access_scouting raus -> Zugriff wirklich zu (auch per API).
-- Alte Zeilen ohne created_by bleiben allein bei den Beratern.
-- Die Service-Role (Sync-Funktionen) umgeht RLS und ist nicht betroffen.
-- Ausführung im SQL-Editor, nicht per db push (Migrations-Drift).

BEGIN;

-- 1. Autor an Spielen und Berichten -----------------------------------------
ALTER TABLE public.scouting_matches
  ADD COLUMN IF NOT EXISTS created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.player_evaluations
  ADD COLUMN IF NOT EXISTS created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_scouting_matches_created_by ON public.scouting_matches(created_by);
CREATE INDEX IF NOT EXISTS idx_player_evaluations_created_by ON public.player_evaluations(created_by);

-- 2. Rechte-Funktionen ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_scouting_access()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM advisors WHERE id = auth.uid() AND access_scouting IS TRUE);
$$;

CREATE OR REPLACE FUNCTION public.is_scouting_staff()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM advisors
    WHERE id = auth.uid() AND access_scouting IS TRUE AND role IN ('admin', 'advisor', 'berater')
  );
$$;

-- Spiel lesen: Berater alle, Scouts DFB-Termine + eigene
CREATE OR REPLACE FUNCTION public.can_see_scouting_match(p_match uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_scouting_staff() OR (
    public.has_scouting_access() AND EXISTS (
      SELECT 1 FROM scouting_matches m
      WHERE m.id = p_match AND (m.source = 'dfb' OR m.created_by = auth.uid())
    )
  );
$$;

-- Spiel bearbeiten: Berater alle, Scouts nur eigene
CREATE OR REPLACE FUNCTION public.can_edit_scouting_match(p_match uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_scouting_staff() OR (
    public.has_scouting_access() AND EXISTS (
      SELECT 1 FROM scouting_matches m WHERE m.id = p_match AND m.created_by = auth.uid()
    )
  );
$$;

-- 3. Neue Tabellen ----------------------------------------------------------
-- Eigene Watchlist je Scout (Spalten wie berater_watchlist)
CREATE TABLE IF NOT EXISTS public.scout_watchlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES public.berater_players(id) ON DELETE CASCADE,
  notes text,
  rating integer,
  added_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, player_id)
);

-- "Ich bin dabei" bei DFB-Terminen: die Terminzeile ist für alle dieselbe,
-- deshalb merken sich Scouts ihre Teilnahme hier (Berater: scouting_matches.attending)
CREATE TABLE IF NOT EXISTS public.scouting_match_attendance (
  match_id uuid NOT NULL REFERENCES public.scouting_matches(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, user_id)
);

-- Spielnotizen je Person (lagen am Spiel und wären bei DFB-Terminen für Scouts lesbar)
CREATE TABLE IF NOT EXISTS public.scouting_match_notes (
  match_id uuid NOT NULL REFERENCES public.scouting_matches(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, user_id)
);

-- KI-Einschätzung nur für Berater (lag an berater_players, das Scouts lesen dürfen)
CREATE TABLE IF NOT EXISTS public.player_scout_summaries (
  player_id uuid PRIMARY KEY REFERENCES public.berater_players(id) ON DELETE CASCADE,
  summary text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 4. Daten umziehen (Spielnotizen stammen von Matti) ------------------------
INSERT INTO public.scouting_match_notes (match_id, user_id, notes, updated_at)
SELECT m.id, a.id, m.scouting_notes, COALESCE(m.scouting_notes_updated_at, now())
FROM public.scouting_matches m
JOIN public.advisors a ON a.first_name = 'Matti' AND a.last_name = 'Langer'
WHERE m.scouting_notes IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.player_scout_summaries (player_id, summary, updated_at)
SELECT id, scout_summary, COALESCE(scout_summary_at, now())
FROM public.berater_players
WHERE scout_summary IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE public.scouting_matches
  DROP COLUMN IF EXISTS scouting_notes,
  DROP COLUMN IF EXISTS scouting_notes_updated_at;
ALTER TABLE public.berater_players
  DROP COLUMN IF EXISTS scout_summary,
  DROP COLUMN IF EXISTS scout_summary_at;

-- 5. Alle bisherigen Regeln dieser Tabellen entfernen -----------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = ANY (ARRAY[
      'player_evaluations', 'scouting_matches', 'scouting_lineups',
      'berater_watchlist', 'berater_player_evaluations', 'player_notes',
      'stipendium_entries', 'berater_alert_subs', 'berater_alert_notifications',
      'berater_players', 'berater_clubs', 'berater_leagues',
      'berater_player_stats', 'berater_changes', 'berater_scan_state',
      'scout_watchlist', 'scouting_match_attendance', 'scouting_match_notes',
      'player_scout_summaries'
    ])
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

ALTER TABLE public.player_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scouting_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scouting_lineups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.berater_watchlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.berater_player_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stipendium_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.berater_alert_subs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.berater_alert_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.berater_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.berater_clubs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.berater_leagues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.berater_player_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.berater_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.berater_scan_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scout_watchlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scouting_match_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scouting_match_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_scout_summaries ENABLE ROW LEVEL SECURITY;

-- 6. Berichte: Scouts nur eigene --------------------------------------------
CREATE POLICY player_evaluations_scouting ON public.player_evaluations
  FOR ALL TO authenticated
  USING ((SELECT public.is_scouting_staff()) OR ((SELECT public.has_scouting_access()) AND created_by = auth.uid()))
  WITH CHECK ((SELECT public.is_scouting_staff()) OR ((SELECT public.has_scouting_access()) AND created_by = auth.uid()));

-- 7. Spiele und Aufstellungen -----------------------------------------------
CREATE POLICY scouting_matches_select ON public.scouting_matches
  FOR SELECT TO authenticated
  USING ((SELECT public.is_scouting_staff()) OR ((SELECT public.has_scouting_access()) AND (source = 'dfb' OR created_by = auth.uid())));
CREATE POLICY scouting_matches_insert ON public.scouting_matches
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_scouting_staff()) OR ((SELECT public.has_scouting_access()) AND created_by = auth.uid() AND source IS NULL));
CREATE POLICY scouting_matches_update ON public.scouting_matches
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_scouting_staff()) OR ((SELECT public.has_scouting_access()) AND created_by = auth.uid()))
  WITH CHECK ((SELECT public.is_scouting_staff()) OR ((SELECT public.has_scouting_access()) AND created_by = auth.uid()));
CREATE POLICY scouting_matches_delete ON public.scouting_matches
  FOR DELETE TO authenticated
  USING ((SELECT public.is_scouting_staff()) OR ((SELECT public.has_scouting_access()) AND created_by = auth.uid()));

CREATE POLICY scouting_lineups_select ON public.scouting_lineups
  FOR SELECT TO authenticated USING (public.can_see_scouting_match(match_id));
CREATE POLICY scouting_lineups_insert ON public.scouting_lineups
  FOR INSERT TO authenticated WITH CHECK (public.can_edit_scouting_match(match_id));
CREATE POLICY scouting_lineups_update ON public.scouting_lineups
  FOR UPDATE TO authenticated USING (public.can_edit_scouting_match(match_id)) WITH CHECK (public.can_edit_scouting_match(match_id));
CREATE POLICY scouting_lineups_delete ON public.scouting_lineups
  FOR DELETE TO authenticated USING (public.can_edit_scouting_match(match_id));

-- 8. Nur Berater ------------------------------------------------------------
CREATE POLICY berater_watchlist_staff ON public.berater_watchlist
  FOR ALL TO authenticated USING ((SELECT public.is_scouting_staff())) WITH CHECK ((SELECT public.is_scouting_staff()));
CREATE POLICY berater_player_evaluations_staff ON public.berater_player_evaluations
  FOR ALL TO authenticated USING ((SELECT public.is_scouting_staff())) WITH CHECK ((SELECT public.is_scouting_staff()));
CREATE POLICY player_notes_staff ON public.player_notes
  FOR ALL TO authenticated USING ((SELECT public.is_scouting_staff())) WITH CHECK ((SELECT public.is_scouting_staff()));
CREATE POLICY stipendium_entries_staff ON public.stipendium_entries
  FOR ALL TO authenticated USING ((SELECT public.is_scouting_staff())) WITH CHECK ((SELECT public.is_scouting_staff()));
CREATE POLICY berater_alert_subs_staff ON public.berater_alert_subs
  FOR ALL TO authenticated USING ((SELECT public.is_scouting_staff())) WITH CHECK ((SELECT public.is_scouting_staff()));
CREATE POLICY berater_alert_notifications_staff ON public.berater_alert_notifications
  FOR ALL TO authenticated USING ((SELECT public.is_scouting_staff())) WITH CHECK ((SELECT public.is_scouting_staff()));
CREATE POLICY player_scout_summaries_staff ON public.player_scout_summaries
  FOR ALL TO authenticated USING ((SELECT public.is_scouting_staff())) WITH CHECK ((SELECT public.is_scouting_staff()));

-- 9. Spielerstamm: alle mit Zugang lesen; Bericht legt Spieler bei Bedarf an
CREATE POLICY berater_players_select ON public.berater_players
  FOR SELECT TO authenticated USING ((SELECT public.has_scouting_access()));
CREATE POLICY berater_players_insert ON public.berater_players
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.has_scouting_access()));
CREATE POLICY berater_players_update ON public.berater_players
  FOR UPDATE TO authenticated USING ((SELECT public.has_scouting_access())) WITH CHECK ((SELECT public.has_scouting_access()));
CREATE POLICY berater_players_delete ON public.berater_players
  FOR DELETE TO authenticated USING ((SELECT public.is_scouting_staff()));

CREATE POLICY berater_clubs_select ON public.berater_clubs
  FOR SELECT TO authenticated USING ((SELECT public.has_scouting_access()));
CREATE POLICY berater_clubs_staff ON public.berater_clubs
  FOR ALL TO authenticated USING ((SELECT public.is_scouting_staff())) WITH CHECK ((SELECT public.is_scouting_staff()));
CREATE POLICY berater_leagues_select ON public.berater_leagues
  FOR SELECT TO authenticated USING ((SELECT public.has_scouting_access()));
CREATE POLICY berater_leagues_staff ON public.berater_leagues
  FOR ALL TO authenticated USING ((SELECT public.is_scouting_staff())) WITH CHECK ((SELECT public.is_scouting_staff()));
CREATE POLICY berater_player_stats_select ON public.berater_player_stats
  FOR SELECT TO authenticated USING ((SELECT public.has_scouting_access()));
CREATE POLICY berater_player_stats_staff ON public.berater_player_stats
  FOR ALL TO authenticated USING ((SELECT public.is_scouting_staff())) WITH CHECK ((SELECT public.is_scouting_staff()));
CREATE POLICY berater_changes_select ON public.berater_changes
  FOR SELECT TO authenticated USING ((SELECT public.has_scouting_access()));
CREATE POLICY berater_changes_staff ON public.berater_changes
  FOR ALL TO authenticated USING ((SELECT public.is_scouting_staff())) WITH CHECK ((SELECT public.is_scouting_staff()));
CREATE POLICY berater_scan_state_staff ON public.berater_scan_state
  FOR ALL TO authenticated USING ((SELECT public.is_scouting_staff())) WITH CHECK ((SELECT public.is_scouting_staff()));

-- 10. Neue Scout-Tabellen ---------------------------------------------------
CREATE POLICY scout_watchlist_own ON public.scout_watchlist
  FOR ALL TO authenticated
  USING ((SELECT public.has_scouting_access()) AND owner_id = auth.uid())
  WITH CHECK ((SELECT public.has_scouting_access()) AND owner_id = auth.uid());
CREATE POLICY scout_watchlist_staff_read ON public.scout_watchlist
  FOR SELECT TO authenticated USING ((SELECT public.is_scouting_staff()));
-- Für Dubletten-Zusammenführung der Spieler durch die Berater
CREATE POLICY scout_watchlist_staff_write ON public.scout_watchlist
  FOR UPDATE TO authenticated USING ((SELECT public.is_scouting_staff())) WITH CHECK ((SELECT public.is_scouting_staff()));

CREATE POLICY scouting_match_attendance_own ON public.scouting_match_attendance
  FOR ALL TO authenticated
  USING ((SELECT public.has_scouting_access()) AND user_id = auth.uid())
  WITH CHECK ((SELECT public.has_scouting_access()) AND user_id = auth.uid() AND public.can_see_scouting_match(match_id));
CREATE POLICY scouting_match_attendance_staff_read ON public.scouting_match_attendance
  FOR SELECT TO authenticated USING ((SELECT public.is_scouting_staff()));

CREATE POLICY scouting_match_notes_own ON public.scouting_match_notes
  FOR ALL TO authenticated
  USING ((SELECT public.has_scouting_access()) AND user_id = auth.uid())
  WITH CHECK ((SELECT public.has_scouting_access()) AND user_id = auth.uid() AND public.can_see_scouting_match(match_id));
CREATE POLICY scouting_match_notes_staff_read ON public.scouting_match_notes
  FOR SELECT TO authenticated USING ((SELECT public.is_scouting_staff()));

-- 11. Rechte der Funktionen -------------------------------------------------
REVOKE ALL ON FUNCTION public.has_scouting_access() FROM public, anon;
REVOKE ALL ON FUNCTION public.is_scouting_staff() FROM public, anon;
REVOKE ALL ON FUNCTION public.can_see_scouting_match(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.can_edit_scouting_match(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.has_scouting_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_scouting_staff() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_see_scouting_match(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_edit_scouting_match(uuid) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
