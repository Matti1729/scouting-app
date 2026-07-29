-- Wer hat den Spieler ins Sportstipendium aufgenommen?
-- DEFAULT auth.uid(): wird beim Insert automatisch mit dem angemeldeten
-- Nutzer gefüllt — kein Client-Code nötig, nicht fälschbar.
ALTER TABLE stipendium_entries
  ADD COLUMN IF NOT EXISTS added_by uuid REFERENCES auth.users(id) DEFAULT auth.uid();

-- Anzeigename des Anlegers (SECURITY DEFINER, da Scouts nicht unbedingt
-- fremde advisors-Zeilen lesen dürfen).
CREATE OR REPLACE FUNCTION get_entry_added_by(p_tm_player_id text)
RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT NULLIF(btrim(COALESCE(a.first_name, '') || ' ' || COALESCE(a.last_name, '')), '')
  FROM stipendium_entries e
  JOIN advisors a ON a.id = e.added_by
  WHERE e.tm_player_id = p_tm_player_id
  ORDER BY e.added_at DESC
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION get_entry_added_by(text) TO authenticated;
