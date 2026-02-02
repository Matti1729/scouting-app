-- U19 = tier 6, U17 = tier 7 → nach Regionalligen (tier 4)
UPDATE berater_leagues SET tier = 6 WHERE id LIKE 'U19%';
UPDATE berater_leagues SET tier = 7 WHERE id LIKE 'U17%';
