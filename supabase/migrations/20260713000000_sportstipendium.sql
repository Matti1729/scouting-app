-- Sportstipendium-Kandidaten: Spieler mit Status (committed / in Gesprächen / Vorschlag)
CREATE TABLE IF NOT EXISTS stipendium_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_name TEXT NOT NULL,
  birth_date TEXT,
  club_name TEXT,
  position TEXT,
  tm_player_id TEXT,
  tm_profile_url TEXT,
  market_value TEXT,
  status TEXT NOT NULL DEFAULT 'suggestion' CHECK (status IN ('committed', 'in_talks', 'suggestion')),
  notes TEXT,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tm_player_id)
);

CREATE INDEX IF NOT EXISTS idx_stipendium_entries_status ON stipendium_entries(status);

ALTER TABLE stipendium_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all stipendium_entries" ON stipendium_entries;
CREATE POLICY "Allow all stipendium_entries" ON stipendium_entries FOR ALL USING (true) WITH CHECK (true);
