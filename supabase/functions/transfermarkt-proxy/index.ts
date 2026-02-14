// Supabase Edge Function: Transfermarkt Proxy
// Umgeht CORS-Einschränkungen im Browser durch serverseitigen Fetch

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// User-Agent Rotation (wie in berater-scan)
const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
]
const getRandomUA = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]

const BROWSER_HEADERS = {
  'User-Agent': getRandomUA(),
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
  'Cache-Control': 'no-cache',
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// Fetch with retry and backoff for 429/403
async function fetchWithRetry(url: string, options: RequestInit = {}, maxRetries = 3): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const headers = { ...BROWSER_HEADERS, 'User-Agent': getRandomUA(), ...(options.headers || {}) }
    const response = await fetch(url, { ...options, headers })
    if (response.ok) return response
    if (response.status === 429 || response.status === 403) {
      if (attempt < maxRetries) {
        const backoff = Math.pow(2, attempt) * 3000 // 3s, 6s, 12s
        console.log(`TM rate limited (${response.status}), backing off ${backoff}ms...`)
        await sleep(backoff)
        continue
      }
    }
    return response // andere Fehler: nicht retrien
  }
  throw new Error('fetchWithRetry: exhausted all retries')
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { playerName, clubHint, searchViaClub, fetchAgentInfo, profileUrl, searchWithFullInfo } = await req.json()

    // Modus: Berater-Info von Profil-URL abrufen (Legacy - wird noch für Einzelabfragen genutzt)
    if (fetchAgentInfo && profileUrl) {
      console.log('Fetching agent info from:', profileUrl)
      const agentInfo = await fetchAgentFromProfile(profileUrl)
      return new Response(
        JSON.stringify({ success: true, agentInfo }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    if (!playerName) {
      return new Response(
        JSON.stringify({ success: false, error: 'playerName is required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // OPTIMIERTER MODUS: Suche über Vereinskader + hole direkt alle Profildaten
    // Falls Vereinskader-Suche fehlschlägt: Fallback zur normalen Suche
    if (searchWithFullInfo && clubHint) {
      console.log('Optimized search for:', playerName, 'at', clubHint)
      const fullResult = await searchViaClubSquadWithFullInfo(playerName, clubHint)
      if (fullResult) {
        return new Response(
          JSON.stringify({ success: true, player: fullResult }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
      }

      // FALLBACK: Normale Suche wenn Vereinskader-Suche fehlschlägt
      console.log('Club squad search failed, trying normal search for:', playerName)
      const searchUrl = `https://www.transfermarkt.de/schnellsuche/ergebnis/schnellsuche?query=${encodeURIComponent(playerName)}&Spieler_Spieler=Spieler`

      const response = await fetchWithRetry(searchUrl, {
        method: 'GET',
      })

      if (response.ok) {
        const html = await response.text()
        const players = parseSearchResults(html)

        if (players.length > 0) {
          // Beste Match finden (bevorzuge Verein-Match)
          const bestMatch = findBestPlayerMatch(players, playerName, clubHint)

          if (bestMatch?.profileUrl) {
            console.log('Normal search found:', bestMatch.name, '- Fetching profile...')
            // Profildaten nachladen
            const agentInfo = await fetchAgentFromProfile(bestMatch.profileUrl)

            const fullPlayer: TransfermarktPlayerFull = {
              name: bestMatch.name,
              profileUrl: bestMatch.profileUrl.startsWith('http')
                ? bestMatch.profileUrl
                : `https://www.transfermarkt.de${bestMatch.profileUrl}`,
              currentClub: bestMatch.currentClub,
              agentName: agentInfo.agentName,
              agentCompany: agentInfo.agentCompany,
              hasAgent: !!(agentInfo.agentName && agentInfo.agentName !== 'kein Beratereintrag'),
              birthDate: agentInfo.birthDate,
            }

            return new Response(
              JSON.stringify({ success: true, player: fullPlayer }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
            )
          }
        }
      }

      return new Response(
        JSON.stringify({ success: false, error: 'Player not found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    // Legacy: Wenn searchViaClub=true und clubHint vorhanden, suche über den Vereinskader (ohne Profildaten)
    if (searchViaClub && clubHint) {
      console.log('Searching via club squad for:', playerName, 'at', clubHint)
      const clubResult = await searchViaClubSquad(playerName, clubHint)
      if (clubResult) {
        return new Response(
          JSON.stringify({ success: true, players: [clubResult] }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
      }
      // Fallback zur normalen Suche wenn Vereinssuche fehlschlägt
    }

    // Normale Spieler-spezifische Suche
    const searchUrl = `https://www.transfermarkt.de/schnellsuche/ergebnis/schnellsuche?query=${encodeURIComponent(playerName)}&Spieler_Spieler=Spieler`

    console.log('Searching Transfermarkt for:', playerName, clubHint ? `(club hint: ${clubHint})` : '')

    const response = await fetchWithRetry(searchUrl, {
      method: 'GET',
    })

    if (!response.ok) {
      console.error('Transfermarkt response not ok:', response.status)
      return new Response(
        JSON.stringify({ success: false, error: `HTTP ${response.status}` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    const html = await response.text()

    const players = parseSearchResults(html)

    console.log('Found', players.length, 'players for:', playerName)

    return new Response(
      JSON.stringify({ success: true, players }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ success: false, error: 'Proxy error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})

interface TransfermarktPlayer {
  name: string
  profileUrl: string
  currentClub?: string
}

// Erweitertes Interface mit allen Profildaten (für optimierte Suche)
interface TransfermarktPlayerFull extends TransfermarktPlayer {
  agentName?: string | null
  agentCompany?: string | null
  hasAgent?: boolean
  birthDate?: string | null
}

interface AgentInfo {
  agentName: string | null
  agentCompany: string | null
  agentUrl: string | null
  birthDate: string | null  // Format: "DD.MM.YYYY" oder "YYYY-MM-DD"
}

// ============================================================================
// HILFSFUNKTIONEN
// ============================================================================

/**
 * Normalisiert Namen für Vergleiche (Kleinschreibung, ohne Sonderzeichen)
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Entferne Akzente
    .replace(/[^a-z0-9\s]/g, '')     // Nur Buchstaben, Zahlen, Leerzeichen
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Findet den besten Spieler-Match basierend auf Name und Verein
 */
function findBestPlayerMatch(
  players: TransfermarktPlayer[],
  searchName: string,
  clubHint?: string
): TransfermarktPlayer | null {
  if (players.length === 0) return null

  const normalizedSearchName = normalizeName(searchName)
  const nameParts = normalizedSearchName.split(' ')

  let bestMatch: TransfermarktPlayer | null = null
  let bestScore = 0
  let bestHasClubMatch = false

  for (const player of players) {
    const normalizedPlayerName = normalizeName(player.name)
    let score = 0
    let hasClubMatch = false

    // Exakter Name-Match
    if (normalizedPlayerName === normalizedSearchName) {
      score = 100
    } else {
      // Teilweise Matches
      for (const part of nameParts) {
        if (part.length >= 3 && normalizedPlayerName.includes(part)) {
          score += 20
        }
      }

      // Nachname am Ende
      const lastName = nameParts[nameParts.length - 1]
      if (lastName && normalizedPlayerName.endsWith(lastName)) {
        score += 30
      }
    }

    // Verein-Match Bonus (stark gewichtet!)
    if (clubHint && player.currentClub) {
      const normalizedClub = normalizeName(clubHint)
      const normalizedPlayerClub = normalizeName(player.currentClub)

      // Exakter Verein-Match
      if (normalizedPlayerClub === normalizedClub) {
        score += 200
        hasClubMatch = true
      } else {
        // Keyword-basierter Match: >50% der Keywords (Länge>2)
        const clubKeywords = normalizedClub.split(' ').filter(w => w.length > 2)
        const matchingKeywords = clubKeywords.filter(kw => normalizedPlayerClub.includes(kw))
        if (clubKeywords.length > 0 && matchingKeywords.length >= Math.ceil(clubKeywords.length * 0.5)) {
          score += 100
          hasClubMatch = true
        }
      }
    }

    if (score > bestScore) {
      bestScore = score
      bestMatch = player
      bestHasClubMatch = hasClubMatch
    }
  }

  // STRIKT: Wenn clubHint vorhanden, MUSS der Club matchen.
  // Lieber kein Ergebnis als falscher Spieler von anderem Verein.
  if (clubHint && bestMatch && !bestHasClubMatch) {
    console.log(`Rejecting "${bestMatch.name}" (club: ${bestMatch.currentClub || '?'}) - doesn't match "${clubHint}"`)
    return null
  }

  return bestMatch
}

// ============================================================================
// BERATER-INFO ABRUFEN
// ============================================================================

/**
 * Holt Berater-Informationen und Geburtsdatum von einer Spieler-Profilseite.
 */
async function fetchAgentFromProfile(profileUrl: string): Promise<AgentInfo> {
  try {
    // Stelle sicher, dass die URL vollständig ist
    const fullUrl = profileUrl.startsWith('http') ? profileUrl : `https://www.transfermarkt.de${profileUrl}`

    console.log('Fetching profile:', fullUrl)

    const response = await fetchWithRetry(fullUrl, {
      method: 'GET',
    })

    if (!response.ok) {
      console.error('Profile fetch failed:', response.status)
      return { agentName: null, agentCompany: null, agentUrl: null, birthDate: null }
    }

    const html = await response.text()

    // ========== GEBURTSDATUM EXTRAHIEREN ==========
    let birthDate: string | null = null

    // Direkt nach Datum im Format DD.MM.YYYY suchen (irgendwo in der Nähe von "Geb" oder "birth")
    // Transfermarkt zeigt das Datum oft als: "27.09.1993 (31)" oder ähnlich
    // WICHTIG: Negative lookbehind (?<![a-zA-Z]) verhindert Match von "Erzgebirge" etc.
    const directDateMatch = html.match(/(?<![a-zA-Z])(?:Geb\.|Geb\/|Geburtsdatum|birth|geboren)[^>]*>?\s*[^<]*?(\d{1,2}\.\d{1,2}\.\d{4})/i)
    if (directDateMatch) {
      const dateMatch = directDateMatch[1].match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/)
      if (dateMatch) {
        birthDate = `${dateMatch[1].padStart(2, '0')}.${dateMatch[2].padStart(2, '0')}.${dateMatch[3]}`
        console.log('Found birth date (direct):', birthDate)
      }
    }

    // Fallback: Suche nach Datum mit Alter in Klammern, z.B. "27.09.1993 (31)"
    // Auch wenn das Datum in einem Link ist: <a href="...">28.09.2007</a> (18)
    if (!birthDate) {
      // Zuerst: Datum in Link mit Alter (häufigster Fall auf TM)
      // Pattern 1: Alter INNERHALB des Links: <a>25.01.1998 (28)</a>
      const dateInLinkMatch = html.match(/<a[^>]*>(\d{1,2}\.\d{1,2}\.\d{4})\s*\(\d{1,2}\)<\/a>/)
      if (dateInLinkMatch) {
        const dateMatch = dateInLinkMatch[1].match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/)
        if (dateMatch) {
          birthDate = `${dateMatch[1].padStart(2, '0')}.${dateMatch[2].padStart(2, '0')}.${dateMatch[3]}`
          console.log('Found birth date (link with age):', birthDate)
        }
      }
    }

    if (!birthDate) {
      const dateWithAgeMatch = html.match(/(\d{1,2}\.\d{1,2}\.\d{4})\s*\(\d{1,2}\)/)
      if (dateWithAgeMatch) {
        const dateMatch = dateWithAgeMatch[1].match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/)
        if (dateMatch) {
          birthDate = `${dateMatch[1].padStart(2, '0')}.${dateMatch[2].padStart(2, '0')}.${dateMatch[3]}`
          console.log('Found birth date (with age):', birthDate)
        }
      }
    }

    // Weitere Fallback-Patterns - ERWEITERT für verschiedene TM-Layouts
    if (!birthDate) {
      const birthDatePatterns = [
        // Pattern 1: Info-Tabelle mit class
        /Geb\.\s*\/\s*Alter:<\/span>\s*<span[^>]*>([^<(]+)/i,
        // Pattern 2: Einfaches Label
        /Geburtsdatum:<\/span>\s*<span[^>]*class="[^"]*info-table__content[^"]*"[^>]*>([^<(]+)/i,
        // Pattern 3: Ohne class aber mit span
        /Geburtsdatum:<\/span>\s*<span[^>]*>([^<(]+)/i,
        // Pattern 4: data-header Attribut
        /data-header="Geburtsdatum"[^>]*>([^<(]+)/i,
        // Pattern 5: itemprop birthDate
        /itemprop="birthDate"[^>]*content="(\d{4}-\d{2}-\d{2})"/i,
        // Pattern 6: data-header__content mit Datum (neues TM-Layout)
        /class="data-header__content[^"]*"[^>]*>[^<]*?(\d{1,2}\.\d{1,2}\.\d{4})/i,
        // Pattern 7: JSON-LD Schema birthDate
        /"birthDate"\s*:\s*"(\d{4}-\d{2}-\d{2})"/,
        // Pattern 8: Span mit birth-Klasse
        /<span[^>]*class="[^"]*birth[^"]*"[^>]*>([^<]*\d{1,2}\.\d{1,2}\.\d{4})/i,
        // Pattern 9: Datum nach "geboren am" oder "born"
        /(?:geboren\s*(?:am)?|born)[:\s]*(\d{1,2}\.\d{1,2}\.\d{4})/i,
        // Pattern 10: Datum in info-table__content (breiter Match)
        /class="info-table__content[^"]*"[^>]*>[\s\n]*(\d{1,2}\.\d{1,2}\.\d{4})/i,
        // Pattern 11: Datum nach Zeilenumbruch in span
        /<span[^>]*>[\s\n]*(\d{1,2}\.\d{1,2}\.\d{4})[\s\n]*\(/i,
      ]

      for (const pattern of birthDatePatterns) {
        const match = html.match(pattern)
        if (match) {
          const dateStr = match[1].trim()
          // Format DD.MM.YYYY
          let dateMatch = dateStr.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/)
          if (dateMatch) {
            birthDate = `${dateMatch[1].padStart(2, '0')}.${dateMatch[2].padStart(2, '0')}.${dateMatch[3]}`
            console.log('Found birth date (pattern):', birthDate)
            break
          }
          // Format YYYY-MM-DD (ISO)
          dateMatch = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/)
          if (dateMatch) {
            birthDate = `${dateMatch[3]}.${dateMatch[2]}.${dateMatch[1]}`
            console.log('Found birth date (ISO):', birthDate)
            break
          }
        }
      }
    }

    console.log('Final birth date result:', birthDate)

    // ========== BERATER-INFO EXTRAHIEREN ==========
    // Suche nach Spielerberater-Eintrag
    // Pattern 1: Mit Link: <span>Spielerberater:</span> <span><a href="...">Agent Name</a></span>
    // Pattern 2: Ohne Link: <span>Spielerberater:</span> <span>Text wie "Familienangehörige" oder "-"</span>

    // Erweiterte Suche für den Spielerberater-Bereich
    const agentSectionPattern = /Spielerberater:<\/span>\s*<span[^>]*class="[^"]*info-table__content--bold[^"]*"[^>]*>([\s\S]*?)<\/span>/i
    const sectionMatch = html.match(agentSectionPattern)

    if (sectionMatch) {
      const agentSection = sectionMatch[1].trim()

      // Prüfe ob ein Link vorhanden ist (echter Berater/Agentur)
      const linkMatch = agentSection.match(/<a[^>]*href="([^"]*)"[^>]*>([^<]+)<\/a>/i)

      if (linkMatch) {
        const agentUrl = `https://www.transfermarkt.de${linkMatch[1]}`
        const agentName = linkMatch[2].trim()

        console.log('Found agent with link:', agentName, agentUrl)
        return {
          agentName,
          agentCompany: agentName,
          agentUrl,
          birthDate,
        }
      }

      // Kein Link - prüfe den Textinhalt (z.B. "Familienangehörige", "-", etc.)
      const textContent = agentSection.replace(/<[^>]*>/g, '').trim()

      if (textContent && textContent !== '-' && textContent !== '---') {
        // Es gibt einen Eintrag wie "Familienangehörige"
        console.log('Found agent text (no link):', textContent)
        return {
          agentName: textContent,
          agentCompany: null,
          agentUrl: null,
          birthDate,
        }
      }

      // Eintrag ist leer oder "-" = kein Berater
      console.log('Agent field exists but empty or dash')
      return { agentName: 'kein Beratereintrag', agentCompany: null, agentUrl: null, birthDate }
    }

    // Spielerberater-Feld nicht auf der Seite gefunden
    console.log('No agent field found in profile')
    return { agentName: 'kein Beratereintrag', agentCompany: null, agentUrl: null, birthDate }

  } catch (error) {
    console.error('Error fetching agent info:', error)
    return { agentName: null, agentCompany: null, agentUrl: null, birthDate: null }
  }
}

// ============================================================================
// VEREINS-BASIERTE SUCHE
// ============================================================================

/**
 * Sucht einen Spieler über den Vereinskader.
 * 1. Suche den Verein auf Transfermarkt
 * 2. Hole die Kaderseite
 * 3. Finde den Spieler im Kader
 */
async function searchViaClubSquad(playerName: string, clubHint: string): Promise<TransfermarktPlayer | null> {
  try {
    // Schritt 1: Verein suchen
    const clubSearchUrl = `https://www.transfermarkt.de/schnellsuche/ergebnis/schnellsuche?query=${encodeURIComponent(clubHint)}&Verein_Verein=Verein`

    console.log('Searching for club:', clubHint)

    const clubResponse = await fetchWithRetry(clubSearchUrl, {
      method: 'GET',
    })

    if (!clubResponse.ok) {
      console.error('Club search failed:', clubResponse.status)
      return null
    }

    const clubHtml = await clubResponse.text()

    // Finde Vereins-URL (z.B. /sc-fortuna-koln/startseite/verein/92)
    const clubUrlMatch = clubHtml.match(/href="([^"]*\/startseite\/verein\/(\d+))"/i)
    if (!clubUrlMatch) {
      console.log('No club found for:', clubHint)
      return null
    }

    const clubId = clubUrlMatch[2]
    console.log('Found club ID:', clubId)

    // Schritt 2: Kaderseite holen
    const squadUrl = `https://www.transfermarkt.de/verein/kader/verein/${clubId}`

    const squadResponse = await fetchWithRetry(squadUrl, {
      method: 'GET',
    })

    if (!squadResponse.ok) {
      console.error('Squad fetch failed:', squadResponse.status)
      return null
    }

    const squadHtml = await squadResponse.text()

    // Schritt 3: Spieler im Kader finden
    const player = findPlayerInSquad(squadHtml, playerName, clubHint)

    if (player) {
      console.log('Found player via club squad:', player.name, player.profileUrl)
    } else {
      console.log('Player not found in club squad:', playerName)
    }

    return player

  } catch (error) {
    console.error('Error in club squad search:', error)
    return null
  }
}

/**
 * OPTIMIERTE SUCHE: Findet Spieler im Vereinskader UND holt direkt alle Profildaten.
 * Spart einen separaten Request für Berater-Info!
 */
async function searchViaClubSquadWithFullInfo(playerName: string, clubHint: string): Promise<TransfermarktPlayerFull | null> {
  try {
    console.log('=== searchViaClubSquadWithFullInfo START ===')
    console.log('Player:', playerName, '| Club:', clubHint)

    // 2. Mannschaften haben verschiedene Bezeichnungen, auf Transfermarkt meist als "II"
    // NUR U23/U21 sind 2. Mannschaften! U19 und jünger sind Jugendteams.
    let searchClubHint = clubHint
    let isReserveTeam = false

    // Pattern für 2. Mannschaft-Bezeichnungen (NICHT Jugend!)
    const reserveTeamPatterns = [
      /(.+?)\s*U2[123]$/i,                    // U23, U22, U21 (2. Mannschaften)
      /(.+?)\s*II$/i,                         // bereits II
      /(.+?)\s*2$/i,                          // endet mit 2
      /(.+?)\s*2\.\s*Mannschaft$/i,           // "2. Mannschaft"
      /(.+?)\s*Reserve$/i,                    // "Reserve"
      /(.+?)\s*Amateure$/i,                   // "Amateure"
    ]

    for (const pattern of reserveTeamPatterns) {
      const match = clubHint.match(pattern)
      if (match) {
        // Ersetze mit "II" für Transfermarkt-Suche
        searchClubHint = match[1].trim() + ' II'
        isReserveTeam = true
        console.log('Reserve team detected:', clubHint, '-> searching for:', searchClubHint)
        break
      }
    }

    // Entferne Gründungsjahre aus Vereinsnamen (z.B. "VfL Bochum 1848" -> "VfL Bochum")
    // Typische Jahre: 1848, 1860, 1893, 1895, 1899, 1900, 1904, 1905, 1907, 1909, etc.
    searchClubHint = searchClubHint.replace(/\s*1[89]\d{2}\b/g, '').trim()

    // Entferne auch gängige Vereinspräfixe für kürzere Suche
    // z.B. "VfL Bochum II" -> "Bochum II", "1. FC Saarbrücken" -> "Saarbrücken"
    // Dies hilft bei Vereinen deren TM-Eintrag anders geschrieben ist
    const shortSearchHint = searchClubHint
      .replace(/^(VfL|VfB|FSV|TSV|SV|SC|FC|1\.\s*FC|SpVgg|Borussia|Eintracht|Fortuna|Arminia|Alemannia|Viktoria|Hertha|Union|Dynamo|Rot-Wei[sß])\s+/i, '')
      .trim()

    console.log('Club hint after cleanup:', searchClubHint, shortSearchHint !== searchClubHint ? `(short: ${shortSearchHint})` : '')

    // Jugendteams (U19, U17, U16, etc.) - behalte den Namen, TM hat diese als eigene "Vereine"
    // z.B. "FC Bayern München U19" existiert als eigener Eintrag auf TM

    // Schritt 1: Verein suchen - IMMER auch Kurzname versuchen falls verfügbar
    // z.B. "1. FC Saarbrücken" -> erst "1. FC Saarbrücken", dann "Saarbrücken"
    const searchQueries = shortSearchHint !== searchClubHint
      ? [searchClubHint, shortSearchHint]
      : [searchClubHint]

    let clubHtml = ''
    let successfulQuery = ''

    for (const query of searchQueries) {
      const clubSearchUrl = `https://www.transfermarkt.de/schnellsuche/ergebnis/schnellsuche?query=${encodeURIComponent(query)}&Verein_Verein=Verein`
      console.log('Optimized search - Step 1: Searching for club:', query)

      const clubResponse = await fetchWithRetry(clubSearchUrl, {
        method: 'GET',
      })

      if (clubResponse.ok) {
        clubHtml = await clubResponse.text()
        // Prüfe ob Ergebnisse gefunden wurden
        if (clubHtml.includes('/startseite/verein/')) {
          successfulQuery = query
          break
        }
      }
    }

    if (!successfulQuery) {
      console.error('Club search failed for all queries:', searchQueries.join(', '), '- Original clubHint:', clubHint)
      return null
    }

    console.log('Club search successful with query:', successfulQuery)

    // Finde Vereins-URL - VERBESSERT: Prüfe ob der gefundene Verein zum Hint passt
    // z.B. bei "Fortuna Köln" sollte "SC Fortuna Köln" gefunden werden, nicht "Fortuna Düsseldorf"
    const clubMatches = [...clubHtml.matchAll(/href="([^"]*\/startseite\/verein\/(\d+))"[^>]*>([^<]*)</gi)]

    let bestClubMatch: { url: string; id: string; name: string } | null = null
    const normalizedHint = normalizeName(successfulQuery)

    for (const match of clubMatches) {
      const clubUrl = match[1]
      const clubId = match[2]
      // Extrahiere Vereinsname aus URL-Slug
      const urlSlug = clubUrl.split('/')[1] || ''
      const clubNameFromUrl = urlSlug.replace(/-/g, ' ')

      // Prüfe ob der Vereinsname zum Hint passt
      const normalizedClubName = normalizeName(clubNameFromUrl)

      // Für 2. Mannschaften: Prüfe ob "ii" im Namen vorkommt
      if (isReserveTeam && normalizedClubName.includes(' ii')) {
        bestClubMatch = { url: clubUrl, id: clubId, name: clubNameFromUrl }
        console.log('Found reserve team club:', clubNameFromUrl, '(ID:', clubId, ')')
        break
      }

      // Exakter Match oder enthält alle wichtigen Teile des Hints
      const hintParts = normalizedHint.split(' ').filter(p => p.length > 2)
      const matchingParts = hintParts.filter(part => normalizedClubName.includes(part))

      if (matchingParts.length >= Math.ceil(hintParts.length * 0.6)) {
        bestClubMatch = { url: clubUrl, id: clubId, name: clubNameFromUrl }
        console.log('Found matching club:', clubNameFromUrl, '(ID:', clubId, ')')
        break
      }
    }

    if (!bestClubMatch) {
      // Fallback: Nimm den ersten Treffer
      const fallbackMatch = clubHtml.match(/href="([^"]*\/startseite\/verein\/(\d+))"/i)
      if (fallbackMatch) {
        bestClubMatch = { url: fallbackMatch[1], id: fallbackMatch[2], name: 'unknown' }
        console.log('Using fallback club ID:', bestClubMatch.id)
      } else {
        console.log('No club found for:', clubHint)
        return null
      }
    }

    // Schritt 2: Kaderseite holen
    const squadUrl = `https://www.transfermarkt.de/verein/kader/verein/${bestClubMatch.id}`
    console.log('Optimized search - Step 2: Fetching squad from:', squadUrl)

    const squadResponse = await fetchWithRetry(squadUrl, {
      method: 'GET',
    })

    if (!squadResponse.ok) {
      console.error('Squad fetch failed:', squadResponse.status)
      return null
    }

    const squadHtml = await squadResponse.text()

    // Schritt 3: Spieler im Kader finden
    let player = findPlayerInSquad(squadHtml, playerName, clubHint)

    // Schritt 4: Fallback - normale Spielersuche mit Vereins-Filter
    if (!player) {
      console.log('Player not in squad, trying normal search with club filter...')

      const searchUrl = `https://www.transfermarkt.de/schnellsuche/ergebnis/schnellsuche?query=${encodeURIComponent(playerName)}&Spieler_Spieler=Spieler`
      const searchResponse = await fetchWithRetry(searchUrl)
      const searchHtml = await searchResponse.text()
      const searchResults = parseSearchResults(searchHtml)

      // Finde Spieler dessen Verein zum clubHint passt (inkl. U19, U17, etc.)
      const normalizedHint = normalizeName(clubHint)
      const hintKeywords = normalizedHint.split(' ').filter(w => w.length > 2)
      const matchingPlayer = searchResults.find(p => {
        if (!p.currentClub) return false
        const normalizedClub = normalizeName(p.currentClub)
        // Exakter Substring-Match
        if (normalizedClub.includes(normalizedHint) || normalizedHint.includes(normalizedClub)) return true
        // Keyword-Match: >50% der Keywords müssen übereinstimmen
        if (hintKeywords.length > 0) {
          const matchingKw = hintKeywords.filter(kw => normalizedClub.includes(kw))
          return matchingKw.length >= Math.ceil(hintKeywords.length * 0.5)
        }
        return false
      })

      if (matchingPlayer) {
        player = matchingPlayer
        console.log('Found player via fallback search:', player.name, player.currentClub)
      }
    }

    if (!player) {
      console.log('Player not found in club squad or fallback search:', playerName)
      return null
    }

    console.log('Optimized search - Step 3/4: Found player, fetching profile:', player.profileUrl)

    // Schritt 4: Profilseite holen und alle Daten extrahieren
    const agentInfo = await fetchAgentFromProfile(player.profileUrl)

    const fullPlayer: TransfermarktPlayerFull = {
      name: player.name,
      profileUrl: player.profileUrl,
      currentClub: player.currentClub || clubHint,
      agentName: agentInfo.agentName,
      agentCompany: agentInfo.agentCompany,
      hasAgent: !!(agentInfo.agentName && agentInfo.agentName !== 'kein Beratereintrag'),
      birthDate: agentInfo.birthDate,
    }

    console.log('Optimized search complete:', fullPlayer.name, '- Agent:', fullPlayer.agentName, '- Birth:', fullPlayer.birthDate)

    return fullPlayer

  } catch (error) {
    console.error('Error in optimized club squad search:', error)
    return null
  }
}

/**
 * Findet einen Spieler in der Kader-HTML-Seite.
 */
function findPlayerInSquad(html: string, searchName: string, clubName: string): TransfermarktPlayer | null {
  const normalizedSearch = normalizeName(searchName)
  const searchParts = normalizedSearch.split(' ')

  let bestMatch: TransfermarktPlayer | null = null
  let bestScore = 0

  // Pattern: Finde alle Spieler-Profile-Links (href enthält /profil/spieler/)
  // Auf Kaderseiten haben Links oft kein title-Attribut, daher extrahieren wir den Namen aus der URL
  const urlPattern = /href="(\/([^\/]+)\/profil\/spieler\/(\d+))"/gi

  const seenUrls = new Set<string>()

  for (const match of html.matchAll(urlPattern)) {
    const relativeUrl = match[1]
    const urlSlug = match[2]

    if (seenUrls.has(relativeUrl)) continue
    seenUrls.add(relativeUrl)

    // Extrahiere Namen aus URL-Slug (z.B. "rafael-garcia" -> "rafael garcia")
    const nameFromUrl = urlSlug.replace(/-/g, ' ')

    const score = calculateNameMatchScore(nameFromUrl, searchParts, normalizedSearch)

    if (score > bestScore) {
      bestScore = score
      // Kapitalisiere den Namen für bessere Darstellung
      const formattedName = nameFromUrl.split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')

      bestMatch = {
        name: formattedName,
        profileUrl: `https://www.transfermarkt.de${relativeUrl}`,
        currentClub: clubName,
      }
    }
  }

  console.log(`Squad search: best score ${bestScore} for "${searchName}"${bestMatch ? ` -> ${bestMatch.name}` : ''}`)

  // Nur zurückgeben wenn ein guter Match gefunden wurde (mindestens 50 Punkte)
  return bestScore >= 50 ? bestMatch : null
}

/**
 * Berechnet einen Score für die Namensübereinstimmung.
 */
function calculateNameMatchScore(playerName: string, searchParts: string[], normalizedSearch: string): number {
  const normalizedPlayer = normalizeName(playerName)

  // Exakter Match
  if (normalizedPlayer === normalizedSearch) return 100

  let score = 0

  // Teilweise Matches
  for (const part of searchParts) {
    if (part.length >= 3 && normalizedPlayer.includes(part)) {
      score += 25
    }
  }

  // Nachname am Ende
  const lastName = searchParts[searchParts.length - 1]
  if (lastName && normalizedPlayer.endsWith(lastName)) {
    score += 30
  }

  return score
}

// ============================================================================
// NORMALE SPIELER-SUCHE
// ============================================================================

function parseSearchResults(html: string): TransfermarktPlayer[] {
  const players: TransfermarktPlayer[] = []
  const seenUrls = new Set<string>()

  // Suche nach Spieler-Links im HTML (title kann vor oder nach href sein)
  // Pattern 1: title vor href
  const pattern1 = /<a[^>]*title="([^"]*)"[^>]*href="([^"]*\/profil\/spieler\/\d+)"[^>]*>/gi
  // Pattern 2: href vor title
  const pattern2 = /<a[^>]*href="([^"]*\/profil\/spieler\/\d+)"[^>]*title="([^"]*)"[^>]*>/gi

  // Pattern 1: title vor href
  for (const match of html.matchAll(pattern1)) {
    const name = match[1]
    const relativeUrl = match[2]

    const profileUrl = relativeUrl.startsWith('http')
      ? relativeUrl
      : `https://www.transfermarkt.de${relativeUrl}`

    if (seenUrls.has(profileUrl)) continue
    seenUrls.add(profileUrl)

    // Verein aus dem umgebenden HTML extrahieren (größerer Kontext: 1500 Zeichen)
    const linkPos = html.indexOf(match[0])
    const contextStart = Math.max(0, linkPos - 200)
    const contextEnd = Math.min(html.length, linkPos + 1500)
    const context = html.substring(contextStart, contextEnd)

    let currentClub: string | undefined
    // Versuche mehrere Patterns für den Verein (nur Links zu Vereinsseiten)
    // Pattern 1: Link mit title zu Verein
    let clubMatch = context.match(/<a[^>]*title="([^"]*)"[^>]*href="[^"]*\/(?:verein|startseite\/verein)\/\d+[^"]*"/i)
    if (!clubMatch) {
      // Pattern 2: Link mit href vor title
      clubMatch = context.match(/<a[^>]*href="[^"]*\/(?:verein|startseite\/verein)\/\d+[^"]*"[^>]*title="([^"]*)"/i)
    }

    if (clubMatch) {
      currentClub = decodeHtmlEntities(clubMatch[1].trim())
      // Ignoriere leere oder "---" Vereine
      if (currentClub === '---' || currentClub === '') {
        currentClub = undefined
      }
    }

    players.push({
      name: decodeHtmlEntities(name),
      profileUrl,
      currentClub,
    })

    if (players.length >= 25) break
  }

  // Pattern 2: href vor title (falls noch nicht genug gefunden)
  if (players.length < 10) {
    for (const match of html.matchAll(pattern2)) {
      const relativeUrl = match[1]
      const name = match[2]

      const profileUrl = relativeUrl.startsWith('http')
        ? relativeUrl
        : `https://www.transfermarkt.de${relativeUrl}`

      if (seenUrls.has(profileUrl)) continue
      seenUrls.add(profileUrl)

      // Auch hier Verein extrahieren
      const linkPos = html.indexOf(match[0])
      const contextStart = Math.max(0, linkPos - 200)
      const contextEnd = Math.min(html.length, linkPos + 1500)
      const context = html.substring(contextStart, contextEnd)

      let currentClub: string | undefined
      let clubMatch = context.match(/<a[^>]*title="([^"]*)"[^>]*href="[^"]*\/(?:verein|startseite\/verein)\/\d+[^"]*"/i)
      if (!clubMatch) {
        clubMatch = context.match(/<a[^>]*href="[^"]*\/(?:verein|startseite\/verein)\/\d+[^"]*"[^>]*title="([^"]*)"/i)
      }
      if (clubMatch) {
        currentClub = decodeHtmlEntities(clubMatch[1].trim())
        if (currentClub === '---' || currentClub === '') {
          currentClub = undefined
        }
      }

      players.push({
        name: decodeHtmlEntities(name),
        profileUrl,
        currentClub,
      })

      if (players.length >= 25) break
    }
  }

  return players
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
}
