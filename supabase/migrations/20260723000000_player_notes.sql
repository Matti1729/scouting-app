-- Notizen + Erstkontakt-Datum pro Spieler (Spielerprofil-Modal).
-- Eigene Tabelle statt Spalten auf berater_players, damit der Scanner
-- (Upserts) die Scouting-Notizen nie anfassen kann.
CREATE TABLE IF NOT EXISTS player_notes (
  player_id uuid PRIMARY KEY REFERENCES berater_players(id) ON DELETE CASCADE,
  notes text,
  first_contact_date date,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE player_notes ENABLE ROW LEVEL SECURITY;

-- Alle angemeldeten Scouting-Nutzer dürfen lesen und schreiben
DROP POLICY IF EXISTS player_notes_authenticated ON player_notes;
CREATE POLICY player_notes_authenticated ON player_notes
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
