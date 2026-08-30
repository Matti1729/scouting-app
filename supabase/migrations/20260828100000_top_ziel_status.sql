-- Scouting-Status "Top-Ziel" (sofort machen): dritten Statuswert im
-- Bewertungs-Check zulassen. Watchlist-Mitgliedschaft bleibt separat
-- (Top-Ziel-Spieler stehen zusätzlich auf der Watchlist).
ALTER TABLE public.berater_player_evaluations
  DROP CONSTRAINT IF EXISTS berater_player_evaluations_status_check;

ALTER TABLE public.berater_player_evaluations
  ADD CONSTRAINT berater_player_evaluations_status_check
  CHECK (status IN ('interessant', 'nicht_interessant', 'top_ziel'));
