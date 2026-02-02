-- Add market_value column to berater_players
-- Stores the display string from Transfermarkt (e.g. "1,50 Mio. €", "500 Tsd. €")
ALTER TABLE berater_players ADD COLUMN IF NOT EXISTS market_value TEXT DEFAULT NULL;
