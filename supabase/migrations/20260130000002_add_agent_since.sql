-- Neues Feld: Wann hat der aktuelle Beraterzustand begonnen?
-- Wird NUR bei Beraterwechsel aktualisiert, NICHT bei jedem Scan.
ALTER TABLE berater_players ADD COLUMN agent_since TIMESTAMPTZ;

-- Bestehende Spieler: agent_since = agent_updated_at (beste Approximation)
UPDATE berater_players SET agent_since = agent_updated_at WHERE agent_updated_at IS NOT NULL;
