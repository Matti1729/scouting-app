-- ============================================================================
-- BERATERSTATUS SYSTEM - Database Schema
-- Trackt Beraterwechsel für ~6000+ Spieler in deutschen Ligen
-- ============================================================================

-- 1. LEAGUES: Statische Referenz der überwachten Ligen
CREATE TABLE IF NOT EXISTS berater_leagues (
  id TEXT PRIMARY KEY,                    -- z.B. 'L1', 'L2', 'RLN', 'U19BLW'
  name TEXT NOT NULL,                     -- z.B. 'Bundesliga', 'Regionalliga Nord'
  tier INTEGER NOT NULL,                  -- 1-4 (1=Bundesliga, 4=Regionalliga)
  category TEXT NOT NULL DEFAULT 'herren',-- 'herren', 'u19', 'u17'
  tm_competition_url TEXT NOT NULL,       -- Volle TM-URL zur Wettbewerbsseite
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. CLUBS: Entdeckte Vereine pro Liga
CREATE TABLE IF NOT EXISTS berater_clubs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id TEXT REFERENCES berater_leagues(id),
  tm_club_id TEXT NOT NULL,               -- TM interne Vereins-ID
  club_name TEXT NOT NULL,
  tm_squad_url TEXT NOT NULL,             -- URL zur Kaderseite
  player_count INTEGER DEFAULT 0,
  last_scanned_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tm_club_id)
);

-- 3. PLAYERS: Alle überwachten Spieler mit aktuellem Berater-Snapshot
CREATE TABLE IF NOT EXISTS berater_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID REFERENCES berater_clubs(id) ON DELETE SET NULL,

  -- Spieler-Identifikation
  player_name TEXT NOT NULL,
  tm_player_id TEXT,                      -- Aus Profil-URL extrahiert
  tm_profile_url TEXT,
  birth_date TEXT,                        -- "DD.MM.YYYY"
  position TEXT,

  -- Aktueller Berater-Snapshot (wird bei jedem Scan aktualisiert)
  current_agent_name TEXT,                -- null = noch nicht gescannt
  current_agent_company TEXT,
  has_agent BOOLEAN DEFAULT FALSE,
  agent_updated_at TIMESTAMPTZ,

  -- Metadata
  last_scanned_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(tm_player_id)
);

-- 4. AGENT CHANGE LOG: Historisches Änderungs-Log
CREATE TABLE IF NOT EXISTS berater_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID REFERENCES berater_players(id) ON DELETE CASCADE,

  -- Was hat sich geändert
  previous_agent_name TEXT,
  previous_agent_company TEXT,
  new_agent_name TEXT,
  new_agent_company TEXT,

  -- Denormalisiert für schnelle Reads
  player_name TEXT NOT NULL,
  club_name TEXT,
  league_id TEXT,
  birth_date TEXT,
  tm_profile_url TEXT,

  detected_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. WATCHLIST: Manuell markierte Spieler
CREATE TABLE IF NOT EXISTS berater_watchlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID REFERENCES berater_players(id) ON DELETE CASCADE,
  notes TEXT,                             -- Optionale Notizen
  added_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(player_id)
);

-- 6. SCAN STATE: Singleton - wo sind wir im aktuellen Zyklus?
CREATE TABLE IF NOT EXISTS berater_scan_state (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  current_cycle INTEGER DEFAULT 0,
  next_club_index INTEGER DEFAULT 0,
  total_clubs INTEGER DEFAULT 0,
  cycle_started_at TIMESTAMPTZ,
  last_scan_at TIMESTAMPTZ,
  last_scanned_club TEXT,
  is_running BOOLEAN DEFAULT FALSE,
  error_count INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Singleton-Zeile einfügen
INSERT INTO berater_scan_state (id) VALUES (1) ON CONFLICT DO NOTHING;

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_berater_clubs_league ON berater_clubs(league_id);
CREATE INDEX IF NOT EXISTS idx_berater_clubs_active ON berater_clubs(is_active);
CREATE INDEX IF NOT EXISTS idx_berater_players_club ON berater_players(club_id);
CREATE INDEX IF NOT EXISTS idx_berater_players_tm_id ON berater_players(tm_player_id);
CREATE INDEX IF NOT EXISTS idx_berater_players_agent ON berater_players(has_agent);
CREATE INDEX IF NOT EXISTS idx_berater_players_active ON berater_players(is_active);
CREATE INDEX IF NOT EXISTS idx_berater_changes_detected ON berater_changes(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_berater_changes_player ON berater_changes(player_id);
CREATE INDEX IF NOT EXISTS idx_berater_changes_league ON berater_changes(league_id);
CREATE INDEX IF NOT EXISTS idx_berater_watchlist_player ON berater_watchlist(player_id);

-- ============================================================================
-- ROW LEVEL SECURITY (permissive für Development)
-- ============================================================================

ALTER TABLE berater_leagues ENABLE ROW LEVEL SECURITY;
ALTER TABLE berater_clubs ENABLE ROW LEVEL SECURITY;
ALTER TABLE berater_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE berater_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE berater_watchlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE berater_scan_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all berater_leagues" ON berater_leagues FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all berater_clubs" ON berater_clubs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all berater_players" ON berater_players FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all berater_changes" ON berater_changes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all berater_watchlist" ON berater_watchlist FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all berater_scan_state" ON berater_scan_state FOR ALL USING (true) WITH CHECK (true);
