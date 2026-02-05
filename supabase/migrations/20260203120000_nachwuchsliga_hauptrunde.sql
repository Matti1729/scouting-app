-- ============================================================================
-- U17/U19 Nachwuchsliga Hauptrunde Ligen hinzufügen
-- Die Hauptrunde findet nach der Vorrunde statt (Liga A und Liga B)
-- Stats werden pro Spieler aus Vorrunde + Hauptrunde aggregiert
-- ============================================================================

INSERT INTO berater_leagues (id, name, tier, category, tm_competition_url, is_active) VALUES
  ('17LA', 'U17 Nachwuchsliga', 7, 'u17', 'https://www.transfermarkt.de/u17-dfb-nachwuchsliga-hauptrunde-liga-a/startseite/wettbewerb/17LA', true),
  ('17LB', 'U17 Nachwuchsliga', 7, 'u17', 'https://www.transfermarkt.de/u17-dfb-nachwuchsliga-hauptrunde-liga-b/startseite/wettbewerb/17LB', true),
  ('19LA', 'U19 Nachwuchsliga', 6, 'u19', 'https://www.transfermarkt.de/u19-dfb-nachwuchsliga-hauptrunde-liga-a/startseite/wettbewerb/19LA', true),
  ('19LB', 'U19 Nachwuchsliga', 6, 'u19', 'https://www.transfermarkt.de/u19-dfb-nachwuchsliga-hauptrunde-liga-b/startseite/wettbewerb/19LB', true)
ON CONFLICT (id) DO NOTHING;
