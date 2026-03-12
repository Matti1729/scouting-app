-- Spieler-Bewertungssystem: interessant / nicht interessant + Rating + Notizen
CREATE TABLE IF NOT EXISTS berater_player_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID REFERENCES berater_players(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('interessant', 'nicht_interessant')),
  rating INTEGER CHECK (rating IS NULL OR (rating >= 1 AND rating <= 10)),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(player_id)
);

CREATE INDEX idx_berater_evaluations_player ON berater_player_evaluations(player_id);
CREATE INDEX idx_berater_evaluations_status ON berater_player_evaluations(status);

ALTER TABLE berater_player_evaluations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all berater_player_evaluations" ON berater_player_evaluations FOR ALL USING (true) WITH CHECK (true);
