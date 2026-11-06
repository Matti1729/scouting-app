-- Glocke: bis wann hat welcher Berater die Scout-Berichte gesehen (Matti 2026-11-06).
-- Eigene Zeile je Berater, damit Handy und Rechner denselben Stand haben.
-- Ausführung im SQL-Editor, nicht per db push (Migrations-Drift).

CREATE TABLE IF NOT EXISTS public.scout_activity_seen (
  user_id uuid PRIMARY KEY DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  seen_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.scout_activity_seen ENABLE ROW LEVEL SECURITY;

CREATE POLICY scout_activity_seen_own ON public.scout_activity_seen
  FOR ALL TO authenticated
  USING ((SELECT public.is_scouting_staff()) AND user_id = auth.uid())
  WITH CHECK ((SELECT public.is_scouting_staff()) AND user_id = auth.uid());

NOTIFY pgrst, 'reload schema';
