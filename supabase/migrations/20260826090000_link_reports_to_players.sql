-- Schritt 1 Spieler-Ebene: Berichte (player_evaluations) fest mit dem
-- Spieler-Datensatz (berater_players) verknüpfen.
--
-- Hinweis: player_evaluations wurde seinerzeit ohne Migration direkt im
-- Dashboard angelegt — dies ist die erste versionierte Änderung daran.
-- Ausgeführt am 2026-08-26 im Dashboard (SQL-Editor), hier zur Dokumentation.

-- 0) Duplikate mit gleicher tm_profile_url zusammenführen, bevor der
--    Unique-Index kommt. Behalten wird der Datensatz MIT Verein (TM-Scan),
--    die gescoutete Kopie ohne Verein weicht; Watchlist/Status/Changes
--    wandern zum behaltenen Datensatz.
CREATE TEMP TABLE _dup_pairs AS
WITH ranked AS (
  SELECT bp.id, bp.tm_profile_url,
         row_number() OVER (
           PARTITION BY bp.tm_profile_url
           ORDER BY (bp.club_id IS NOT NULL) DESC, bp.id
         ) AS rn
    FROM public.berater_players bp
   WHERE bp.tm_profile_url IN (
     SELECT tm_profile_url FROM public.berater_players
      WHERE tm_profile_url IS NOT NULL
      GROUP BY tm_profile_url HAVING count(*) > 1)
)
SELECT loser.id AS loser_id, keeper.id AS keeper_id
  FROM ranked loser
  JOIN ranked keeper
    ON keeper.tm_profile_url = loser.tm_profile_url AND keeper.rn = 1
 WHERE loser.rn > 1;

UPDATE public.berater_watchlist w SET player_id = p.keeper_id
  FROM _dup_pairs p
 WHERE w.player_id = p.loser_id
   AND NOT EXISTS (SELECT 1 FROM public.berater_watchlist w2 WHERE w2.player_id = p.keeper_id);
DELETE FROM public.berater_watchlist w USING _dup_pairs p WHERE w.player_id = p.loser_id;

UPDATE public.berater_player_evaluations e SET player_id = p.keeper_id
  FROM _dup_pairs p
 WHERE e.player_id = p.loser_id
   AND NOT EXISTS (SELECT 1 FROM public.berater_player_evaluations e2 WHERE e2.player_id = p.keeper_id);
DELETE FROM public.berater_player_evaluations e USING _dup_pairs p WHERE e.player_id = p.loser_id;

UPDATE public.berater_changes c SET player_id = p.keeper_id
  FROM _dup_pairs p
 WHERE c.player_id = p.loser_id;

DELETE FROM public.berater_players bp USING _dup_pairs p WHERE bp.id = p.loser_id;
DROP TABLE _dup_pairs;

-- 1) Verknüpfung Bericht → Spieler
ALTER TABLE public.player_evaluations
  ADD COLUMN IF NOT EXISTS berater_player_id uuid
  REFERENCES public.berater_players(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_player_evaluations_berater_player
  ON public.player_evaluations(berater_player_id);

-- 2) Transfermarkt-URL als eindeutigen Join-Schlüssel absichern
--    (Vorbedingung: keine Duplikate — vorher geprüft)
CREATE UNIQUE INDEX IF NOT EXISTS uq_berater_players_tm_profile_url
  ON public.berater_players(tm_profile_url) WHERE tm_profile_url IS NOT NULL;

-- 3) Backfill: bestehende Berichte per Transfermarkt-URL verknüpfen
UPDATE public.player_evaluations pe
   SET berater_player_id = bp.id
  FROM public.berater_players bp
 WHERE pe.berater_player_id IS NULL
   AND pe.transfermarkt_url IS NOT NULL
   AND bp.tm_profile_url = pe.transfermarkt_url;

-- 4) Backfill: Rest per Name, nur bei eindeutigem Treffer
UPDATE public.player_evaluations pe
   SET berater_player_id = bp.id
  FROM public.berater_players bp
 WHERE pe.berater_player_id IS NULL
   AND lower(bp.player_name) = lower(trim(coalesce(pe.first_name,'') || ' ' || pe.last_name))
   AND NOT EXISTS (
     SELECT 1 FROM public.berater_players b2
      WHERE lower(b2.player_name) = lower(trim(coalesce(pe.first_name,'') || ' ' || pe.last_name))
        AND b2.id <> bp.id);

-- ============================================================================
-- 5) Namens-Normalisierung: Spieler akzent-/schreibweisen-unabhängig
--    wiedererkennen ("Ouedraogo" = "Ouédraogo"). Grundlage für Dedup beim
--    Bericht-Speichern und fürs automatische Zusammenführen, wenn ein
--    gescouteter Spieler später einen Transfermarkt-Eintrag bekommt.
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION public.normalize_player_name(name text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  SELECT trim(regexp_replace(lower(unaccent(coalesce(name, ''))), '\s+', ' ', 'g'))
$$;

ALTER TABLE public.berater_players
  ADD COLUMN IF NOT EXISTS normalized_name text;

CREATE OR REPLACE FUNCTION public.set_normalized_player_name()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  NEW.normalized_name := public.normalize_player_name(NEW.player_name);
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_berater_players_normalized ON public.berater_players;
CREATE TRIGGER trg_berater_players_normalized
  BEFORE INSERT OR UPDATE OF player_name ON public.berater_players
  FOR EACH ROW EXECUTE FUNCTION public.set_normalized_player_name();

UPDATE public.berater_players
   SET normalized_name = public.normalize_player_name(player_name)
 WHERE normalized_name IS DISTINCT FROM public.normalize_player_name(player_name);

CREATE INDEX IF NOT EXISTS idx_berater_players_normalized
  ON public.berater_players(normalized_name);

-- 6) Backfill-Nachzügler: Berichte, deren Name nur wegen Akzenten nicht
--    gematcht hat (z.B. "Ouedraogo" vs. "Ouédraogo"), per normalisiertem
--    Namen verknüpfen — wieder nur bei eindeutigem Treffer.
UPDATE public.player_evaluations pe
   SET berater_player_id = bp.id
  FROM public.berater_players bp
 WHERE pe.berater_player_id IS NULL
   AND bp.normalized_name = public.normalize_player_name(coalesce(pe.first_name,'') || ' ' || pe.last_name)
   AND NOT EXISTS (
     SELECT 1 FROM public.berater_players b2
      WHERE b2.normalized_name = public.normalize_player_name(coalesce(pe.first_name,'') || ' ' || pe.last_name)
        AND b2.id <> bp.id);
