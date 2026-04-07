-- ============================================================================
-- Internationale Ligen: Österreich & Niederlande
-- Neue country-Spalte + 6 neue Ligen (identisch zum deutschen System)
-- ============================================================================

-- 1) country-Spalte hinzufügen (Default 'DE' für bestehende deutsche Ligen)
ALTER TABLE berater_leagues ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT 'DE';

-- 2) Österreichische Ligen
INSERT INTO berater_leagues (id, name, tier, category, country, tm_competition_url, is_active) VALUES
('A1',   'Bundesliga',          1, 'herren', 'AT', 'https://www.transfermarkt.de/bundesliga/startseite/wettbewerb/A1',                true),
('A2',   '2. Liga',             2, 'herren', 'AT', 'https://www.transfermarkt.de/2-liga/startseite/wettbewerb/A2',                    true),
('JGD2', 'ÖFB Jugendliga U18', 6, 'u19',    'AT', 'https://www.transfermarkt.de/ofb-jugendliga-u18/startseite/wettbewerb/JGD2',      true)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  tier = EXCLUDED.tier,
  country = EXCLUDED.country,
  tm_competition_url = EXCLUDED.tm_competition_url,
  is_active = EXCLUDED.is_active;

-- 3) Niederländische Ligen
INSERT INTO berater_leagues (id, name, tier, category, country, tm_competition_url, is_active) VALUES
('NL1',  'Eredivisie',          1, 'herren', 'NL', 'https://www.transfermarkt.de/eredivisie/startseite/wettbewerb/NL1',              true),
('NL2',  'Eerste Divisie',      2, 'herren', 'NL', 'https://www.transfermarkt.de/eerste-divisie/startseite/wettbewerb/NL2',           true),
('NLBB', 'Beloften Eredivisie', 6, 'u19',    'NL', 'https://www.transfermarkt.de/beloften-eerste-divisie/startseite/wettbewerb/NLBB', true)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  tier = EXCLUDED.tier,
  country = EXCLUDED.country,
  tm_competition_url = EXCLUDED.tm_competition_url,
  is_active = EXCLUDED.is_active;
