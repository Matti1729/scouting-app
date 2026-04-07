// transfermarktService.ts - Transfermarkt Integration
//
// Nutzt Supabase Edge Function als Proxy um CORS zu umgehen
// Mit Rate-Limiting und Caching für nachhaltige Nutzung

import { supabase } from '../config/supabase';

export interface TransfermarktPlayer {
  name: string;
  profileUrl: string;
  currentClub?: string;
}

export interface TransfermarktAgentInfo {
  agentName?: string;
  agentCompany?: string;
  hasAgent: boolean;
  birthDate?: string;  // Format: "DD.MM.YYYY"
}

// Erweitertes Interface mit allen Profildaten (für optimierte Suche)
export interface TransfermarktPlayerFull extends TransfermarktPlayer {
  agentName?: string | null;
  agentCompany?: string | null;
  hasAgent?: boolean;
  birthDate?: string | null;
}

// Supabase Edge Function URL
const SUPABASE_URL = 'https://ozggtruvnwozhwjbznsm.supabase.co';
const EDGE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/transfermarkt-proxy`;

// Rate-Limiting: Zufällige Pause zwischen 1.5 und 2.5 Sekunden (vorher 0.8-1.2s)
const getRandomDelay = () => 1500 + Math.random() * 1000;

// Sleep-Funktion für Rate-Limiting
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ============================================================================
// HAUPTFUNKTIONEN
// ============================================================================

/**
 * Sucht einen Spieler über die Supabase Edge Function (Proxy).
 * Die Edge Function umgeht CORS-Einschränkungen im Browser.
 */
export async function searchPlayer(
  playerName: string,
  clubHint?: string,
  searchViaClub?: boolean
): Promise<{ success: boolean; players?: TransfermarktPlayer[]; error?: string }> {
  try {
    console.log('Searching Transfermarkt via Edge Function for:', playerName, clubHint ? `(club: ${clubHint})` : '', searchViaClub ? '[via club]' : '');

    // Get the current session for auth header
    const { data: { session } } = await supabase.auth.getSession();

    const response = await fetch(EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token || ''}`,
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96Z2d0cnV2bndvemh3amJ6bnNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5NDI5ODYsImV4cCI6MjA4MjUxODk4Nn0.QCaSqAQPrIl-DXKiT82wbWAJ23KbeOTpRvq8YI46hCY',
      },
      body: JSON.stringify({ playerName, clubHint, searchViaClub }),
    });

    if (!response.ok) {
      console.error('Edge Function response not ok:', response.status);
      return { success: false, error: `HTTP ${response.status}` };
    }

    const result = await response.json();

    if (!result.success) {
      return { success: false, error: result.error };
    }

    console.log('Found', result.players?.length || 0, 'players on Transfermarkt');

    return { success: true, players: result.players };

  } catch (err) {
    console.error('Transfermarkt search error:', err);
    return { success: false, error: 'Fehler bei der Transfermarkt-Suche' };
  }
}

/**
 * Sucht einen Spieler über den Vereinskader.
 * Wird als Fallback verwendet wenn die normale Suche keinen guten Match findet.
 */
async function searchPlayerViaClub(
  playerName: string,
  clubHint: string
): Promise<{ success: boolean; players?: TransfermarktPlayer[]; error?: string }> {
  return searchPlayer(playerName, clubHint, true);
}

/**
 * OPTIMIERTE SUCHE: Findet Spieler über Vereinskader UND holt direkt alle Profildaten.
 * Spart einen separaten Request für Berater-Info!
 *
 * Ablauf:
 * 1. Verein auf Transfermarkt suchen
 * 2. Spieler im Vereinskader finden
 * 3. Profilseite aufrufen und alle Daten extrahieren (Berater, Geburtsdatum)
 * 4. Alles zusammen zurückgeben
 */
export async function searchPlayerWithFullInfo(
  playerName: string,
  clubHint: string
): Promise<{ success: boolean; player?: TransfermarktPlayerFull; error?: string }> {
  try {
    console.log('Optimized search for:', playerName, 'at', clubHint);

    const { data: { session } } = await supabase.auth.getSession();

    const response = await fetch(EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token || ''}`,
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96Z2d0cnV2bndvemh3amJ6bnNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5NDI5ODYsImV4cCI6MjA4MjUxODk4Nn0.QCaSqAQPrIl-DXKiT82wbWAJ23KbeOTpRvq8YI46hCY',
      },
      body: JSON.stringify({
        playerName,
        clubHint,
        searchWithFullInfo: true  // Aktiviert optimierten Modus
      }),
    });

    if (!response.ok) {
      console.error('Edge Function response not ok:', response.status);
      return { success: false, error: `HTTP ${response.status}` };
    }

    const result = await response.json();

    if (!result.success || !result.player) {
      return { success: false, error: result.error || 'Spieler nicht gefunden' };
    }

    console.log('Optimized search result:', result.player.name, '- Agent:', result.player.agentName, '- BirthDate:', result.player.birthDate, '- URL:', result.player.profileUrl);

    return { success: true, player: result.player };

  } catch (err) {
    console.error('Optimized search error:', err);
    return { success: false, error: 'Fehler bei der optimierten Suche' };
  }
}

/**
 * Sucht den besten Treffer für einen Spieler.
 * Vergleicht Namen und Verein und gibt den besten Match zurück.
 */
export async function findBestMatch(
  playerName: string,
  currentClub?: string
): Promise<{ success: boolean; player?: TransfermarktPlayer; error?: string }> {
  // Pass clubHint to searchPlayer for better search results
  const searchResult = await searchPlayer(playerName, currentClub);

  if (!searchResult.success || !searchResult.players?.length) {
    return { success: false, error: searchResult.error || 'Kein Spieler gefunden' };
  }

  const players = searchResult.players;
  const bestMatch = findBestPlayerMatch(players, playerName, currentClub);

  return { success: true, player: bestMatch };
}

/**
 * Holt Berater-Informationen von einer Transfermarkt-Profil-URL.
 */
export async function fetchAgentInfo(
  profileUrl: string
): Promise<{ success: boolean; agentInfo?: TransfermarktAgentInfo; error?: string }> {
  try {
    console.log('Fetching agent info from:', profileUrl);

    const { data: { session } } = await supabase.auth.getSession();

    const response = await fetch(EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token || ''}`,
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96Z2d0cnV2bndvemh3amJ6bnNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5NDI5ODYsImV4cCI6MjA4MjUxODk4Nn0.QCaSqAQPrIl-DXKiT82wbWAJ23KbeOTpRvq8YI46hCY',
      },
      body: JSON.stringify({ fetchAgentInfo: true, profileUrl }),
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const result = await response.json();

    if (!result.success) {
      return { success: false, error: result.error };
    }

    const agentName = result.agentInfo?.agentName || null;
    // "kein Beratereintrag" means no agent, everything else (including "Familienangehörige") counts as having representation
    const hasAgent = !!(agentName && agentName !== 'kein Beratereintrag');
    const birthDate = result.agentInfo?.birthDate || null;

    const agentInfo: TransfermarktAgentInfo = {
      agentName,
      agentCompany: result.agentInfo?.agentCompany || null,
      hasAgent,
      birthDate,
    };

    console.log('Agent info:', agentInfo, 'Birth date:', birthDate);

    return { success: true, agentInfo };

  } catch (err) {
    console.error('Error fetching agent info:', err);
    return { success: false, error: 'Fehler beim Abrufen der Berater-Info' };
  }
}

/**
 * Batch-Suche für mehrere Spieler mit Rate-Limiting.
 * Sucht nur Spieler die noch keine TM-URL haben.
 *
 * @param players Array von Spielern mit Name und optionalem Club
 * @param onProgress Callback für Fortschrittsanzeige
 * @returns Array von gefundenen TM-URLs
 */
export async function batchSearchPlayers(
  players: Array<{
    id: string;
    name: string;
    vorname?: string;
    clubHint?: string;
    transfermarkt_url?: string | null;
  }>,
  onProgress?: (current: number, total: number, playerName: string) => void
): Promise<Array<{ id: string; transfermarkt_url: string | null }>> {
  const results: Array<{ id: string; transfermarkt_url: string | null }> = [];

  // Nur Spieler ohne TM-URL suchen
  const playersToSearch = players.filter(p => !p.transfermarkt_url);
  const totalToSearch = playersToSearch.length;

  console.log(`Batch search: ${totalToSearch} players to search (${players.length - totalToSearch} already cached)`);

  for (let i = 0; i < playersToSearch.length; i++) {
    const player = playersToSearch[i];
    const fullName = player.vorname ? `${player.vorname} ${player.name}` : player.name;

    // Fortschritt melden
    onProgress?.(i + 1, totalToSearch, fullName);

    try {
      let searchResult: { success: boolean; player?: TransfermarktPlayer; error?: string } = { success: false };

      // PRIORITÄT 1: Wenn Vereins-Hint vorhanden, suche ZUERST über den Vereinskader
      // Dies ist die zuverlässigste Methode!
      if (player.clubHint) {
        console.log(`Trying club squad search FIRST for: ${fullName} at ${player.clubHint}`);
        const clubSquadResult = await searchPlayerViaClub(fullName, player.clubHint);
        if (clubSquadResult.success && clubSquadResult.players?.length) {
          searchResult = { success: true, player: clubSquadResult.players[0] };
          console.log(`Found via club squad: ${clubSquadResult.players[0].name}`);
        }
      }

      // PRIORITÄT 2: Normale Suche (nur wenn Vereinssuche fehlgeschlagen)
      if (!searchResult.success || !searchResult.player?.profileUrl) {
        if (player.clubHint) {
          await sleep(getRandomDelay()); // Rate-Limiting nach Vereinssuche
        }
        console.log(`Trying normal search for: ${fullName}`);
        searchResult = await findBestMatch(fullName, player.clubHint);
      }

      // Fallback 1: Bindestrich-Varianten (z.B. "Al " -> "Al-", "De " -> "De-")
      if (!searchResult.success || !searchResult.player?.profileUrl) {
        // Versuche Bindestriche bei gängigen Präfixen
        const prefixes = [' Al ', ' El ', ' De ', ' Di ', ' Van ', ' Von '];
        for (const prefix of prefixes) {
          if (fullName.includes(prefix)) {
            const altName = fullName.replace(prefix, prefix.trim() + '-');
            console.log(`Trying hyphen variant: ${altName}`);
            searchResult = await findBestMatch(altName, player.clubHint);
            if (searchResult.success && searchResult.player?.profileUrl) break;
            await sleep(getRandomDelay());
          }
        }
      }

      // Fallback 2: Versuche Namen mit Bindestrich zwischen Vor- und Nachname
      if (!searchResult.success || !searchResult.player?.profileUrl) {
        const nameParts = fullName.split(' ');
        if (nameParts.length === 2) {
          const hyphenName = nameParts.join('-');
          console.log(`Trying hyphenated name: ${hyphenName}`);
          searchResult = await findBestMatch(hyphenName, player.clubHint);
        }
      }

      // Fallback 3: Nur Nachname suchen
      if (!searchResult.success || !searchResult.player?.profileUrl) {
        if (player.name && player.name.length > 3) {
          console.log(`Trying last name only: ${player.name}`);
          searchResult = await findBestMatch(player.name, player.clubHint);
        }
      }

      // Fallback 4: Wenn wir einen Treffer haben aber Verein nicht passt, versuche Nachname-Suche
      if (searchResult.success && searchResult.player?.profileUrl && player.clubHint) {
        const foundClub = searchResult.player.currentClub;
        const clubMatches = foundClub && clubMatchScore(foundClub, player.clubHint) > 0;

        if (!clubMatches && player.name && player.name.length > 3) {
          console.log(`Club mismatch (${foundClub || 'unknown'} vs ${player.clubHint}), trying last name: ${player.name}`);
          await sleep(getRandomDelay());
          const lastNameResult = await findBestMatch(player.name, player.clubHint);

          // Nimm Nachname-Ergebnis nur wenn Verein besser passt
          if (lastNameResult.success && lastNameResult.player?.currentClub) {
            const lastNameClubMatch = clubMatchScore(lastNameResult.player.currentClub, player.clubHint);
            if (lastNameClubMatch > 0) {
              searchResult = lastNameResult;
              console.log(`Better club match found via last name: ${lastNameResult.player.currentClub}`);
            }
          }
        }
      }

      // Vereinskader-Suche wird jetzt ZUERST gemacht (oben), daher hier kein Fallback mehr nötig

      if (searchResult.success && searchResult.player?.profileUrl) {
        results.push({
          id: player.id,
          transfermarkt_url: searchResult.player.profileUrl,
        });
        console.log(`✓ Found: ${fullName} -> ${searchResult.player.profileUrl} (${searchResult.player.currentClub || 'no club'})`);
      } else {
        results.push({ id: player.id, transfermarkt_url: null });
        console.log(`✗ Not found: ${fullName}`);
      }
    } catch (err) {
      console.error(`Error searching ${fullName}:`, err);
      results.push({ id: player.id, transfermarkt_url: null });
    }

    // Rate-Limiting: Warte zwischen Requests (außer beim letzten)
    if (i < playersToSearch.length - 1) {
      const delay = getRandomDelay();
      await sleep(delay);
    }
  }

  console.log(`Batch search complete: ${results.filter(r => r.transfermarkt_url).length}/${totalToSearch} found`);

  return results;
}

/**
 * OPTIMIERTE Batch-Suche: Findet Spieler UND holt alle Profildaten in einem Durchgang.
 * Nutzt ausschließlich die Vereinskader-Suche für maximale Genauigkeit.
 *
 * @param players Array von Spielern mit Name und Vereins-Hint
 * @param onProgress Callback für Fortschrittsanzeige
 * @returns Array mit URL + Berater + Geburtsdatum
 */
export async function batchSearchPlayersWithFullInfo(
  players: Array<{
    id: string;
    name: string;
    vorname?: string;
    clubHint: string;  // Pflicht für optimierte Suche!
    transfermarkt_url?: string | null;
    agent_name?: string | null;
    agent_company?: string | null;
    has_agent?: boolean;
    birth_date?: string | null;
  }>,
  onProgress?: (current: number, total: number, playerName: string) => void
): Promise<Array<{
  id: string;
  transfermarkt_url: string | null;
  agent_name: string | null;
  agent_company: string | null;
  has_agent: boolean;
  birth_date: string | null;
}>> {
  const results: Array<{
    id: string;
    transfermarkt_url: string | null;
    agent_name: string | null;
    agent_company: string | null;
    has_agent: boolean;
    birth_date: string | null;
  }> = [];

  // Nur Spieler ohne TM-URL oder ohne vollständige Profildaten suchen
  // Auch Spieler mit TM-URL aber ohne Berater/Geburtsdatum werden neu gesucht
  const playersToSearch = players.filter(p => !p.transfermarkt_url || !p.agent_name || !p.birth_date);
  const totalToSearch = playersToSearch.length;

  console.log(`Optimized batch search: ${totalToSearch} players to search (missing URL, agent, or birth_date)`);
  console.log('Players to search:', playersToSearch.map(p => ({ name: p.name, vorname: p.vorname, clubHint: p.clubHint })));

  for (let i = 0; i < playersToSearch.length; i++) {
    const player = playersToSearch[i];
    const fullName = player.vorname ? `${player.vorname} ${player.name}` : player.name;

    onProgress?.(i + 1, totalToSearch, fullName);

    try {
      // Wenn bereits TM-URL vorhanden, nur Profildaten abrufen
      if (player.transfermarkt_url) {
        console.log(`Fetching profile data for: ${fullName} (URL exists)`);
        const agentResult = await fetchAgentInfo(player.transfermarkt_url);

        if (agentResult.success && agentResult.agentInfo) {
          // Neue Daten verwenden, aber bestehende Daten beibehalten wenn neue null sind
          const newAgentName = agentResult.agentInfo.agentName || player.agent_name || null;
          const newAgentCompany = agentResult.agentInfo.agentCompany || player.agent_company || null;
          const newHasAgent = agentResult.agentInfo.hasAgent || player.has_agent || false;
          const newBirthDate = agentResult.agentInfo.birthDate || player.birth_date || null;

          results.push({
            id: player.id,
            transfermarkt_url: player.transfermarkt_url,
            agent_name: newAgentName,
            agent_company: newAgentCompany,
            has_agent: newHasAgent,
            birth_date: newBirthDate,
          });
          console.log(`✓ Profile: ${fullName}, Agent: ${newAgentName || '-'}, Birth: ${newBirthDate || '-'}`);
        } else {
          // Fetch fehlgeschlagen - bestehende Daten beibehalten!
          results.push({
            id: player.id,
            transfermarkt_url: player.transfermarkt_url,
            agent_name: player.agent_name || null,
            agent_company: player.agent_company || null,
            has_agent: player.has_agent || false,
            birth_date: player.birth_date || null,
          });
          console.log(`✗ Profile fetch failed: ${fullName} (keeping existing data)`);
        }
      } else {
        // Keine TM-URL - volle Suche durchführen
        const result = await searchPlayerWithFullInfo(fullName, player.clubHint);

        if (result.success && result.player) {
          // Neue Daten verwenden, bestehende als Fallback
          const newAgentName = result.player.agentName || player.agent_name || null;
          const newAgentCompany = result.player.agentCompany || player.agent_company || null;
          const newHasAgent = result.player.hasAgent || player.has_agent || false;
          const newBirthDate = result.player.birthDate || player.birth_date || null;

          results.push({
            id: player.id,
            transfermarkt_url: result.player.profileUrl,
            agent_name: newAgentName,
            agent_company: newAgentCompany,
            has_agent: newHasAgent,
            birth_date: newBirthDate,
          });
          console.log(`✓ Found: ${fullName} -> ${result.player.name}, Agent: ${newAgentName || '-'}, Birth: ${newBirthDate || '-'}`);
        } else {
          // Nicht gefunden - bestehende Daten beibehalten
          results.push({
            id: player.id,
            transfermarkt_url: player.transfermarkt_url || null,
            agent_name: player.agent_name || null,
            agent_company: player.agent_company || null,
            has_agent: player.has_agent || false,
            birth_date: player.birth_date || null,
          });
          console.log(`✗ Not found: ${fullName} (keeping existing data)`);
        }
      }
    } catch (err) {
      console.error(`Error searching ${fullName}:`, err);
      // Fehler - bestehende Daten beibehalten!
      results.push({
        id: player.id,
        transfermarkt_url: player.transfermarkt_url || null,
        agent_name: player.agent_name || null,
        agent_company: player.agent_company || null,
        has_agent: player.has_agent || false,
        birth_date: player.birth_date || null,
      });
    }

    // Rate-Limiting
    if (i < playersToSearch.length - 1) {
      const delay = getRandomDelay();
      await sleep(delay);
    }
  }

  console.log(`Optimized batch search complete: ${results.filter(r => r.transfermarkt_url).length}/${totalToSearch} found`);

  return results;
}

/**
 * Batch-Abruf von Berater-Info für mehrere Spieler.
 * Ruft nur Spieler ab die eine TM-URL haben aber noch keine Berater-Info.
 *
 * @param players Array von Spielern mit TM-URL
 * @param onProgress Callback für Fortschrittsanzeige
 * @returns Array von Berater-Updates
 */
export async function batchFetchAgentInfo(
  players: Array<{
    id: string;
    name: string;
    transfermarkt_url?: string | null;
    agent_name?: string | null;
    agent_company?: string | null;
    has_agent?: boolean | null;
    birth_date?: string | null;
  }>,
  onProgress?: (current: number, total: number, playerName: string) => void
): Promise<Array<{ id: string; agent_name: string | null; agent_company: string | null; has_agent: boolean; birth_date: string | null }>> {
  const results: Array<{ id: string; agent_name: string | null; agent_company: string | null; has_agent: boolean; birth_date: string | null }> = [];

  // Nur Spieler mit TM-URL aber ohne Berater-Info
  const playersToFetch = players.filter(p =>
    p.transfermarkt_url &&
    p.agent_name === null &&
    p.has_agent !== true
  );

  const totalToFetch = playersToFetch.length;

  console.log(`Batch agent fetch: ${totalToFetch} players to fetch (${players.length - totalToFetch} already have agent info or no TM URL)`);

  for (let i = 0; i < playersToFetch.length; i++) {
    const player = playersToFetch[i];

    onProgress?.(i + 1, totalToFetch, player.name);

    try {
      const agentResult = await fetchAgentInfo(player.transfermarkt_url!);

      if (agentResult.success && agentResult.agentInfo) {
        // Neue Daten verwenden, bestehende als Fallback
        const newAgentName = agentResult.agentInfo.agentName || player.agent_name || null;
        const newAgentCompany = agentResult.agentInfo.agentCompany || player.agent_company || null;
        const newHasAgent = agentResult.agentInfo.hasAgent || player.has_agent || false;
        const newBirthDate = agentResult.agentInfo.birthDate || player.birth_date || null;

        results.push({
          id: player.id,
          agent_name: newAgentName,
          agent_company: newAgentCompany,
          has_agent: newHasAgent,
          birth_date: newBirthDate,
        });
        console.log(`✓ Agent for ${player.name}: ${newAgentName || 'Kein Berater'}, Birth: ${newBirthDate || '-'}`);
      } else {
        // Fetch fehlgeschlagen - bestehende Daten beibehalten!
        results.push({
          id: player.id,
          agent_name: player.agent_name || null,
          agent_company: player.agent_company || null,
          has_agent: player.has_agent || false,
          birth_date: player.birth_date || null,
        });
        console.log(`✗ Agent fetch failed for ${player.name} (keeping existing data)`);
      }
    } catch (err) {
      console.error(`Error fetching agent for ${player.name}:`, err);
      // Fehler - bestehende Daten beibehalten!
      results.push({
        id: player.id,
        agent_name: player.agent_name || null,
        agent_company: player.agent_company || null,
        has_agent: player.has_agent || false,
        birth_date: player.birth_date || null,
      });
    }

    // Rate-Limiting
    if (i < playersToFetch.length - 1) {
      const delay = getRandomDelay();
      await sleep(delay);
    }
  }

  console.log(`Batch agent fetch complete: ${results.filter(r => r.has_agent).length}/${totalToFetch} have agents`);

  return results;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Findet den besten Match basierend auf Name und Verein.
 */
function findBestPlayerMatch(
  players: TransfermarktPlayer[],
  searchName: string,
  clubHint?: string
): TransfermarktPlayer | null {
  if (players.length === 0) return null;

  const normalizedSearchName = normalizeName(searchName);
  const nameParts = normalizedSearchName.split(' ').filter(p => p.length > 0);

  let bestMatch: TransfermarktPlayer | null = null;
  let bestScore = 0;
  let bestHasClubMatch = false;

  for (const player of players) {
    const normalizedPlayerName = normalizeName(player.name);
    let score = 0;
    let hasClubMatch = false;

    // Exakter Name-Match
    if (normalizedPlayerName === normalizedSearchName) {
      score = 100;
    } else {
      // Substring-Match: Suchname im Spielernamen enthalten oder umgekehrt
      if (normalizedPlayerName.includes(normalizedSearchName) || normalizedSearchName.includes(normalizedPlayerName)) {
        score += 80;
      } else {
        // Teilweise Matches mit längen-gewichteter Bewertung
        for (const part of nameParts) {
          if (part.length >= 2 && normalizedPlayerName.includes(part)) {
            // Längere Teile stärker gewichten
            score += part.length >= 5 ? 30 : part.length >= 3 ? 20 : 10;
          }
        }

        // Nachname am Ende
        const lastName = nameParts[nameParts.length - 1];
        if (lastName && lastName.length >= 3 && normalizedPlayerName.endsWith(lastName)) {
          score += 30;
        }

        // Erster Namensteil (Vorname) matcht am Anfang
        const firstName = nameParts[0];
        if (firstName && firstName.length >= 3 && normalizedPlayerName.startsWith(firstName)) {
          score += 15;
        }
      }
    }

    // Verein-Match Bonus (stark gewichtet!)
    if (clubHint && player.currentClub) {
      const normalizedClub = normalizeName(clubHint);
      const normalizedPlayerClub = normalizeName(player.currentClub);

      // Exakter Verein-Match
      if (normalizedPlayerClub === normalizedClub) {
        score += 200;
        hasClubMatch = true;
      } else {
        // Keyword-basierter Match: >50% der Keywords (Länge>2) müssen übereinstimmen
        const clubKeywords = normalizedClub.split(' ').filter(w => w.length > 2);
        const matchingKeywords = clubKeywords.filter(kw => normalizedPlayerClub.includes(kw));
        if (clubKeywords.length > 0 && matchingKeywords.length >= Math.ceil(clubKeywords.length * 0.5)) {
          score += 100;
          hasClubMatch = true;
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = player;
      bestHasClubMatch = hasClubMatch;
    }
  }

  // STRIKT: Wenn clubHint vorhanden ist, MUSS der beste Match den Club matchen.
  // Lieber kein Ergebnis als ein falscher Spieler von einem anderen Verein.
  if (clubHint && bestMatch && !bestHasClubMatch) {
    console.log(`[TM] Rejecting "${bestMatch.name}" (club: ${bestMatch.currentClub || '?'}) - doesn't match "${clubHint}"`);
    return null;
  }

  return bestMatch;
}

/**
 * Berechnet die Levenshtein-Distanz (Edit Distance) zwischen zwei Strings.
 * Gibt die minimale Anzahl an Einfügungen, Löschungen oder Ersetzungen zurück.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = i - 1;
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  return dp[n];
}

/**
 * Normalisiert Namen für Vergleiche.
 * Nutzt Unicode NFD-Decomposition für robuste Diakritika-Entfernung.
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // Alle Diakritika entfernen (é→e, č→c, ñ→n etc.)
    .replace(/ø/g, 'o')               // Dänisch/Norwegisch (nicht durch NFD abgedeckt)
    .replace(/ð/g, 'd')               // Isländisch
    .replace(/þ/g, 'th')              // Isländisch
    .replace(/ł/g, 'l')               // Polnisch
    .replace(/đ/g, 'd')               // Kroatisch/Serbisch
    .replace(/ß/g, 'ss')              // Deutsch
    .replace(/æ/g, 'ae')              // Dänisch/Norwegisch
    .replace(/oe/g, 'o')              // Digraphen (TM-URL-Slugs nutzen oe/ae/ue)
    .replace(/ue/g, 'u')
    .replace(/[^a-z0-9\s-]/g, '')     // Restliche Sonderzeichen entfernen
    .replace(/\s+/g, ' ');            // Whitespace normalisieren
}

/**
 * Berechnet einen Score für die Übereinstimmung zweier Vereinsnamen.
 * Gibt 0 zurück wenn keine Übereinstimmung, > 0 wenn Übereinstimmung.
 */
function clubMatchScore(club1: string, club2: string): number {
  const normalized1 = normalizeName(club1);
  const normalized2 = normalizeName(club2);

  // Exakter Match
  if (normalized1 === normalized2) return 200;

  // Keyword-Match
  const keywords1 = normalized1.split(' ').filter(w => w.length > 3);
  const keywords2 = normalized2.split(' ').filter(w => w.length > 3);

  for (const kw1 of keywords1) {
    for (const kw2 of keywords2) {
      if (kw1.includes(kw2) || kw2.includes(kw1)) {
        return 100;
      }
    }
  }

  return 0;
}

/**
 * Generiert eine Transfermarkt-Such-URL.
 */
export function getTransfermarktSearchUrl(playerName: string): string {
  return `https://www.transfermarkt.de/schnellsuche/ergebnis/schnellsuche?query=${encodeURIComponent(playerName)}`;
}

/**
 * Validiert eine Transfermarkt-URL.
 */
export function isValidTransfermarktUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.hostname.includes('transfermarkt');
  } catch {
    return false;
  }
}

// ============================================================================
// BERATER-DB LOOKUP (schneller als TM-Suche, nutzt bereits gescannte Daten)
// ============================================================================

export interface BeraterDBResult {
  id: string;
  transfermarkt_url: string | null;
  agent_name: string | null;
  agent_company: string | null;
  has_agent: boolean;
  birth_date: string | null;
  matched: boolean;  // true = aus DB gefunden, false = muss TM-Fallback nutzen
  db_player_name?: string | null; // Originalname aus DB (mit korrekten Umlauten)
}

/**
 * Sucht Spieler-Daten zuerst in der berater_players-Tabelle (sofort, kein Rate-Limiting).
 * Gibt für jeden Spieler an ob er gefunden wurde (matched=true) oder TM-Fallback nötig ist.
 *
 * Flow: clubHint → berater_clubs matchen → berater_players laden → Name matchen
 */
export async function enrichFromBeraterDB(
  players: Array<{
    id: string;
    name: string;
    vorname?: string;
    clubHint: string;
    transfermarkt_url?: string | null;
    agent_name?: string | null;
    agent_company?: string | null;
    has_agent?: boolean;
    birth_date?: string | null;
  }>,
): Promise<BeraterDBResult[]> {
  const results: BeraterDBResult[] = [];

  // Spieler nach Club gruppieren (Heim vs Auswärts)
  const clubGroups = new Map<string, typeof players>();
  for (const player of players) {
    const club = player.clubHint;
    if (!clubGroups.has(club)) clubGroups.set(club, []);
    clubGroups.get(club)!.push(player);
  }

  for (const [clubHint, clubPlayers] of clubGroups) {
    if (!clubHint) {
      // Kein Club-Hint → alle unmatched
      results.push(...clubPlayers.map(p => ({
        id: p.id,
        transfermarkt_url: p.transfermarkt_url || null,
        agent_name: p.agent_name || null,
        agent_company: p.agent_company || null,
        has_agent: p.has_agent || false,
        birth_date: p.birth_date || null,
        matched: false,
      })));
      continue;
    }

    // 1. Club in berater_clubs suchen (fuzzy: ilike)
    // fussball.de nutzt ASCII-Digraphen ("Koeln"), berater_clubs nutzt Umlaute ("Köln")
    const normalizedHint = clubHint.replace(/[.\s]+/g, '%');
    const withUmlauts = clubHint
      .replace(/oe/gi, 'ö').replace(/ae/gi, 'ä').replace(/ue/gi, 'ü');
    const normalizedUmlaut = withUmlauts.replace(/[.\s]+/g, '%');

    // Kern-Vereinsname extrahieren (ohne FC, SV, Nummern, Altersklassen)
    const commonPrefixes = new Set(['fc', 'sv', 'vfl', 'vfb', 'tsv', 'bsg', 'sg', 'sc', 'fsv', 'spvgg', 'tus', 'bv', 'ssv']);
    const coreWords = clubHint.split(/[\s.]+/)
      .filter(w => w.length > 2 && !commonPrefixes.has(w.toLowerCase()) && !/^\d+$/.test(w) && !/^u\d+$/i.test(w));
    const coreName = coreWords[0] || '';
    const coreUmlaut = coreName.replace(/oe/gi, 'ö').replace(/ae/gi, 'ä').replace(/ue/gi, 'ü');

    // Mehrere Varianten suchen für robustes Matching
    let orClauses = `club_name.ilike.%${normalizedHint}%,club_name.ilike.%${normalizedUmlaut}%`;
    if (coreName) {
      orClauses += `,club_name.ilike.%${coreName}%`;
      if (coreUmlaut !== coreName) {
        orClauses += `,club_name.ilike.%${coreUmlaut}%`;
      }
    }

    const { data: clubs } = await supabase
      .from('berater_clubs')
      .select('id, club_name')
      .or(orClauses)
      .eq('is_active', true)
      .limit(10);

    if (!clubs?.length) {
      console.log(`[BeraterDB] Club not found: "${clubHint}" → TM-Fallback`);
      results.push(...clubPlayers.map(p => ({
        id: p.id,
        transfermarkt_url: p.transfermarkt_url || null,
        agent_name: p.agent_name || null,
        agent_company: p.agent_company || null,
        has_agent: p.has_agent || false,
        birth_date: p.birth_date || null,
        matched: false,
      })));
      continue;
    }

    // Alle passenden Clubs filtern (score > 0)
    const matchedClubs = clubs
      .map(club => ({ club, score: clubMatchScore(club.club_name, clubHint) }))
      .filter(c => c.score > 0)
      .sort((a, b) => b.score - a.score);

    if (matchedClubs.length === 0) {
      console.log(`[BeraterDB] No club match for: "${clubHint}"`);
      results.push(...clubPlayers.map(p => ({
        id: p.id,
        transfermarkt_url: p.transfermarkt_url || null,
        agent_name: p.agent_name || null,
        agent_company: p.agent_company || null,
        has_agent: p.has_agent || false,
        birth_date: p.birth_date || null,
        matched: false,
      })));
      continue;
    }

    console.log(`[BeraterDB] ${matchedClubs.length} clubs matched for "${clubHint}": ${matchedClubs.map(c => `"${c.club.club_name}" (${c.score})`).join(', ')}`);

    // 2. Spieler aus ALLEN passenden Clubs laden (z.B. Hauptteam + U19 + U17)
    const allClubIds = matchedClubs.map(c => c.club.id);
    const { data: beraterPlayers } = await supabase
      .from('berater_players')
      .select('player_name, tm_profile_url, birth_date, current_agent_name, current_agent_company, has_agent, club_id')
      .in('club_id', allClubIds)
      .eq('is_active', true);

    if (!beraterPlayers?.length) {
      console.log(`[BeraterDB] No players across ${matchedClubs.length} clubs`);
      results.push(...clubPlayers.map(p => ({
        id: p.id,
        transfermarkt_url: p.transfermarkt_url || null,
        agent_name: p.agent_name || null,
        agent_company: p.agent_company || null,
        has_agent: p.has_agent || false,
        birth_date: p.birth_date || null,
        matched: false,
      })));
      continue;
    }

    console.log(`[BeraterDB] Loaded ${beraterPlayers.length} players from ${matchedClubs.length} clubs`);

    // 3. Lineup-Spieler gegen ALLE berater_players matchen
    for (const player of clubPlayers) {
      const fullName = player.vorname ? `${player.vorname} ${player.name}` : player.name;
      const match = findBestBeraterMatch(fullName, beraterPlayers);

      if (match) {
        console.log(`[BeraterDB] ✓ ${fullName} → ${match.player_name} (TM: ${match.tm_profile_url ? 'ja' : 'nein'})`);
        results.push({
          id: player.id,
          transfermarkt_url: match.tm_profile_url || player.transfermarkt_url || null,
          agent_name: match.current_agent_name || player.agent_name || null,
          agent_company: match.current_agent_company || player.agent_company || null,
          has_agent: match.has_agent || player.has_agent || false,
          birth_date: match.birth_date || player.birth_date || null,
          matched: true,
          db_player_name: match.player_name,
        });
      } else {
        console.log(`[BeraterDB] ✗ ${fullName} → not found across ${matchedClubs.length} clubs`);
        results.push({
          id: player.id,
          transfermarkt_url: player.transfermarkt_url || null,
          agent_name: player.agent_name || null,
          agent_company: player.agent_company || null,
          has_agent: player.has_agent || false,
          birth_date: player.birth_date || null,
          matched: false,
        });
      }
    }
  }

  const matched = results.filter(r => r.matched).length;
  console.log(`[BeraterDB] Result: ${matched}/${results.length} matched from DB`);
  return results;
}

/**
 * Findet den besten Namens-Match in berater_players.
 * Nutzt normalizeName() für Umlaute/Akzente.
 */
function findBestBeraterMatch(
  searchName: string,
  beraterPlayers: Array<{
    player_name: string;
    tm_profile_url: string | null;
    birth_date: string | null;
    current_agent_name: string | null;
    current_agent_company: string | null;
    has_agent: boolean | null;
  }>,
): typeof beraterPlayers[0] | null {
  const normalizedSearch = normalizeName(searchName);
  const searchParts = normalizedSearch.split(' ').filter(p => p.length > 0);

  let bestMatch: typeof beraterPlayers[0] | null = null;
  let bestScore = 0;

  for (const bp of beraterPlayers) {
    const normalizedPlayer = normalizeName(bp.player_name);
    const playerParts = normalizedPlayer.split(' ').filter(p => p.length > 0);
    const isKuenstlername = playerParts.length === 1; // DB hat nur 1 Name (z.B. "Bernardo")

    let score = 0;

    // Exakter Match
    if (normalizedSearch === normalizedPlayer) {
      score = 200;
    }

    // Künstlername-Match: DB hat nur 1 Name, fussball.de hat mehrere
    // z.B. DB: "Bernardo" ↔ fussball.de: "Fernandes da Silva Junior Bernardo"
    else if (isKuenstlername && normalizedPlayer.length >= 3) {
      if (searchParts.includes(normalizedPlayer)) {
        score = 120; // Künstlername ist einer der Namensteile
      } else if (normalizedSearch.includes(normalizedPlayer)) {
        score = 100; // Künstlername ist Substring des Suchnamens
      }
    }

    else {
      // Nachname-Match
      const searchLast = searchParts[searchParts.length - 1];
      const playerLast = playerParts[playerParts.length - 1];
      let hasLastNameMatch = false;

      if (searchLast === playerLast) {
        score += 60;
        hasLastNameMatch = true;
      } else if (searchParts.includes(playerLast)) {
        score += 50;
        hasLastNameMatch = true;
      } else if (playerParts.includes(searchLast)) {
        score += 50;
        hasLastNameMatch = true;
      }

      // Vorname-Match: mindestens ein Vorname muss matchen
      // Bei 2 Vornamen (z.B. "William Cole") oder Hyphen-Vornamen
      // ("Mohammed-Elamine" = 2 Vornamen) reicht einer
      if (hasLastNameMatch) {
        // Hyphen-Vornamen direkt als separate Vornamen behandeln
        const searchFirstNames = searchParts.slice(0, -1).flatMap(n => n.split('-')).filter(p => p.length >= 2);
        const playerFirstNames = playerParts.slice(0, -1).flatMap(n => n.split('-')).filter(p => p.length >= 2);

        let bestFirstNameScore = 0;
        for (const sf of searchFirstNames) {
          for (const pf of playerFirstNames) {
            if (sf === pf) {
              bestFirstNameScore = Math.max(bestFirstNameScore, 40);
            } else if (sf.length >= 3 && pf.length >= 3 &&
                       (sf.startsWith(pf) || pf.startsWith(sf))) {
              // "Mo" vs "Mohamed", "Alex" vs "Alexander"
              bestFirstNameScore = Math.max(bestFirstNameScore, 25);
            } else if (sf.length >= 4 && pf.length >= 4 && levenshtein(sf, pf) <= 1) {
              // "Mohammed" vs "Mohamed" (1 Buchstabe Differenz)
              bestFirstNameScore = Math.max(bestFirstNameScore, 35);
            }
          }
        }
        score += bestFirstNameScore;
      }

      // Teil-Wort-Matches für zusammengesetzte Namen
      for (const sp of searchParts) {
        for (const pp of playerParts) {
          if (sp.length >= 3 && pp.length >= 3 && sp !== searchParts[0] && sp !== searchParts[searchParts.length - 1]) {
            if (sp === pp) score += 15;
          }
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = bp;
    }
  }

  // Mindestens Score 80 für Match (Nachname + Vorname oder Künstlername)
  if (bestScore >= 80) return bestMatch;

  // Fuzzy-Fallback: Levenshtein-Distanz für Tippfehler/Schreibfehler bei fussball.de
  // z.B. "Mohammed-Elamine" vs "Mohamed-Elamine" (1 Buchstabe Differenz)
  let fuzzyMatch: typeof beraterPlayers[0] | null = null;
  let fuzzyBestDist = Infinity;

  for (const bp of beraterPlayers) {
    const normalizedPlayer = normalizeName(bp.player_name);
    const playerParts = normalizedPlayer.split(' ').filter(p => p.length > 0);
    const searchLast = searchParts[searchParts.length - 1];
    const playerLast = playerParts[playerParts.length - 1];

    // Nachname muss exakt oder fast exakt matchen (max 1 Edit)
    const lastNameDist = levenshtein(searchLast, playerLast);
    if (lastNameDist > 1) continue;

    // Gesamtname: max 2 Edits bei kurzen Namen, max 3 bei langen
    const maxDist = normalizedSearch.length > 15 ? 3 : 2;
    const fullDist = levenshtein(normalizedSearch, normalizedPlayer);

    if (fullDist <= maxDist && fullDist < fuzzyBestDist) {
      fuzzyBestDist = fullDist;
      fuzzyMatch = bp;
    }
  }

  if (fuzzyMatch) {
    console.log(`[BeraterDB] Fuzzy match (dist=${fuzzyBestDist}): "${searchName}" → "${fuzzyMatch.player_name}"`);
  }

  return fuzzyMatch;
}
