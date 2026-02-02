-- Neue Spalte: Spieler als vereinslos markieren (statt is_active = false)
ALTER TABLE berater_players ADD COLUMN is_vereinslos BOOLEAN DEFAULT false;

-- Bereits deaktivierte Spieler (die vorher gescannt wurden) als vereinslos reaktivieren
UPDATE berater_players
SET is_vereinslos = true, is_active = true
WHERE is_active = false AND agent_updated_at IS NOT NULL;
