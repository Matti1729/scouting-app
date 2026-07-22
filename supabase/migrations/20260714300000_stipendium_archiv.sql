-- Sportstipendium: Archiv-Status (abgesagt / aktuell nicht interessant genug)
ALTER TABLE stipendium_entries DROP CONSTRAINT IF EXISTS stipendium_entries_status_check;
ALTER TABLE stipendium_entries ADD CONSTRAINT stipendium_entries_status_check CHECK (status IN ('interessant', 'kontaktiert', 'go', 'archiviert'));
