-- Migration: birth_date Spalte für scouting_lineups hinzufügen
-- Speichert das vollständige Geburtsdatum von Transfermarkt (Format: "DD.MM.YYYY")

ALTER TABLE scouting_lineups ADD COLUMN IF NOT EXISTS birth_date TEXT;

-- Kommentar zur Spalte
COMMENT ON COLUMN scouting_lineups.birth_date IS 'Vollständiges Geburtsdatum im Format DD.MM.YYYY (von Transfermarkt)';
