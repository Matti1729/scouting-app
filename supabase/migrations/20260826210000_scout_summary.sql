-- Generierte Scouting-Einschätzung am Spieler speichern (Kurztext aus den
-- Spielberichten, erzeugt von der Edge Function player-einschaetzung).
ALTER TABLE public.berater_players
  ADD COLUMN IF NOT EXISTS scout_summary text,
  ADD COLUMN IF NOT EXISTS scout_summary_at timestamptz;
