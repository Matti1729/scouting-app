-- Add kicker_url column to scouting_matches for 1./2./3. Liga lineup scraping
ALTER TABLE scouting_matches ADD COLUMN IF NOT EXISTS kicker_url text;
