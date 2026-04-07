-- Add agent_url column to berater_players for linking to TM agency profile
ALTER TABLE berater_players ADD COLUMN IF NOT EXISTS agent_url text;
