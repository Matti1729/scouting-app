-- Spielnotizen per Diktat (Matti 2026-10-25), ausgewertet von parse-match-notes
alter table public.scouting_matches add column if not exists scouting_notes text;
alter table public.scouting_matches add column if not exists scouting_notes_updated_at timestamptz;
