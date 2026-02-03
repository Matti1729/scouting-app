// Supabase Edge Function: Fetch Player Rankings
// Scrapt Torschützen- und Vorlagengeber-Listen von Transfermarkt
// Speichert Top 30 pro Liga in berater_player_stats

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ============================================================================
// KONFIGURATION
// ============================================================================

const TOP_N = 30  // Top 30 pro Liga holen

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

// Delay zwischen Requests: 2-4s + Jitter
function getRequestDelay(): number {
  const base = 2000 + Math.random() * 2000
  const jitter = (Math.random() - 0.5) * 500
  return Math.max(1500, base + jitter)
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

// Parse Torschützen- oder Assistenliste
function parseRankingTable(html: string): RankedPlayer[] {
  const players: RankedPlayer[] = []

  // Suche nach der Haupttabelle mit Spielerdaten
  // TM verwendet verschiedene Tabellenstrukturen

  // Pattern für Tabellenzeilen mit Spielerlinks
  // Typisches Format: <tr>...<td class="hauptlink">...<a href="/spieler/123">Name</a>...</td>...<td>Tore/Assists</td>...</tr>

  // Versuche verschiedene Patterns
  const rowPattern = /<tr[^>]*class="[^"]*(?:odd|even)[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi
  const rows = html.matchAll(rowPattern)

  let rank = 0
  for (const rowMatch of rows) {
    const rowHtml = rowMatch[1]
    rank++

    if (rank > TOP_N) break

    // Spielername und Link extrahieren
    // Pattern: <a ... href="/spielername/profil/spieler/ID" ...>Name</a>
    const playerLinkMatch = rowHtml.match(/<a[^>]*href="([^"]*\/spieler\/\d+)"[^>]*>([^<]+)<\/a>/i)
    if (!playerLinkMatch) continue

    const profileUrl = playerLinkMatch[1]
    const playerName = decodeHtmlEntities(playerLinkMatch[2].trim())
    const tmPlayerId = extractTmPlayerId(profileUrl)

    if (!tmPlayerId) continue

    // Verein extrahieren (oft in separatem Link)
    let clubName = ''
    const clubMatch = rowHtml.match(/<a[^>]*href="[^"]*\/verein\/\d+[^"]*"[^>]*title="([^"]+)"/i)
      || rowHtml.match(/<a[^>]*href="[^"]*\/verein\/\d+[^"]*"[^>]*>([^<]+)<\/a>/i)
      || rowHtml.match(/<img[^>]*alt="([^"]+)"[^>]*class="[^"]*tiny_wappen[^"]*"/i)
    if (clubMatch) {
      clubName = decodeHtmlEntities(clubMatch[1].trim())
    }

    // Statistik-Wert extrahieren (Tore oder Assists)
    // Oft in einer der letzten Spalten, Format: Zahl
    // Suche nach <td>...</td> mit einer Zahl
    const statMatches = rowHtml.matchAll(/<td[^>]*>(\d+)<\/td>/gi)
    let statValue = 0
    let gamesPlayed: number | null = null
    const stats: number[] = []
    for (const sm of statMatches) {
      stats.push(parseInt(sm[1], 10))
    }

    // Typischerweise: Spiele, Tore (oder Assists), ggf. weitere Stats
    if (stats.length >= 2) {
      // Letzte oder vorletzte Zahl ist oft die Hauptstatistik
      // Bei Torschützen: oft [Spiele, Tore] oder [Spiele, Tor/Spiel-Quote, Tore]
      // Wir nehmen die größere Zahl als Statistik (außer Spieleanzahl)
      gamesPlayed = stats[0]
      statValue = stats[stats.length - 1] // Letzte Spalte ist oft das Ergebnis

      // Wenn die letzte Zahl sehr klein ist (Quote), nimm vorletzte
      if (statValue < 5 && stats.length > 2) {
        statValue = stats[stats.length - 2]
      }
    } else if (stats.length === 1) {
      statValue = stats[0]
    }

    // Position und Geburtsdatum sind oft nicht direkt in der Tabelle
    // Diese würden aus dem Spielerprofil kommen

    players.push({
      rank,
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
    const matches = html.matchAll(altPattern)
    let altRank = 0

    for (const match of matches) {
      altRank++
      if (altRank > TOP_N) break

      players.push({
        rank: altRank,
        playerName: decodeHtmlEntities(match[3].trim()),
        tmPlayerId: match[2],
        tmProfileUrl: match[1],
        clubName: '',
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
  // Mache: https://www.transfermarkt.de/bundesliga/torschuetzenliste/wettbewerb/L1
  // Oder:  https://www.transfermarkt.de/bundesliga/assists/wettbewerb/L1

  const urlPart = statType === 'goals' ? 'torschuetzenliste' : 'assists'
  return competitionUrl.replace('/startseite/', `/${urlPart}/`)
}

// ============================================================================
// MAIN LOGIC
// ============================================================================

async function fetchRankingsForLeague(
  supabase: ReturnType<typeof getSupabaseClient>,
  league: League,
  statType: 'goals' | 'assists'
): Promise<{ success: boolean; count: number }> {
  const url = buildStatsUrl(league.tm_competition_url, statType)
  console.log(`Fetching ${statType} for ${league.name}: ${url}`)

  const response = await fetchWithRetry(url)

  if (!response || !response.ok) {
    console.error(`Failed to fetch ${statType} for ${league.id}: ${response?.status}`)
    return { success: false, count: 0 }
  }

  const html = await response.text()
  const players = parseRankingTable(html)

  console.log(`Parsed ${players.length} players for ${league.name} (${statType})`)

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

  // In DB speichern/aktualisieren
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

async function fetchAllRankings(): Promise<{
  success: boolean
  leaguesProcessed: number
  totalGoals: number
  totalAssists: number
  errors: string[]
}> {
  const supabase = getSupabaseClient()
  const errors: string[] = []
  let leaguesProcessed = 0
  let totalGoals = 0
  let totalAssists = 0

  // Alle aktiven Ligen laden
  const { data: leagues, error: leaguesError } = await supabase
    .from('berater_leagues')
    .select('id, name, tm_competition_url, category')
    .eq('is_active', true)
    .order('tier', { ascending: true })

  if (leaguesError || !leagues) {
    return {
      success: false,
      leaguesProcessed: 0,
      totalGoals: 0,
      totalAssists: 0,
      errors: [`Failed to load leagues: ${leaguesError?.message}`]
    }
  }

  console.log(`Processing ${leagues.length} leagues...`)

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
      console.log(`Completed ${leaguesProcessed}/${leagues.length}: ${league.name}`)

      // Delay zwischen Ligen
      await sleep(getRequestDelay())

    } catch (error) {
      console.error(`Error processing league ${league.id}:`, error)
      errors.push(`${league.id}: ${error}`)
    }
  }

  return {
    success: errors.length < leagues.length,  // Teilweise Erfolg ist OK
    leaguesProcessed,
    totalGoals,
    totalAssists,
    errors
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

    if (action === 'fetch_all') {
      const result = await fetchAllRankings()

      return new Response(JSON.stringify({
        success: result.success,
        message: `Processed ${result.leaguesProcessed} leagues`,
        stats: {
          leaguesProcessed: result.leaguesProcessed,
          goalsEntries: result.totalGoals,
          assistsEntries: result.totalAssists,
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
