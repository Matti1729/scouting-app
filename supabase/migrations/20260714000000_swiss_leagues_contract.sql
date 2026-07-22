-- 1) Schweizer Ligen (Super League + Challenge League), analog zu Österreich/Niederlande
INSERT INTO berater_leagues (id, name, tier, category, country, tm_competition_url, is_active) VALUES
('C1', 'Super League',     1, 'herren', 'CH', 'https://www.transfermarkt.de/super-league/startseite/wettbewerb/C1',     true),
('C2', 'Challenge League', 2, 'herren', 'CH', 'https://www.transfermarkt.de/challenge-league/startseite/wettbewerb/C2', true)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  tier = EXCLUDED.tier,
  country = EXCLUDED.country,
  tm_competition_url = EXCLUDED.tm_competition_url,
  is_active = EXCLUDED.is_active;

-- 2) Vertragsende: wird vom Scanner von der TM-Profilseite erfasst ("Vertrag bis")
ALTER TABLE berater_players ADD COLUMN IF NOT EXISTS contract_until DATE;
CREATE INDEX IF NOT EXISTS idx_berater_players_contract ON berater_players(contract_until);
