-- Scouting App Tabellen
-- Ausführen im Supabase SQL Editor

-- Tabelle für Spiele
CREATE TABLE IF NOT EXISTS scouting_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Spiel-Infos
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  match_date TEXT,  -- Format: "Sa, 25.01.2025"
  match_time TEXT,  -- Format: "14:00"
  age_group TEXT,   -- U14, U15, U16, U17, U19, Herren
  match_type TEXT,  -- Punktspiel, Pokalspiel, Freundschaftsspiel, etc.

  -- Ergebnis
  result TEXT,      -- z.B. "2:1"

  -- Externe Links
  fussball_de_url TEXT,

  -- Archiv
  is_archived BOOLEAN DEFAULT FALSE
);

-- Tabelle für Aufstellungen (Spieler pro Spiel)
CREATE TABLE IF NOT EXISTS scouting_lineups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Referenz zum Spiel
  match_id UUID REFERENCES scouting_matches(id) ON DELETE CASCADE,

  -- Team-Zuordnung
  team TEXT NOT NULL CHECK (team IN ('home', 'away')),
  is_starter BOOLEAN DEFAULT TRUE,  -- true = Starter, false = Auswechsler

  -- Spieler-Infos
  nummer TEXT,
  vorname TEXT,
  name TEXT NOT NULL,
  position TEXT,
  jahrgang TEXT,

  -- Externe Links
  fussball_de_url TEXT,
  transfermarkt_url TEXT,

  -- Berater-Info (von Transfermarkt)
  agent_name TEXT,
  agent_company TEXT,
  has_agent BOOLEAN DEFAULT FALSE
);

-- Indizes für schnellere Abfragen
CREATE INDEX IF NOT EXISTS idx_scouting_lineups_match_id ON scouting_lineups(match_id);
CREATE INDEX IF NOT EXISTS idx_scouting_matches_date ON scouting_matches(match_date);

-- Row Level Security (RLS) - erstmal deaktiviert für einfache Nutzung
-- Später kann man User-basierte RLS hinzufügen
ALTER TABLE scouting_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE scouting_lineups ENABLE ROW LEVEL SECURITY;

-- Policy: Jeder kann lesen und schreiben (für Entwicklung)
-- WICHTIG: In Produktion sollte das auf authentifizierte User beschränkt werden!
CREATE POLICY "Allow all for scouting_matches" ON scouting_matches
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for scouting_lineups" ON scouting_lineups
  FOR ALL USING (true) WITH CHECK (true);
