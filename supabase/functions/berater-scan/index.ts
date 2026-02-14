// Supabase Edge Function: Berater-Scan
// Scannt Transfermarkt-Profile für Beraterstatus-Änderungen
// Aktionen: bootstrap_clubs, scan_club, scan_next_batch, get_status

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ============================================================================
// KONFIGURATION
// ============================================================================

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
]

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
}

function getBrowserHeaders(): Record<string, string> {
  return {
    'User-Agent': getRandomUserAgent(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Delay zwischen Profil-Requests: 2-3s + ±0.5s Jitter
function getRequestDelay(): number {
  const base = 2000 + Math.random() * 1000 // 2000-3000ms
  const jitter = (Math.random() - 0.5) * 1000 // ±500ms
  return Math.max(1500, base + jitter)
}

// Delay zwischen Vereinen: 5-10s
function getClubDelay(): number {
  return 5000 + Math.random() * 5000
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ============================================================================
// SUPABASE CLIENT
// ============================================================================

function getSupabaseClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
}

// ============================================================================
// TYPES
// ============================================================================

interface AgentInfo {
  agentName: string | null
  agentCompany: string | null
  birthDate: string | null
  isRetired: boolean
  currentClubName: string | null
  marketValue: string | null
}

interface SquadPlayer {
  name: string
  tmPlayerId: string
  profileUrl: string
  position?: string
}

// ============================================================================
// HTML PARSING - Berater-Info von Profilseite
// ============================================================================

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

async function fetchWithRetry(url: string, maxRetries = 3): Promise<Response | null> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: getBrowserHeaders(),
      })

      if (response.status === 429) {
        const backoff = Math.pow(2, attempt) * 5000 // 5s, 10s, 20s
        console.log(`Rate limited (429), backing off ${backoff}ms...`)
        await sleep(backoff)
        continue
      }

      if (response.status === 403) {
        console.log(`Blocked (403) for ${url}, backing off...`)
        await sleep(10000)
        continue
      }

      return response
    } catch (error) {
      console.error(`Fetch attempt ${attempt + 1} failed for ${url}:`, error)
      if (attempt < maxRetries - 1) {
        await sleep(3000)
      }
    }
  }
  return null
}

/**
 * Extrahiert Berater-Info und Geburtsdatum von einer TM-Profilseite.
 * (Kopiert aus transfermarkt-proxy/index.ts)
 */
async function fetchAgentFromProfile(profileUrl: string): Promise<AgentInfo> {
  try {
    const fullUrl = profileUrl.startsWith('http') ? profileUrl : `https://www.transfermarkt.de${profileUrl}`
    const response = await fetchWithRetry(fullUrl)

    if (!response || !response.ok) {
      console.error('Profile fetch failed for:', fullUrl)
      return { agentName: null, agentCompany: null, birthDate: null, isRetired: false, currentClubName: null, marketValue: null }
    }

    const html = await response.text()

    // ========== AKTUELLER VEREIN ERKENNEN ==========
    let currentClubName: string | null = null
    const clubHeaderMatch = html.match(/Aktueller Verein:[\s\S]*?<a[^>]*>([^<]+)<\/a>/i)
      || html.match(/class="data-header__club"[^>]*>[\s\S]*?<a[^>]*title="([^"]+)"/i)
      || html.match(/class="data-header__club"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i)
    if (clubHeaderMatch) {
      const club = clubHeaderMatch[1].trim()
      if (club && !/ohne verein|vereinslos|career break|retired|karriereende/i.test(club)) {
        currentClubName = club
      }
    }

    // ========== KARRIEREENDE ERKENNEN ==========
    // Nur das spezifische Header-Label matchen (nicht "Karriereende" irgendwo auf der Seite,
    // z.B. im Verwandte-Abschnitt oder in der Transferhistorie)
    // Zusätzlich: Wenn ein aktueller Verein gefunden wurde, kann es kein Karriereende sein
    const isRetired = !currentClubName && /class="data-header__label"[^>]*>\s*Karriereende\s*seit:/i.test(html)

    // ========== MARKTWERT EXTRAHIEREN ==========
    let marketValue: string | null = null

    // Pattern 1: data-header market value wrapper
    const mvWrapperMatch = html.match(/class="data-header__market-value-wrapper"[^>]*>[\s\S]*?<\/a>/i)
    if (mvWrapperMatch) {
      const mvText = mvWrapperMatch[0].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
      const valueMatch = mvText.match(/(\d[\d.,]*\s*(?:Mio|Tsd|Mrd)\.\s*(?:€|EUR))/i)
      if (valueMatch) {
        marketValue = valueMatch[1].replace(/EUR/i, '€').trim()
      }
    }

    // Pattern 2: market value development element
    if (!marketValue) {
      const mvDevMatch = html.match(/class="tm-player-market-value-development__current-value"[^>]*>([^<]+)/i)
      if (mvDevMatch) {
        const valueMatch = mvDevMatch[1].trim().match(/(\d[\d.,]*\s*(?:Mio|Tsd|Mrd)\.\s*(?:€|EUR))/i)
        if (valueMatch) {
          marketValue = valueMatch[1].replace(/EUR/i, '€').trim()
        }
      }
    }

    // Pattern 3: Fallback — any value near "Marktwert"
    if (!marketValue) {
      const mvGenericMatch = html.match(/Marktwert[\s\S]{0,200}?(\d[\d.,]*\s*(?:Mio|Tsd|Mrd)\.\s*(?:€|EUR))/i)
      if (mvGenericMatch) {
        marketValue = mvGenericMatch[1].replace(/EUR/i, '€').trim()
      }
    }

    // ========== GEBURTSDATUM EXTRAHIEREN ==========
    let birthDate: string | null = null

    const directDateMatch = html.match(/(?<![a-zA-Z])(?:Geb\.|Geb\/|Geburtsdatum|birth|geboren)[^>]*>?\s*[^<]*?(\d{1,2}\.\d{1,2}\.\d{4})/i)
    if (directDateMatch) {
      const dateMatch = directDateMatch[1].match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/)
      if (dateMatch) {
        birthDate = `${dateMatch[1].padStart(2, '0')}.${dateMatch[2].padStart(2, '0')}.${dateMatch[3]}`
      }
    }

    if (!birthDate) {
      const dateInLinkMatch = html.match(/<a[^>]*>(\d{1,2}\.\d{1,2}\.\d{4})\s*\(\d{1,2}\)<\/a>/)
      if (dateInLinkMatch) {
        const dateMatch = dateInLinkMatch[1].match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/)
        if (dateMatch) {
          birthDate = `${dateMatch[1].padStart(2, '0')}.${dateMatch[2].padStart(2, '0')}.${dateMatch[3]}`
        }
      }
    }

    if (!birthDate) {
      const dateWithAgeMatch = html.match(/(\d{1,2}\.\d{1,2}\.\d{4})\s*\(\d{1,2}\)/)
      if (dateWithAgeMatch) {
        const dateMatch = dateWithAgeMatch[1].match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/)
        if (dateMatch) {
          birthDate = `${dateMatch[1].padStart(2, '0')}.${dateMatch[2].padStart(2, '0')}.${dateMatch[3]}`
        }
      }
    }

    if (!birthDate) {
      const birthDatePatterns = [
        /Geb\.\s*\/\s*Alter:<\/span>\s*<span[^>]*>([^<(]+)/i,
        /Geburtsdatum:<\/span>\s*<span[^>]*class="[^"]*info-table__content[^"]*"[^>]*>([^<(]+)/i,
        /Geburtsdatum:<\/span>\s*<span[^>]*>([^<(]+)/i,
        /data-header="Geburtsdatum"[^>]*>([^<(]+)/i,
        /itemprop="birthDate"[^>]*content="(\d{4}-\d{2}-\d{2})"/i,
        /class="data-header__content[^"]*"[^>]*>[^<]*?(\d{1,2}\.\d{1,2}\.\d{4})/i,
        /"birthDate"\s*:\s*"(\d{4}-\d{2}-\d{2})"/,
        /<span[^>]*class="[^"]*birth[^"]*"[^>]*>([^<]*\d{1,2}\.\d{1,2}\.\d{4})/i,
        /(?:geboren\s*(?:am)?|born)[:\s]*(\d{1,2}\.\d{1,2}\.\d{4})/i,
        /class="info-table__content[^"]*"[^>]*>[\s\n]*(\d{1,2}\.\d{1,2}\.\d{4})/i,
        /<span[^>]*>[\s\n]*(\d{1,2}\.\d{1,2}\.\d{4})[\s\n]*\(/i,
      ]

      for (const pattern of birthDatePatterns) {
        const match = html.match(pattern)
        if (match) {
          const dateStr = match[1].trim()
          let dateMatch = dateStr.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/)
          if (dateMatch) {
            birthDate = `${dateMatch[1].padStart(2, '0')}.${dateMatch[2].padStart(2, '0')}.${dateMatch[3]}`
            break
          }
          dateMatch = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/)
          if (dateMatch) {
            birthDate = `${dateMatch[3]}.${dateMatch[2]}.${dateMatch[1]}`
            break
          }
        }
      }
    }

    // ========== BERATER-INFO EXTRAHIEREN ==========

    // Helper: Extracts agent name from matched HTML section
    function extractAgentFromSection(sectionHtml: string): { agentName: string; agentCompany: string | null } | null {
      const linkMatch = sectionHtml.match(/<a[^>]*href="([^"]*)"[^>]*>([^<]+)<\/a>/i)
      if (linkMatch) {
        const agentName = linkMatch[2].trim()
        if (agentName) return { agentName, agentCompany: agentName }
      }
      const textContent = sectionHtml.replace(/<[^>]*>/g, '').trim()
      if (textContent && textContent !== '-' && textContent !== '---') {
        return { agentName: textContent, agentCompany: null }
      }
      return null
    }

    // Pattern 1: Info-Table (primary, existing pattern)
    const pattern1 = /Spielerberater:<\/span>\s*<span[^>]*class="[^"]*info-table__content--bold[^"]*"[^>]*>([\s\S]*?)<\/span>/i
    const match1 = html.match(pattern1)
    if (match1) {
      const result = extractAgentFromSection(match1[1])
      if (result) return { ...result, birthDate, isRetired, currentClubName, marketValue }
    }

    // Pattern 2: Header area (data-header)
    const pattern2 = /class="data-header__label"[^>]*>\s*Berater:\s*<span[^>]*class="[^"]*data-header__content[^"]*"[^>]*>([\s\S]*?)<\/span>/i
    const match2 = html.match(pattern2)
    if (match2) {
      const result = extractAgentFromSection(match2[1])
      if (result) return { ...result, birthDate, isRetired, currentClubName, marketValue }
    }

    // Pattern 3: Generic agent firm link (beraterfirma)
    const pattern3 = /href="\/[^"]*\/beraterfirma\/berater\/\d+"[^>]*>([^<]+)<\/a>/i
    const match3 = html.match(pattern3)
    if (match3) {
      const agentName = match3[1].trim()
      if (agentName) return { agentName, agentCompany: agentName, birthDate, isRetired, currentClubName, marketValue }
    }

    // Validate page is a real TM profile before returning 'kein Beratereintrag'
    const isValidProfile = /data-header__headline-wrapper|class="[^"]*info-table/i.test(html)
    if (!isValidProfile) {
      console.log('Page does not appear to be a valid TM profile (captcha/error page?) - returning null')
      return { agentName: null, agentCompany: null, birthDate: null, isRetired: false, currentClubName: null, marketValue: null }
    }

    // All patterns tried on a valid profile page → genuinely no agent listed
    return { agentName: 'kein Beratereintrag', agentCompany: null, birthDate, isRetired, currentClubName, marketValue }
  } catch (error) {
    console.error('Error fetching agent info:', error)
    return { agentName: null, agentCompany: null, birthDate: null, isRetired: false, currentClubName: null, marketValue: null }
  }
}

// ============================================================================
// KADERSEITE PARSEN
// ============================================================================

/**
 * Extrahiert alle Spieler von einer TM-Kaderseite.
 */
function parseSquadPage(html: string): SquadPlayer[] {
  const players: SquadPlayer[] = []
  const seenIds = new Set<string>()

  // Pattern: Spieler-Profil-Links auf Kaderseiten
  // href="/spielername/profil/spieler/123456"
  const urlPattern = /href="\/([^\/]+)\/profil\/spieler\/(\d+)"/gi

  for (const match of html.matchAll(urlPattern)) {
    const urlSlug = match[1]
    const tmPlayerId = match[2]

    if (seenIds.has(tmPlayerId)) continue
    seenIds.add(tmPlayerId)

    // Name aus URL-Slug
    const nameFromUrl = urlSlug.replace(/-/g, ' ')
    const formattedName = nameFromUrl.split(' ')
      .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')

    const profileUrl = `https://www.transfermarkt.de/${urlSlug}/profil/spieler/${tmPlayerId}`

    players.push({
      name: formattedName,
      tmPlayerId,
      profileUrl,
    })
  }

  // Positionen extrahieren (optional, best-effort)
  // TM-Kaderseiten haben Positionen in eigenen Spalten
  // Wir versuchen sie aus den table rows zu extrahieren
  const positionPattern = /class="[^"]*inline-table[^"]*"[\s\S]*?\/profil\/spieler\/(\d+)[\s\S]*?<td[^>]*class="[^"]*pos[^"]*"[^>]*>([^<]+)/gi
  for (const match of html.matchAll(positionPattern)) {
    const playerId = match[1]
    const position = match[2].trim()
    const player = players.find(p => p.tmPlayerId === playerId)
    if (player && position) {
      player.position = position
    }
  }

  return players
}

/**
 * Extrahiert Vereins-Links von einer TM-Wettbewerbsseite.
 * Gibt Club-IDs und Namen zurück.
 */
function parseCompetitionPage(html: string): Array<{ tmClubId: string; clubName: string; squadUrl: string }> {
  const clubs: Array<{ tmClubId: string; clubName: string; squadUrl: string }> = []
  const seenIds = new Set<string>()

  // Pattern: Vereins-Links auf Wettbewerbsseiten
  // href="/fc-bayern-munchen/startseite/verein/27" oder /kader/verein/27
  const clubPattern = /href="\/([^\/]+)\/(?:startseite|kader)\/verein\/(\d+)(?:\/saison_id\/\d+)?"/gi

  for (const match of html.matchAll(clubPattern)) {
    const urlSlug = match[1]
    const tmClubId = match[2]

    if (seenIds.has(tmClubId)) continue
    seenIds.add(tmClubId)

    // Vereinsname aus URL-Slug (Backup, wird durch title-Attribut ersetzt wenn möglich)
    let clubName = urlSlug.replace(/-/g, ' ')
      .split(' ')
      .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')

    // Versuche besseren Namen aus title-Attribut zu finden
    const titlePattern = new RegExp(`title="([^"]+)"[^>]*href="/${urlSlug}/(?:startseite|kader)/verein/${tmClubId}`, 'i')
    const titleMatch = html.match(titlePattern)
    if (titleMatch) {
      clubName = decodeHtmlEntities(titleMatch[1])
    } else {
      // Alternativ: title nach href
      const titleAfterPattern = new RegExp(`href="/${urlSlug}/(?:startseite|kader)/verein/${tmClubId}[^"]*"[^>]*title="([^"]+)"`, 'i')
      const titleAfterMatch = html.match(titleAfterPattern)
      if (titleAfterMatch) {
        clubName = decodeHtmlEntities(titleAfterMatch[1])
      }
    }

    const squadUrl = `https://www.transfermarkt.de/${urlSlug}/kader/verein/${tmClubId}`

    clubs.push({ tmClubId, clubName, squadUrl })
  }

  return clubs
}

// ============================================================================
// NORMALISIERUNG
// ============================================================================

function normalizeAgentName(name: string | null | undefined): string | null {
  if (!name) return null
  const trimmed = name.trim()
  if (!trimmed || trimmed === '-' || trimmed === '---' || trimmed === 'kein Beratereintrag') {
    return null
  }
  return trimmed
}

function agentsAreDifferent(oldName: string | null, newName: string | null): boolean {
  const normalizedOld = normalizeAgentName(oldName)
  const normalizedNew = normalizeAgentName(newName)

  // Beide null/leer → kein Wechsel
  if (!normalizedOld && !normalizedNew) return false

  // Einer null, anderer nicht → Wechsel
  if (!normalizedOld || !normalizedNew) return true

  // Normalisierter String-Vergleich
  return normalizedOld.toLowerCase() !== normalizedNew.toLowerCase()
}

// ============================================================================
// AKTION: bootstrap_clubs
// ============================================================================

async function bootstrapClubs(supabase: ReturnType<typeof createClient>): Promise<{ clubsAdded: number; clubsDeactivated: number; leagues: number }> {
  // Lade alle aktiven Ligen
  const { data: leagues, error: leagueError } = await supabase
    .from('berater_leagues')
    .select('*')
    .eq('is_active', true)

  if (leagueError || !leagues) {
    throw new Error(`Failed to load leagues: ${leagueError?.message}`)
  }

  console.log(`Bootstrapping clubs for ${leagues.length} active leagues...`)

  let totalAdded = 0
  let totalDeactivated = 0

  for (const league of leagues) {
    console.log(`Processing league: ${league.name} (${league.id})`)

    await sleep(getRequestDelay())

    const response = await fetchWithRetry(league.tm_competition_url)
    if (!response || !response.ok) {
      console.error(`Failed to fetch league page for ${league.id}: ${response?.status}`)
      continue
    }

    const html = await response.text()
    const foundClubs = parseCompetitionPage(html)

    console.log(`Found ${foundClubs.length} clubs in ${league.name}`)

    if (foundClubs.length === 0) {
      console.warn(`No clubs found for ${league.id} - skipping deactivation`)
      continue
    }

    const foundClubIds = new Set(foundClubs.map(c => c.tmClubId))

    // Upsert gefundene Vereine
    for (const club of foundClubs) {
      const { error } = await supabase
        .from('berater_clubs')
        .upsert({
          league_id: league.id,
          tm_club_id: club.tmClubId,
          club_name: club.clubName,
          tm_squad_url: club.squadUrl,
          is_active: true,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'tm_club_id' })

      if (error) {
        console.error(`Failed to upsert club ${club.clubName}:`, error.message)
      } else {
        totalAdded++
      }
    }

    // Vereine die nicht mehr in der Liga sind → deaktivieren (Abstieg)
    const { data: existingClubs } = await supabase
      .from('berater_clubs')
      .select('id, tm_club_id, club_name')
      .eq('league_id', league.id)
      .eq('is_active', true)

    if (existingClubs) {
      for (const existing of existingClubs) {
        if (!foundClubIds.has(existing.tm_club_id)) {
          console.log(`Deactivating club (not in league anymore): ${existing.club_name}`)
          await supabase
            .from('berater_clubs')
            .update({ is_active: false, updated_at: new Date().toISOString() })
            .eq('id', existing.id)
          totalDeactivated++
        }
      }
    }
  }

  // Update total_clubs in scan_state
  const { count } = await supabase
    .from('berater_clubs')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)

  await supabase
    .from('berater_scan_state')
    .update({ total_clubs: count || 0, updated_at: new Date().toISOString() })
    .eq('id', 1)

  return { clubsAdded: totalAdded, clubsDeactivated: totalDeactivated, leagues: leagues.length }
}

// ============================================================================
// AKTION: scan_club
// ============================================================================

async function scanClub(supabase: ReturnType<typeof createClient>, clubId: string): Promise<{
  playersScanned: number
  changesDetected: number
  newPlayers: number
  deactivated: number
  clubName: string
}> {
  // Club laden
  const { data: club, error: clubError } = await supabase
    .from('berater_clubs')
    .select('*')
    .eq('id', clubId)
    .single()

  if (clubError || !club) {
    throw new Error(`Club not found: ${clubId}`)
  }

  console.log(`Scanning club: ${club.club_name} (TM ID: ${club.tm_club_id})`)

  // Kaderseite laden
  const squadUrl = club.tm_squad_url || `https://www.transfermarkt.de/verein/kader/verein/${club.tm_club_id}`
  const response = await fetchWithRetry(squadUrl)

  if (!response || !response.ok) {
    throw new Error(`Failed to fetch squad page for ${club.club_name}: ${response?.status}`)
  }

  const html = await response.text()
  const squadPlayers = parseSquadPage(html)

  console.log(`Found ${squadPlayers.length} players in squad of ${club.club_name}`)

  let changesDetected = 0
  let newPlayers = 0
  const scannedPlayerIds = new Set<string>()

  // Pro Spieler: Profil laden, Berater extrahieren, vergleichen
  for (let i = 0; i < squadPlayers.length; i++) {
    const sp = squadPlayers[i]
    scannedPlayerIds.add(sp.tmPlayerId)

    console.log(`[${i + 1}/${squadPlayers.length}] Scanning: ${sp.name}`)

    // Delay zwischen Requests
    if (i > 0) {
      await sleep(getRequestDelay())
    }

    // Berater-Info holen
    const agentInfo = await fetchAgentFromProfile(sp.profileUrl)

    // Spieler existiert bereits in DB?
    const { data: existingPlayer } = await supabase
      .from('berater_players')
      .select('*')
      .eq('tm_player_id', sp.tmPlayerId)
      .maybeSingle()

    // Fix 1: Skip player if fetch/parse failed — don't treat as agent change
    if (agentInfo.agentName === null) {
      console.log(`SKIPPED ${sp.name}: fetch/parse failed, keeping existing data`)
      if (existingPlayer) {
        await supabase.from('berater_players').update({
          last_scanned_at: new Date().toISOString(),
        }).eq('id', existingPlayer.id)
      }
      continue
    }

    // Karriereende erkannt → Spieler deaktivieren
    if (agentInfo.isRetired) {
      console.log(`RETIRED ${sp.name}: Karriereende erkannt, deaktiviere Spieler`)
      if (existingPlayer) {
        await supabase.from('berater_players').update({
          is_active: false,
          last_scanned_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', existingPlayer.id)
      }
      continue
    }

    const hasAgent = !!(agentInfo.agentName && agentInfo.agentName !== 'kein Beratereintrag')
    const now = new Date().toISOString()

    if (existingPlayer) {
      // Spieler existiert → Update + Change-Detection
      const wasAlreadyScanned = !!existingPlayer.agent_updated_at

      // Prüfe auf Beraterwechsel (nur wenn vorher schon gescannt)
      if (wasAlreadyScanned && agentsAreDifferent(existingPlayer.current_agent_name, agentInfo.agentName)) {
        const oldHadRealAgent = !!normalizeAgentName(existingPlayer.current_agent_name)
        const newHasNoAgent = !normalizeAgentName(agentInfo.agentName)

        // Fix 3: Bestätigungslogik für Berater-Verlust
        // Wenn alter Berater vorhanden war und jetzt "kein Berater" gescannt wird:
        // Erst beim zweiten Scan bestätigen, um false-positives zu vermeiden
        if (oldHadRealAgent && newHasNoAgent && !existingPlayer.pending_agent_removal) {
          console.log(`PENDING REMOVAL for ${sp.name}: "${existingPlayer.current_agent_name}" → "${agentInfo.agentName}" (awaiting confirmation)`)
          await supabase.from('berater_players').update({
            pending_agent_removal: now,
            last_scanned_at: now,
            updated_at: now,
          }).eq('id', existingPlayer.id)
          continue
        }

        if (oldHadRealAgent && newHasNoAgent && existingPlayer.pending_agent_removal) {
          console.log(`CONFIRMED REMOVAL for ${sp.name}: "${existingPlayer.current_agent_name}" → "${agentInfo.agentName}" (pending since ${existingPlayer.pending_agent_removal})`)
        } else {
          console.log(`CHANGE DETECTED for ${sp.name}: "${existingPlayer.current_agent_name}" → "${agentInfo.agentName}"`)
        }

        // Change loggen
        const { data: leagueData } = await supabase
          .from('berater_clubs')
          .select('league_id')
          .eq('id', clubId)
          .single()

        await supabase
          .from('berater_changes')
          .insert({
            player_id: existingPlayer.id,
            previous_agent_name: existingPlayer.current_agent_name,
            previous_agent_company: existingPlayer.current_agent_company,
            new_agent_name: agentInfo.agentName,
            new_agent_company: agentInfo.agentCompany,
            player_name: sp.name,
            club_name: club.club_name,
            league_id: leagueData?.league_id || club.league_id,
            birth_date: agentInfo.birthDate || existingPlayer.birth_date,
            tm_profile_url: sp.profileUrl,
          })

        changesDetected++
      } else if (existingPlayer.pending_agent_removal) {
        // Agents stimmen wieder überein → false alarm, pending aufheben
        console.log(`FALSE ALARM for ${sp.name}: agent "${agentInfo.agentName}" confirmed, clearing pending removal`)
      }

      // Spieler updaten (inkl. club_id falls Vereinswechsel)
      const agentChanged = wasAlreadyScanned && agentsAreDifferent(existingPlayer.current_agent_name, agentInfo.agentName)
      const updateData: Record<string, any> = {
        club_id: clubId,
        player_name: sp.name,
        tm_profile_url: sp.profileUrl,
        birth_date: agentInfo.birthDate || existingPlayer.birth_date,
        position: sp.position || existingPlayer.position,
        current_agent_name: agentInfo.agentName,
        current_agent_company: agentInfo.agentCompany,
        market_value: agentInfo.marketValue,
        has_agent: hasAgent,
        agent_updated_at: now,
        last_scanned_at: now,
        is_active: true,
        is_vereinslos: false,
        updated_at: now,
        pending_agent_removal: null, // Clear pending on any successful update
      }
      // agent_since nur bei Beraterwechsel aktualisieren, NICHT bei jedem Scan
      if (agentChanged) {
        updateData.agent_since = now
      }
      await supabase
        .from('berater_players')
        .update(updateData)
        .eq('id', existingPlayer.id)
    } else {
      // Neuer Spieler → Insert
      await supabase
        .from('berater_players')
        .insert({
          club_id: clubId,
          player_name: sp.name,
          tm_player_id: sp.tmPlayerId,
          tm_profile_url: sp.profileUrl,
          birth_date: agentInfo.birthDate,
          position: sp.position,
          current_agent_name: agentInfo.agentName,
          current_agent_company: agentInfo.agentCompany,
        market_value: agentInfo.marketValue,
          has_agent: hasAgent,
          agent_updated_at: now,
          agent_since: now,
          last_scanned_at: now,
          is_active: true,
          is_vereinslos: false,
        })

      newPlayers++
    }
  }

  // Spieler die nicht mehr im Kader sind → als vereinslos markieren
  let deactivated = 0
  const { data: dbPlayers } = await supabase
    .from('berater_players')
    .select('id, tm_player_id, player_name')
    .eq('club_id', clubId)
    .eq('is_active', true)
    .eq('is_vereinslos', false)

  if (dbPlayers) {
    for (const dbPlayer of dbPlayers) {
      if (dbPlayer.tm_player_id && !scannedPlayerIds.has(dbPlayer.tm_player_id)) {
        console.log(`Player no longer in squad (vereinslos): ${dbPlayer.player_name}`)
        await supabase
          .from('berater_players')
          .update({ is_vereinslos: true, updated_at: new Date().toISOString() })
          .eq('id', dbPlayer.id)
        deactivated++
      }
    }
  }

  // Club-Metadaten updaten
  await supabase
    .from('berater_clubs')
    .update({
      player_count: squadPlayers.length,
      last_scanned_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', clubId)

  return {
    playersScanned: squadPlayers.length,
    changesDetected,
    newPlayers,
    deactivated,
    clubName: club.club_name,
  }
}

// ============================================================================
// AKTION: cleanup_vereinslose
// Prüft vereinslose Spieler ob sie wieder in einem Verein sind oder Karriereende haben
// ============================================================================

async function cleanupVereinslose(supabase: ReturnType<typeof createClient>, batchSize = 10): Promise<{
  checked: number
  reactivated: number
  retired: number
}> {
  // Vereinslose Spieler laden (älteste zuerst, die am längsten nicht gescannt wurden)
  const { data: vereinslose, error } = await supabase
    .from('berater_players')
    .select('id, player_name, tm_player_id, tm_profile_url, current_agent_name, current_agent_company, birth_date, position, club_id')
    .eq('is_active', true)
    .eq('is_vereinslos', true)
    .order('last_scanned_at', { ascending: true, nullsFirst: true })
    .limit(batchSize)

  if (error || !vereinslose || vereinslose.length === 0) {
    console.log('No vereinslose players to check')
    return { checked: 0, reactivated: 0, retired: 0 }
  }

  console.log(`Checking ${vereinslose.length} vereinslose players...`)

  let reactivated = 0
  let retired = 0
  const now = new Date().toISOString()

  for (let i = 0; i < vereinslose.length; i++) {
    const player = vereinslose[i]

    if (i > 0) {
      await sleep(getRequestDelay())
    }

    console.log(`[vereinslos ${i + 1}/${vereinslose.length}] Checking: ${player.player_name}`)

    const agentInfo = await fetchAgentFromProfile(player.tm_profile_url)

    // Fetch fehlgeschlagen → überspringen
    if (agentInfo.agentName === null) {
      console.log(`  SKIPPED: fetch/parse failed`)
      await supabase.from('berater_players').update({
        last_scanned_at: now,
      }).eq('id', player.id)
      continue
    }

    // Karriereende → deaktivieren
    if (agentInfo.isRetired) {
      console.log(`  RETIRED: ${player.player_name} hat Karriereende`)
      await supabase.from('berater_players').update({
        is_active: false,
        last_scanned_at: now,
        updated_at: now,
      }).eq('id', player.id)
      retired++
      continue
    }

    // Spieler hat wieder einen Verein → Verein finden und zuordnen
    if (agentInfo.currentClubName) {
      console.log(`  BACK IN CLUB: ${player.player_name} → ${agentInfo.currentClubName}`)

      // Verein in DB suchen
      const { data: matchedClub } = await supabase
        .from('berater_clubs')
        .select('id')
        .ilike('club_name', agentInfo.currentClubName)
        .eq('is_active', true)
        .maybeSingle()

      const hasAgent = !!(agentInfo.agentName && agentInfo.agentName !== 'kein Beratereintrag')

      await supabase.from('berater_players').update({
        is_vereinslos: false,
        club_id: matchedClub?.id || player.club_id,
        current_agent_name: agentInfo.agentName,
        current_agent_company: agentInfo.agentCompany,
        market_value: agentInfo.marketValue,
        has_agent: hasAgent,
        birth_date: agentInfo.birthDate || player.birth_date,
        agent_updated_at: now,
        last_scanned_at: now,
        updated_at: now,
      }).eq('id', player.id)
      reactivated++
      continue
    }

    // Immer noch vereinslos — nur Berater-Info + Scan-Timestamp updaten
    const hasAgent = !!(agentInfo.agentName && agentInfo.agentName !== 'kein Beratereintrag')
    await supabase.from('berater_players').update({
      current_agent_name: agentInfo.agentName,
      current_agent_company: agentInfo.agentCompany,
        market_value: agentInfo.marketValue,
      has_agent: hasAgent,
      birth_date: agentInfo.birthDate || player.birth_date,
      agent_updated_at: now,
      last_scanned_at: now,
      updated_at: now,
    }).eq('id', player.id)
  }

  console.log(`Vereinslose cleanup done: ${vereinslose.length} checked, ${reactivated} reactivated, ${retired} retired`)
  return { checked: vereinslose.length, reactivated, retired }
}

// ============================================================================
// AKTION: scan_next_batch
// ============================================================================

async function scanNextBatch(supabase: ReturnType<typeof createClient>): Promise<{
  scanned: boolean
  clubName?: string
  playersScanned?: number
  changesDetected?: number
  newPlayers?: number
  cycleProgress?: string
  cycleComplete?: boolean
}> {
  // Scan-State laden
  const { data: state, error: stateError } = await supabase
    .from('berater_scan_state')
    .select('*')
    .eq('id', 1)
    .single()

  if (stateError || !state) {
    throw new Error('Failed to load scan state')
  }

  // Alle aktiven Clubs laden (sortiert nach ID für konsistente Reihenfolge)
  const { data: clubs, error: clubsError } = await supabase
    .from('berater_clubs')
    .select('id, club_name')
    .eq('is_active', true)
    .order('created_at', { ascending: true })

  if (clubsError || !clubs || clubs.length === 0) {
    return { scanned: false }
  }

  let nextIndex = state.next_club_index || 0
  let cycleComplete = false

  // Neuen Zyklus starten?
  if (nextIndex >= clubs.length) {
    nextIndex = 0
    cycleComplete = false // Wird am Ende gesetzt

    await supabase
      .from('berater_scan_state')
      .update({
        current_cycle: (state.current_cycle || 0) + 1,
        next_club_index: 0,
        cycle_started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1)
  }

  const club = clubs[nextIndex]
  console.log(`Scanning club ${nextIndex + 1}/${clubs.length}: ${club.club_name}`)

  // Scan-State auf "running" setzen
  await supabase
    .from('berater_scan_state')
    .update({
      is_running: true,
      last_scanned_club: club.club_name,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1)

  try {
    const result = await scanClub(supabase, club.id)

    // Nach jedem Club-Scan: ein paar vereinslose Spieler prüfen
    const cleanupResult = await cleanupVereinslose(supabase, 3)

    // Nächsten Index berechnen
    const newNextIndex = nextIndex + 1
    cycleComplete = newNextIndex >= clubs.length

    // Scan-State updaten
    await supabase
      .from('berater_scan_state')
      .update({
        next_club_index: newNextIndex,
        last_scan_at: new Date().toISOString(),
        last_scanned_club: club.club_name,
        is_running: false,
        error_count: 0,
        updated_at: new Date().toISOString(),
        ...(cycleComplete ? { current_cycle: (state.current_cycle || 0) + 1 } : {}),
      })
      .eq('id', 1)

    return {
      scanned: true,
      clubName: result.clubName,
      playersScanned: result.playersScanned,
      changesDetected: result.changesDetected,
      newPlayers: result.newPlayers,
      cycleProgress: `${nextIndex + 1}/${clubs.length}`,
      cycleComplete,
      vereinsloseChecked: cleanupResult.checked,
      vereinsloseReactivated: cleanupResult.reactivated,
      vereinsloseRetired: cleanupResult.retired,
    }
  } catch (error) {
    console.error(`Error scanning club ${club.club_name}:`, error)

    // Error count erhöhen
    await supabase
      .from('berater_scan_state')
      .update({
        is_running: false,
        error_count: (state.error_count || 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1)

    throw error
  }
}

// ============================================================================
// AKTION: get_status
// ============================================================================

async function getStatus(supabase: ReturnType<typeof createClient>) {
  // Scan-State
  const { data: state } = await supabase
    .from('berater_scan_state')
    .select('*')
    .eq('id', 1)
    .single()

  // Statistiken
  const { count: totalPlayers } = await supabase
    .from('berater_players')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)

  const { count: playersWithoutAgent } = await supabase
    .from('berater_players')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)
    .eq('has_agent', false)

  const { count: totalClubs } = await supabase
    .from('berater_clubs')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)

  const { count: totalChanges } = await supabase
    .from('berater_changes')
    .select('*', { count: 'exact', head: true })

  // Letzte 7 Tage Änderungen
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { count: recentChanges } = await supabase
    .from('berater_changes')
    .select('*', { count: 'exact', head: true })
    .gte('detected_at', sevenDaysAgo)

  // Aktive Ligen
  const { count: activeLeagues } = await supabase
    .from('berater_leagues')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)

  return {
    scanState: state,
    stats: {
      totalPlayers: totalPlayers || 0,
      playersWithoutAgent: playersWithoutAgent || 0,
      totalClubs: totalClubs || 0,
      totalChanges: totalChanges || 0,
      recentChanges: recentChanges || 0,
      activeLeagues: activeLeagues || 0,
    },
  }
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

// AUTO-SCAN: Via pg_cron + pg_net (alle 5 Min. aus der Datenbank heraus)
// Deno.cron nicht verwendet — Supabase Edge Functions unterstützen es nicht stabil.

// ============================================================================
// HTTP HANDLER (manueller Scan aus der App)
// ============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { action, clubId } = await req.json()
    const supabase = getSupabaseClient()

    console.log(`berater-scan: action=${action}`)

    switch (action) {
      case 'bootstrap_clubs': {
        const result = await bootstrapClubs(supabase)
        return new Response(
          JSON.stringify({ success: true, ...result }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
      }

      case 'scan_club': {
        if (!clubId) {
          return new Response(
            JSON.stringify({ success: false, error: 'clubId is required' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
          )
        }
        const result = await scanClub(supabase, clubId)
        return new Response(
          JSON.stringify({ success: true, ...result }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
      }

      case 'scan_next_batch': {
        const result = await scanNextBatch(supabase)
        return new Response(
          JSON.stringify({ success: true, ...result }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
      }

      case 'cleanup_vereinslose': {
        const result = await cleanupVereinslose(supabase, 20)
        return new Response(
          JSON.stringify({ success: true, ...result }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
      }

      case 'get_status': {
        const result = await getStatus(supabase)
        return new Response(
          JSON.stringify({ success: true, ...result }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
      }

      default:
        return new Response(
          JSON.stringify({ success: false, error: `Unknown action: ${action}` }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
    }
  } catch (error) {
    console.error('berater-scan error:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Internal error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
