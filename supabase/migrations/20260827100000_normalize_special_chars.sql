-- Namens-Normalisierung: Sonderzeichen (Bindestrich, Apostroph, Punkt) werden
-- zu Leerzeichen, damit "Karl-Heinz" = "Karl Heinz" und "N'Dour" = "N Dour".
-- Muss zur JS-Funktion normalizePlayerName (beraterService) passen.
CREATE OR REPLACE FUNCTION public.normalize_player_name(name text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  SELECT trim(regexp_replace(
    regexp_replace(lower(unaccent(coalesce(name, ''))), '[-''’´`._]+', ' ', 'g'),
    '\s+', ' ', 'g'))
$$;

-- Alle vorhandenen Namen neu berechnen (Trigger nutzt die Funktion weiter)
UPDATE public.berater_players
   SET normalized_name = public.normalize_player_name(player_name)
 WHERE normalized_name IS DISTINCT FROM public.normalize_player_name(player_name);
