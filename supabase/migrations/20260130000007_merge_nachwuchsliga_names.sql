-- U19-Staffeln unter einem Namen zusammenfassen
UPDATE berater_leagues SET name = 'U19 Nachwuchsliga' WHERE id LIKE 'U19%';

-- U17-Staffeln unter einem Namen zusammenfassen
UPDATE berater_leagues SET name = 'U17 Nachwuchsliga' WHERE id LIKE 'U17%';
