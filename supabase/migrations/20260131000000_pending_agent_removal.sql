-- Add pending_agent_removal column for confirmation logic
-- When a scan detects agent removal, this timestamp is set.
-- Only if the next scan still shows no agent, the change is confirmed.
ALTER TABLE berater_players ADD COLUMN IF NOT EXISTS pending_agent_removal TIMESTAMPTZ DEFAULT NULL;
