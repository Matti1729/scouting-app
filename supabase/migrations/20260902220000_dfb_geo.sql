-- ============================================================================
-- Koordinaten für DFB-Termine (Lehrgänge/Länderspiele) auf der Karte
-- gefüllt von der Edge Function dfb-sync (Nominatim + bekannte DFB-Sportschulen)
-- ============================================================================
ALTER TABLE scouting_matches ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE scouting_matches ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
-- Ortstext, für den lat/lng ermittelt wurden (Änderungserkennung)
ALTER TABLE scouting_matches ADD COLUMN IF NOT EXISTS geo_query TEXT;
