// Supabase Edge Function: Fetch Player Rankings
// Scrapt Torschützen- und Vorlagengeber-Listen von Transfermarkt
// Speichert Top 30 pro Liga in berater_player_stats

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ============================================================================
// KONFIGURATION
// ============================================================================

const TOP_N = 30  // Top 30 pro Liga holen
const BATCH_SIZE = 5  // Ligen pro Batch (für Timeout-Vermeidung)

// Erlaubte Liga-IDs für Vorschläge (ohne 1. und 2. Bundesliga)
const ALLOWED_LEAGUE_IDS = [
  'L3',      // 3. Liga
  'RLN3',    // Regionalliga Nord
  'RLN4',    // Regionalliga Nordost
  'RLW3',    // Regionalliga West
  'RLSW',    // Regionalliga Südwest
  'RLB3',    // Regionalliga Bayern
  // U19 Nachwuchsliga Vorrunde (8 Gruppen)
  'U19D1', 'U19D2', 'U19D3', 'U19D4', 'U19D5', 'U19D6', 'U19D7', 'U19D8',
  // U19 Nachwuchsliga Hauptrunde (2 Ligen)
  '19LA', '19LB',
  // U17 Nachwuchsliga Vorrunde (8 Gruppen)
  'U17DA', 'U17DB', 'U17DC', 'U17DD', 'U17DE', 'U17DF', 'U17DG', 'U17DH',
  // U17 Nachwuchsliga Hauptrunde (2 Ligen)
  '17LA', '17LB',
]

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Delay zwischen Requests: 1-2s (schneller für Batch-Processing)
function getRequestDelay(): number {
  const base = 1000 + Math.random() * 1000
  const jitter = (Math.random() - 0.5) * 200
  return Math.max(800, base + jitter)
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

interface League {
  id: string
  name: string
  tm_competition_url: string
  category: string
}

interface RankedPlayer {
  rank: number
  playerName: string
  tmPlayerId: string
  tmProfileUrl: string
  clubName: string
  statValue: number
  gamesPlayed: number | null
  birthDate: string | null
  position: string | null
}

// ============================================================================
// HTML PARSING
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

// Extrahiere TM Player ID aus URL
function extractTmPlayerId(url: string): string | null {
  // /spielername/profil/spieler/123456
  const match = url.match(/\/spieler\/(\d+)/)
  return match ? match[1] : null
}

// Robuste Club-Extraktion mit mehreren Fallback-Patterns
function extractClubName(html: string): string {
  const patterns = [
    // Pattern 1: Club-Link mit title-Attribut (häufigster Fall)
    /<a[^>]*href="[^"]*\/verein\/\d+[^"]*"[^>]*title="([^"]+)"/i,
    // Pattern 2: Club-Link mit direktem Text-Content
    /<a[^>]*href="[^"]*\/verein\/\d+[^"]*"[^>]*>([^<]+)<\/a>/i,
    // Pattern 3: Wappen-Bild mit alt-Attribut (tiny_wappen)
    /<img[^>]*alt="([^"]+)"[^>]*class="[^"]*tiny_wappen[^"]*"/i,
    // Pattern 4: Wappen-Bild mit class vor alt (alternative Reihenfolge)
    /<img[^>]*class="[^"]*tiny_wappen[^"]*"[^>]*alt="([^"]+)"/i,
    // Pattern 5: Allgemeines Wappen-Pattern (mini_wappen, wappen, etc.)
    /<img[^>]*alt="([^"]+)"[^>]*class="[^"]*wappen[^"]*"/i,
    /<img[^>]*class="[^"]*wappen[^"]*"[^>]*alt="([^"]+)"/i,
    // Pattern 6: td mit title-Attribut für Club-Info
    /<td[^>]*title="([^"]+)"[^>]*class="[^"]*(?:verein|klub|club)[^"]*"/i,
    // Pattern 7: Zelle mit hauptlink class die Club-Link enthält
    /<td[^>]*class="[^"]*hauptlink[^"]*"[^>]*>[\s\S]*?<a[^>]*title="([^"]+)"/i,
  ]

  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match && match[1]) {
      const clubName = decodeHtmlEntities(match[1].trim())
      // Filter out player names (Links zu Spielern statt Vereinen)
      if (clubName && !clubName.includes('/spieler/')) {
        return clubName
      }
    }
  }
  return ''
}

// Parse Torschützen- oder Assistenliste
function parseRankingTable(html: string): RankedPlayer[] {
  const players: RankedPlayer[] = []

  // STRATEGIE: Splitte HTML bei jedem <tr class="odd|even">
  // um komplette Zeilen zu bekommen (inklusive nested tables)

  // Finde alle Zeilen-Anfänge
  const rowStarts: number[] = []
  const rowStartPattern = /<tr[^>]*class="[^"]*(?:odd|even)[^"]*"[^>]*>/gi
  let match
  while ((match = rowStartPattern.exec(html)) !== null) {
    rowStarts.push(match.index)
  }

  // Extrahiere jede Zeile vom Start bis zum nächsten Start (oder Ende)
  for (let i = 0; i < Math.min(rowStarts.length, TOP_N); i++) {
    const startIdx = rowStarts[i]
    const endIdx = i + 1 < rowStarts.length ? rowStarts[i + 1] : html.length
    const rowHtml = html.substring(startIdx, endIdx)

    // Spielername und Link extrahieren
    // Pattern: <a ... href="/spielername/profil/spieler/ID" ...>Name</a>
    const playerLinkMatch = rowHtml.match(/<a[^>]*href="([^"]*\/spieler\/\d+)"[^>]*>([^<]+)<\/a>/i)
    if (!playerLinkMatch) continue

    const profileUrl = playerLinkMatch[1]
    const playerName = decodeHtmlEntities(playerLinkMatch[2].trim())
    const tmPlayerId = extractTmPlayerId(profileUrl)

    if (!tmPlayerId) continue

    // Verein extrahieren mit robuster Helper-Funktion
    const clubName = extractClubName(rowHtml)

    // Statistik-Wert extrahieren (Tore oder Assists)
    // Die Statistik-Spalte hat class="zentriert hauptlink"
    // Format: <td class="zentriert hauptlink"><a href="...">15</a></td>
    let statValue = 0
    let gamesPlayed: number | null = null

    // Suche nach td mit BEIDEN Klassen "zentriert" UND "hauptlink"
    // Die Zahl ist in einem <a> Tag
    const hauptlinkStatMatch = rowHtml.match(/<td[^>]*class="[^"]*\bzentriert\b[^"]*\bhauptlink\b[^"]*"[^>]*>[\s\S]*?<a[^>]*>(\d+)<\/a>/i)
      || rowHtml.match(/<td[^>]*class="[^"]*\bhauptlink\b[^"]*\bzentriert\b[^"]*"[^>]*>[\s\S]*?<a[^>]*>(\d+)<\/a>/i)
    if (hauptlinkStatMatch) {
      statValue = parseInt(hauptlinkStatMatch[1], 10)
    }

    // Fallback für Assists: Suche nach der letzten zentrierten Zelle mit einer Zahl
    // Die Assists-Seite hat manchmal eine andere Struktur
    if (statValue === 0) {
      // Pattern 1: <td class="zentriert">X</td> direkt mit Zahl
      const allZentriertDirect = [...rowHtml.matchAll(/<td[^>]*class="[^"]*\bzentriert\b[^"]*"[^>]*>\s*(\d+)\s*<\/td>/gi)]
      if (allZentriertDirect.length > 0) {
        const lastMatch = allZentriertDirect[allZentriertDirect.length - 1]
        statValue = parseInt(lastMatch[1], 10)
      }
    }

    // Fallback 2: Extrahiere alle td.zentriert Inhalte und suche nach der letzten reinen Zahl
    if (statValue === 0) {
      // Finde alle td.zentriert und extrahiere deren Text-Inhalt (ohne nested tags)
      const allZentriertCells = [...rowHtml.matchAll(/<td[^>]*class="[^"]*\bzentriert\b[^"]*"[^>]*>([^<]*(?:<(?!\/td>)[^<]*)*)<\/td>/gi)]
      const numbersFromCells: number[] = []
      for (const match of allZentriertCells) {
        // Entferne HTML-Tags und extrahiere nur Text
        const textContent = match[1].replace(/<[^>]*>/g, '').trim()
        const num = parseInt(textContent, 10)
        if (!isNaN(num) && textContent === String(num)) {
          numbersFromCells.push(num)
        }
      }
      // Nimm die letzte gefundene Zahl (typischerweise die Statistik-Spalte)
      if (numbersFromCells.length > 0) {
        statValue = numbersFromCells[numbersFromCells.length - 1]
      }
    }

    // Spiele extrahieren: Zelle mit class="zentriert" (ohne hauptlink) die einen Link mit Zahl enthält
    // Pattern: <td class="zentriert"><a href="...leistungsdaten...">19</a></td>
    const spieleMatch = rowHtml.match(/<td[^>]*class="zentriert"[^>]*>[\s\S]*?<a[^>]*href="[^"]*leistungsdaten[^"]*"[^>]*>(\d+)<\/a>/i)
    if (spieleMatch) {
      gamesPlayed = parseInt(spieleMatch[1], 10)
    }

    // FIX: Überspringe Spieler mit Statistik aber ohne Spiele
    // Das deutet auf falsche Daten hin (z.B. aus Marktwertänderungen-Tabelle)
    if (gamesPlayed === null && statValue > 0) {
      console.log(`Skipping ${playerName}: has ${statValue} stat but no games (likely from wrong table)`)
      continue
    }

    // Überspringe auch Spieler ohne Statistik
    if (statValue === 0) {
      continue
    }

    players.push({
      rank: players.length + 1,
      playerName,
      tmPlayerId,
      tmProfileUrl: profileUrl,
      clubName,
      statValue,
      gamesPlayed,
      birthDate: null,
      position: null,
    })
  }

  // Fallback: Versuche alternative Tabellenstruktur
  if (players.length === 0) {
    console.log('Standard pattern failed, trying alternative parsing...')

    // Alternative: Suche nach Links zu Spielerprofilen in einer Tabelle
    const altPattern = /<a[^>]*href="([^"]*\/spieler\/(\d+))"[^>]*>([^<]+)<\/a>/gi
    const matches = [...html.matchAll(altPattern)]
    let altRank = 0

    for (const match of matches) {
      altRank++
      if (altRank > TOP_N) break

      // Versuche Club aus dem umgebenden Kontext zu extrahieren
      // Hole 500 Zeichen vor und nach dem Match für Context
      const matchIndex = match.index || 0
      const contextStart = Math.max(0, matchIndex - 500)
      const contextEnd = Math.min(html.length, matchIndex + match[0].length + 500)
      const contextHtml = html.substring(contextStart, contextEnd)
      const clubName = extractClubName(contextHtml)

      players.push({
        rank: altRank,
        playerName: decodeHtmlEntities(match[3].trim()),
        tmPlayerId: match[2],
        tmProfileUrl: match[1],
        clubName,
        statValue: 0,
        gamesPlayed: null,
        birthDate: null,
        position: null,
      })
    }
  }

  return players
}

// ============================================================================
// FETCH FUNCTIONS
// ============================================================================

async function fetchWithRetry(url: string, maxRetries = 3): Promise<Response | null> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: getBrowserHeaders(),
      })

      if (response.status === 429) {
        const backoff = Math.pow(2, attempt) * 5000
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

// Baue die Statistik-URL aus der Wettbewerbs-URL
function buildStatsUrl(competitionUrl: string, statType: 'goals' | 'assists'): string {
  // Aus: https://www.transfermarkt.de/bundesliga/startseite/wettbewerb/L1
  // Mache: https://www.transfermarkt.de/bundesliga/torschuetzenliste/wettbewerb/L1/saison_id/2025
  // Oder:  https://www.transfermarkt.de/bundesliga/assists/wettbewerb/L1/saison_id/2025

  const urlPart = statType === 'goals' ? 'torschuetzenliste' : 'assistliste'

  // Aktuelle Saison-ID berechnen (Jahr in dem Saison beginnt)
  // Saison 25/26 -> saison_id/2025, Saison 24/25 -> saison_id/2024
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const seasonStartYear = month >= 7 ? year : year - 1

  const baseUrl = competitionUrl.replace('/startseite/', `/${urlPart}/`)
  return `${baseUrl}/saison_id/${seasonStartYear}`
}

// ============================================================================
// MAIN LOGIC
// ============================================================================

async function fetchRankingsForLeague(
  supabase: ReturnType<typeof getSupabaseClient>,
  league: League,
  statType: 'goals' | 'assists'
): Promise<{ success: boolean; count: number }> {
  let url = buildStatsUrl(league.tm_competition_url, statType)
  console.log(`[${statType}] ${league.id}: Trying URL ${url}`)

  let response = await fetchWithRetry(url)

  // Fallback für Assists: versuche /topvorlagengeber/ wenn /assistliste/ nicht funktioniert
  if (statType === 'assists' && (!response || !response.ok)) {
    console.log(`[${statType}] ${league.id}: Primary URL failed (${response?.status}), trying /topvorlagengeber/`)
    url = url.replace('/assistliste/', '/topvorlagengeber/')
    response = await fetchWithRetry(url)
  }

  if (!response || !response.ok) {
    console.error(`[${statType}] ${league.id}: Failed with status ${response?.status}`)
    return { success: false, count: 0 }
  }

  console.log(`[${statType}] ${league.id}: Response OK, parsing HTML...`)
  const html = await response.text()
  const players = parseRankingTable(html)

  console.log(`[${statType}] ${league.id}: Parsed ${players.length} players`)

  if (players.length === 0) {
    return { success: true, count: 0 }
  }

  // Aktuelle Saison ermitteln (z.B. "24/25")
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  // Saison beginnt im Juli/August
  const seasonStartYear = month >= 7 ? year : year - 1
  const season = `${String(seasonStartYear).slice(-2)}/${String(seasonStartYear + 1).slice(-2)}`

  // Alte Daten für diese Liga/statType/Season löschen (clean refresh)
  const { error: deleteError } = await supabase
    .from('berater_player_stats')
    .delete()
    .eq('league_id', league.id)
    .eq('stat_type', statType)
    .eq('season', season)

  if (deleteError) {
    console.error(`[${statType}] ${league.id}: Error deleting old data:`, deleteError)
  } else {
    console.log(`[${statType}] ${league.id}: Deleted old data for season ${season}`)
  }

  // In DB speichern
  let savedCount = 0
  for (const player of players) {
    // Prüfe ob Spieler bereits in berater_players existiert
    const { data: existingPlayer } = await supabase
      .from('berater_players')
      .select('id')
      .eq('tm_player_id', player.tmPlayerId)
      .maybeSingle()

    const { error } = await supabase
      .from('berater_player_stats')
      .upsert({
        player_id: existingPlayer?.id || null,
        tm_player_id: player.tmPlayerId,
        player_name: player.playerName,
        league_id: league.id,
        club_name: player.clubName,
        stat_type: statType,
        stat_value: player.statValue,
        games_played: player.gamesPlayed,
        rank_in_league: player.rank,
        season,
        tm_profile_url: player.tmProfileUrl.startsWith('http')
          ? player.tmProfileUrl
          : `https://www.transfermarkt.de${player.tmProfileUrl}`,
        birth_date: player.birthDate,
        position: player.position,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'tm_player_id,league_id,stat_type,season'
      })

    if (error) {
      console.error(`Error saving player ${player.playerName}:`, error)
    } else {
      savedCount++
    }
  }

  return { success: true, count: savedCount }
}

async function fetchRankingsBatch(batchIndex: number = 0): Promise<{
  success: boolean
  leaguesProcessed: number
  totalGoals: number
  totalAssists: number
  errors: string[]
  hasMore: boolean
  nextBatch: number
  totalLeagues: number
}> {
  const supabase = getSupabaseClient()
  const errors: string[] = []
  let leaguesProcessed = 0
  let totalGoals = 0
  let totalAssists = 0

  // Nur erlaubte Ligen laden (ohne 1. und 2. Bundesliga)
  const { data: allLeagues, error: leaguesError } = await supabase
    .from('berater_leagues')
    .select('id, name, tm_competition_url, category')
    .eq('is_active', true)
    .in('id', ALLOWED_LEAGUE_IDS)
    .order('tier', { ascending: true })

  if (leaguesError || !allLeagues) {
    return {
      success: false,
      leaguesProcessed: 0,
      totalGoals: 0,
      totalAssists: 0,
      errors: [`Failed to load leagues: ${leaguesError?.message}`],
      hasMore: false,
      nextBatch: 0,
      totalLeagues: 0
    }
  }

  // Batch-Slice berechnen
  const startIndex = batchIndex * BATCH_SIZE
  const endIndex = Math.min(startIndex + BATCH_SIZE, allLeagues.length)
  const leagues = allLeagues.slice(startIndex, endIndex)
  const hasMore = endIndex < allLeagues.length

  console.log(`Processing batch ${batchIndex}: leagues ${startIndex + 1}-${endIndex} of ${allLeagues.length}`)

  for (const league of leagues) {
    try {
      // Torschützen holen
      const goalsResult = await fetchRankingsForLeague(supabase, league, 'goals')
      if (goalsResult.success) {
        totalGoals += goalsResult.count
      } else {
        errors.push(`Goals failed for ${league.id}`)
      }

      // Delay zwischen Requests
      await sleep(getRequestDelay())

      // Vorlagengeber holen
      const assistsResult = await fetchRankingsForLeague(supabase, league, 'assists')
      if (assistsResult.success) {
        totalAssists += assistsResult.count
      } else {
        errors.push(`Assists failed for ${league.id}`)
      }

      leaguesProcessed++
      console.log(`Completed ${startIndex + leaguesProcessed}/${allLeagues.length}: ${league.name}`)

      // Delay zwischen Ligen (außer bei letzter Liga im Batch)
      if (leaguesProcessed < leagues.length) {
        await sleep(getRequestDelay())
      }

    } catch (error) {
      console.error(`Error processing league ${league.id}:`, error)
      errors.push(`${league.id}: ${error}`)
    }
  }

  return {
    success: errors.length < leagues.length,
    leaguesProcessed,
    totalGoals,
    totalAssists,
    errors,
    hasMore,
    nextBatch: hasMore ? batchIndex + 1 : -1,
    totalLeagues: allLeagues.length
  }
}

// ============================================================================
// HTTP HANDLER
// ============================================================================

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const url = new URL(req.url)
    const action = url.searchParams.get('action') || 'fetch_all'

    console.log(`Action: ${action}`)

    if (action === 'fetch_all' || action === 'fetch_batch') {
      const batchParam = url.searchParams.get('batch')
      const batchIndex = batchParam ? parseInt(batchParam, 10) : 0

      const result = await fetchRankingsBatch(batchIndex)

      return new Response(JSON.stringify({
        success: result.success,
        message: `Processed ${result.leaguesProcessed} leagues (batch ${batchIndex})`,
        stats: {
          leaguesProcessed: result.leaguesProcessed,
          goalsEntries: result.totalGoals,
          assistsEntries: result.totalAssists,
          totalLeagues: result.totalLeagues,
        },
        batch: {
          current: batchIndex,
          hasMore: result.hasMore,
          next: result.nextBatch,
        },
        errors: result.errors.length > 0 ? result.errors : undefined,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'get_stats') {
      const supabase = getSupabaseClient()

      // Statistiken über gespeicherte Daten
      const { data: goalStats } = await supabase
        .from('berater_player_stats')
        .select('id', { count: 'exact', head: true })
        .eq('stat_type', 'goals')

      const { data: assistStats } = await supabase
        .from('berater_player_stats')
        .select('id', { count: 'exact', head: true })
        .eq('stat_type', 'assists')

      const { data: latestUpdate } = await supabase
        .from('berater_player_stats')
        .select('updated_at')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      return new Response(JSON.stringify({
        success: true,
        stats: {
          goalsEntries: goalStats,
          assistsEntries: assistStats,
          lastUpdate: latestUpdate?.updated_at,
        }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({
      error: `Unknown action: ${action}`,
      validActions: ['fetch_all', 'get_stats']
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    console.error('Handler error:', error)
    return new Response(JSON.stringify({
      success: false,
      error: String(error)
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
