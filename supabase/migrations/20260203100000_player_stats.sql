-- Tabelle für Spieler-Statistiken (Torschützen, Vorlagengeber)
CREATE TABLE IF NOT EXISTS berater_player_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID REFERENCES berater_players(id) ON DELETE CASCADE,
  tm_player_id TEXT NOT NULL,  -- TM-ID für Spieler die noch nicht in berater_players sind
  player_name TEXT NOT NULL,
  league_id TEXT REFERENCES berater_leagues(id) ON DELETE CASCADE,
  club_name TEXT,
  stat_type TEXT NOT NULL CHECK (stat_type IN ('goals', 'assists')),
  stat_value INTEGER NOT NULL DEFAULT 0,
  games_played INTEGER,
  rank_in_league INTEGER,
  season TEXT,  -- z.B. '24/25'
  tm_profile_url TEXT,
  birth_date TEXT,
  position TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tm_player_id, league_id, stat_type, season)
);

-- Indizes für schnelle Abfragen
CREATE INDEX IF NOT EXISTS idx_player_stats_type ON berater_player_stats(stat_type);
CREATE INDEX IF NOT EXISTS idx_player_stats_league ON berater_player_stats(league_id);
CREATE INDEX IF NOT EXISTS idx_player_stats_rank ON berater_player_stats(rank_in_league);
CREATE INDEX IF NOT EXISTS idx_player_stats_player_id ON berater_player_stats(player_id);
CREATE INDEX IF NOT EXISTS idx_player_stats_tm_player_id ON berater_player_stats(tm_player_id);

-- RLS aktivieren
ALTER TABLE berater_player_stats ENABLE ROW LEVEL SECURITY;

-- Policy: Alle können lesen
CREATE POLICY "berater_player_stats_select" ON berater_player_stats
  FOR SELECT USING (true);

-- Policy: Service-Role kann alles
CREATE POLICY "berater_player_stats_all" ON berater_player_stats
  FOR ALL USING (auth.role() = 'service_role');

-- Kommentar
COMMENT ON TABLE berater_player_stats IS 'Top-Torschützen und Vorlagengeber aus Transfermarkt-Rankings';
