-- Add is_goalkeeper column to scouting_lineups table
ALTER TABLE scouting_lineups ADD COLUMN IF NOT EXISTS is_goalkeeper BOOLEAN DEFAULT FALSE;

-- Set goalkeeper flag based on position
UPDATE scouting_lineups SET is_goalkeeper = TRUE WHERE position ILIKE '%torwart%' OR position ILIKE '%goalkeeper%' OR position ILIKE '%keeper%' OR position = 'TW';
