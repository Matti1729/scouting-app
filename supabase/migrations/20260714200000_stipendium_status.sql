-- Sportstipendium-Board: neue Status-Werte (Interessante Spieler / Kontaktiert / Go-Kandidaten)
ALTER TABLE stipendium_entries DROP CONSTRAINT IF EXISTS stipendium_entries_status_check;
ALTER TABLE stipendium_entries ALTER COLUMN status SET DEFAULT 'interessant';
UPDATE stipendium_entries SET status = 'interessant' WHERE status NOT IN ('interessant', 'kontaktiert', 'go');
ALTER TABLE stipendium_entries ADD CONSTRAINT stipendium_entries_status_check CHECK (status IN ('interessant', 'kontaktiert', 'go'));
