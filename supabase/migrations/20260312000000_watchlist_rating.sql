-- Rating-Spalte zur Watchlist hinzufügen (unabhängig von Evaluations)
ALTER TABLE berater_watchlist ADD COLUMN IF NOT EXISTS rating INTEGER CHECK (rating IS NULL OR (rating >= 1 AND rating <= 10));
