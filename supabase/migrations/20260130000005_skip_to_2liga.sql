-- Scan-Index auf 18 setzen (Bundesliga überspringen, ab 2. Liga weiter)
UPDATE berater_scan_state SET next_club_index = 18, total_clubs = (SELECT count(*) FROM berater_clubs WHERE is_active = true);
