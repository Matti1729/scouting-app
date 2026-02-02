-- Alle Ligen aktivieren für Bootstrap
UPDATE berater_leagues SET is_active = true WHERE is_active = false;
