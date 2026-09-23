-- DFB-Termine: Kader-Überschrift (wie auf dfb.de), Datencenter-Spielseite
-- (Aufstellung) und Zeitpunkt des letzten Aufstellungs-Imports
ALTER TABLE scouting_matches ADD COLUMN IF NOT EXISTS kader_title TEXT;
ALTER TABLE scouting_matches ADD COLUMN IF NOT EXISTS dfb_match_url TEXT;
ALTER TABLE scouting_matches ADD COLUMN IF NOT EXISTS dfb_lineup_loaded_at TIMESTAMPTZ;

-- Kader-Spieler: Länderspiele/Tore + Datencenter-Profil (Spalten der DFB-Kaderliste)
ALTER TABLE scouting_lineups ADD COLUMN IF NOT EXISTS dfb_games INTEGER;
ALTER TABLE scouting_lineups ADD COLUMN IF NOT EXISTS dfb_goals INTEGER;
ALTER TABLE scouting_lineups ADD COLUMN IF NOT EXISTS dfb_profile_url TEXT;
