-- ============================================================================
-- SEED: Deutsche Fußball-Ligen mit Transfermarkt Wettbewerbs-IDs
-- Alle Ligen aktiv. U19/U17-Gruppen haben gleichen Namen → eine Liste im UI
-- ============================================================================

INSERT INTO berater_leagues (id, name, tier, category, tm_competition_url, is_active) VALUES

-- Profi-Ligen
('L1',   'Bundesliga',              1, 'herren', 'https://www.transfermarkt.de/bundesliga/startseite/wettbewerb/L1',              true),
('L2',   '2. Bundesliga',           2, 'herren', 'https://www.transfermarkt.de/2-bundesliga/startseite/wettbewerb/L2',            true),
('L3',   '3. Liga',                 3, 'herren', 'https://www.transfermarkt.de/3-liga/startseite/wettbewerb/L3',                  true),

-- Regionalligen (4. Liga)
('RLN3',  'Regionalliga Nord',       4, 'herren', 'https://www.transfermarkt.de/regionalliga-nord/startseite/wettbewerb/RLN3',     true),
('RLN4',  'Regionalliga Nordost',    4, 'herren', 'https://www.transfermarkt.de/regionalliga-nordost/startseite/wettbewerb/RLN4',   true),
('RLW3',  'Regionalliga West',       4, 'herren', 'https://www.transfermarkt.de/regionalliga-west/startseite/wettbewerb/RLW3',     true),
('RLSW',  'Regionalliga Südwest',    4, 'herren', 'https://www.transfermarkt.de/regionalliga-sudwest/startseite/wettbewerb/RLSW',  true),
('RLB3',  'Regionalliga Bayern',     4, 'herren', 'https://www.transfermarkt.de/regionalliga-bayern/startseite/wettbewerb/RLB3',   true),

-- U19 DFB-Nachwuchsliga Vorrunde (8 Gruppen → gleicher Name)
('U19D1', 'U19 Nachwuchsliga', 5, 'u19', 'https://www.transfermarkt.de/u19-dfb-nachwuchsliga-vorrunde-gruppe-1/startseite/wettbewerb/19D1', true),
('U19D2', 'U19 Nachwuchsliga', 5, 'u19', 'https://www.transfermarkt.de/u19-dfb-nachwuchsliga-vorrunde-gruppe-b/startseite/wettbewerb/19D2', true),
('U19D3', 'U19 Nachwuchsliga', 5, 'u19', 'https://www.transfermarkt.de/u19-dfb-nachwuchsliga-vorrunde-gruppe-c/startseite/wettbewerb/19D3', true),
('U19D4', 'U19 Nachwuchsliga', 5, 'u19', 'https://www.transfermarkt.de/u19-dfb-nachwuchsliga-vorrunde-gruppe-d/startseite/wettbewerb/19D4', true),
('U19D5', 'U19 Nachwuchsliga', 5, 'u19', 'https://www.transfermarkt.de/u19-dfb-nachwuchsliga-vorrunde-gruppe-e/startseite/wettbewerb/19D5', true),
('U19D6', 'U19 Nachwuchsliga', 5, 'u19', 'https://www.transfermarkt.de/u19-dfb-nachwuchsliga-vorrunde-gruppe-f/startseite/wettbewerb/19D6', true),
('U19D7', 'U19 Nachwuchsliga', 5, 'u19', 'https://www.transfermarkt.de/u19-dfb-nachwuchsliga-vorrunde-gruppe-g/startseite/wettbewerb/19D7', true),
('U19D8', 'U19 Nachwuchsliga', 5, 'u19', 'https://www.transfermarkt.de/u19-dfb-nachwuchsliga-vorrunde-gruppe-h/startseite/wettbewerb/19D8', true),

-- U17 DFB-Nachwuchsliga Vorrunde (8 Gruppen → gleicher Name)
('U17DA', 'U17 Nachwuchsliga', 5, 'u17', 'https://www.transfermarkt.de/u17-dfb-nachwuchsliga-vorrunde-gruppe-a/startseite/wettbewerb/17DA', true),
('U17DB', 'U17 Nachwuchsliga', 5, 'u17', 'https://www.transfermarkt.de/u17-dfb-nachwuchsliga-vorrunde-gruppe-b/startseite/wettbewerb/17DB', true),
('U17DC', 'U17 Nachwuchsliga', 5, 'u17', 'https://www.transfermarkt.de/u17-dfb-nachwuchsliga-vorrunde-gruppe-c/startseite/wettbewerb/17DC', true),
('U17DD', 'U17 Nachwuchsliga', 5, 'u17', 'https://www.transfermarkt.de/u17-dfb-nachwuchsliga-vorrunde-gruppe-d/startseite/wettbewerb/17DD', true),
('U17DE', 'U17 Nachwuchsliga', 5, 'u17', 'https://www.transfermarkt.de/u17-dfb-nachwuchsliga-vorrunde-gruppe-e/startseite/wettbewerb/17DE', true),
('U17DF', 'U17 Nachwuchsliga', 5, 'u17', 'https://www.transfermarkt.de/u17-dfb-nachwuchsliga-vorrunde-gruppe-f/startseite/wettbewerb/17DF', true),
('U17DG', 'U17 Nachwuchsliga', 5, 'u17', 'https://www.transfermarkt.de/u17-dfb-nachwuchsliga-vorrunde-gruppe-g/startseite/wettbewerb/17DG', true),
('U17DH', 'U17 Nachwuchsliga', 5, 'u17', 'https://www.transfermarkt.de/u17-dfb-nachwuchsliga-vorrunde-gruppe-h/startseite/wettbewerb/17DH', true)

ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  tier = EXCLUDED.tier,
  tm_competition_url = EXCLUDED.tm_competition_url,
  is_active = EXCLUDED.is_active;
