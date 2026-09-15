-- Hauptfuß (rechts | links | beide): Fakt zum Spieler, im Bericht und am Berater-Datensatz
ALTER TABLE player_evaluations ADD COLUMN IF NOT EXISTS preferred_foot TEXT;
ALTER TABLE berater_players ADD COLUMN IF NOT EXISTS preferred_foot TEXT;
