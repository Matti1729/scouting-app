-- Beraterverlauf: TM-Link der alten und neuen Agentur mitspeichern (Matti 2026-11-08).
-- Vorher suchte die App den Link über einen aktuellen Spieler derselben Agentur,
-- frühere Agenturen ohne aktuellen Spieler bei uns blieben ohne TM-Symbol (z. B. Bungi, K Consulting).

ALTER TABLE berater_changes
  ADD COLUMN IF NOT EXISTS previous_agent_url TEXT,
  ADD COLUMN IF NOT EXISTS new_agent_url TEXT;

-- Einmaliges Nachtragen aus berater_players (Name normiert: Groß/Klein, "...", "Amp" = &, Bindestriche)
CREATE OR REPLACE FUNCTION pg_temp.agnorm(s TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    lower(s), '\s*(\.\.\.|…)\s*$', ''), '\mamp\M', '&', 'g'), '[–-]', ' ', 'g'), '\s+', ' ', 'g'))
$$;

CREATE TEMP TABLE agency_links AS
SELECT k, min(agent_url) AS agent_url
FROM (
  SELECT pg_temp.agnorm(current_agent_company) AS k, agent_url FROM berater_players
   WHERE agent_url IS NOT NULL AND agent_url <> '' AND current_agent_company IS NOT NULL
  UNION ALL
  SELECT pg_temp.agnorm(current_agent_name), agent_url FROM berater_players
   WHERE agent_url IS NOT NULL AND agent_url <> '' AND current_agent_name IS NOT NULL
) x
WHERE k <> '' AND k !~ '(kein beratereintrag|unter 16|familie)'
GROUP BY k
HAVING count(DISTINCT agent_url) = 1;

UPDATE berater_changes c SET previous_agent_url = l.agent_url
  FROM agency_links l
 WHERE c.previous_agent_url IS NULL
   AND l.k = pg_temp.agnorm(coalesce(c.previous_agent_company, c.previous_agent_name));

UPDATE berater_changes c SET new_agent_url = l.agent_url
  FROM agency_links l
 WHERE c.new_agent_url IS NULL
   AND l.k = pg_temp.agnorm(coalesce(c.new_agent_company, c.new_agent_name));

-- Von TM gekürzte Namen ("Prosport ..."): nur wenn der Anfang eindeutig zu einer Agentur passt
UPDATE berater_changes c SET previous_agent_url = (
  SELECT min(l.agent_url) FROM agency_links l
   WHERE l.k LIKE pg_temp.agnorm(coalesce(c.previous_agent_company, c.previous_agent_name)) || '%'
  HAVING count(DISTINCT l.agent_url) = 1)
 WHERE c.previous_agent_url IS NULL
   AND coalesce(c.previous_agent_company, c.previous_agent_name) ~ '(\.\.\.|…)\s*$';

DROP TABLE agency_links;
