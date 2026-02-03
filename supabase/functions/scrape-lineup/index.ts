// Supabase Edge Function: Scrape Lineup from fussball.de
// Robuste Version mit Retry-Logik, Error-States, und verbessertem Team-Splitting
//
// Verbesserungen v2:
// - Retry mit Exponential Backoff für alle externen Calls
// - Explizite Error-States statt silent fallthrough
// - Verbesserter Team-Splitting Algorithmus mit Validierung
// - Rate-Limiting für Profile-Fetches
// - Strukturierte Fehler-Responses

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// ===========================================
// CONFIGURATION
// ===========================================

const BROWSERLESS_API_KEY = Deno.env.get('BROWSERLESS_API_KEY') || ''
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''

const BROWSERLESS_SCREENSHOT_URL = 'https://chrome.browserless.io/screenshot'

const CONFIG = {
  // Retry settings
  maxRetries: 3,
  initialRetryDelayMs: 1000,
  maxRetryDelayMs: 8000,

  // Timeouts
  screenshotTimeoutMs: 60000,
  claudeTimeoutMs: 30000,
  profileFetchTimeoutMs: 10000,

  // Rate limiting
  profileBatchSize: 10,
  profileBatchDelayMs: 200,

  // Validation
  minPlayersPerTeam: 7,
  maxPlayersPerTeam: 25,
  expectedStartersPerTeam: 11,
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ===========================================
// TYPES
// ===========================================

interface ScrapedPlayer {
  nummer: string
  name: string
  vorname: string
  position: string
  jahrgang: string
  profileUrl?: string
  club?: string  // Club-Name aus Spielerprofil für Team-Zuordnung
  originalIndex?: number  // Position im Original-HTML für korrekte Starter/Subs-Sortierung
  isSub?: boolean  // true wenn Spieler aus Ersatzbank-Sektion kommt
  isGoalkeeper?: boolean  // true wenn Spieler Torwart ist (gekennzeichnet mit "T" bei fussball.de)
}

interface ScrapedLineups {
  homeTeam: string
  awayTeam: string
  homeStarters: ScrapedPlayer[]
  homeSubs: ScrapedPlayer[]
  awayStarters: ScrapedPlayer[]
  awaySubs: ScrapedPlayer[]
  result?: string
  available: boolean
}

// Explicit error states for better debugging
enum ScrapeErrorCode {
  NONE = 'NONE',
  INVALID_INPUT = 'INVALID_INPUT',
  VISION_SCREENSHOT_FAILED = 'VISION_SCREENSHOT_FAILED',
  VISION_CLAUDE_FAILED = 'VISION_CLAUDE_FAILED',
  VISION_PARSE_FAILED = 'VISION_PARSE_FAILED',
  AJAX_MAIN_PAGE_FAILED = 'AJAX_MAIN_PAGE_FAILED',
  AJAX_LINEUP_FAILED = 'AJAX_LINEUP_FAILED',
  PROFILE_FETCH_FAILED = 'PROFILE_FETCH_FAILED',
  NO_LINEUP_AVAILABLE = 'NO_LINEUP_AVAILABLE',
  TEAM_SPLIT_FAILED = 'TEAM_SPLIT_FAILED',
}

interface ScrapeResult {
  success: boolean
  data?: ScrapedLineups
  error?: string
  errorCode: ScrapeErrorCode
  method?: 'vision' | 'ajax' | 'none'
  debug?: Record<string, unknown>
}

// ===========================================
// UTILITY FUNCTIONS
// ===========================================

/**
 * Retry wrapper with exponential backoff
 * Only retries on transient errors (5xx, timeouts, network errors)
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number
    initialDelayMs?: number
    maxDelayMs?: number
    shouldRetry?: (error: unknown) => boolean
    onRetry?: (attempt: number, error: unknown) => void
  } = {}
): Promise<T> {
  const {
    maxRetries = CONFIG.maxRetries,
    initialDelayMs = CONFIG.initialRetryDelayMs,
    maxDelayMs = CONFIG.maxRetryDelayMs,
    shouldRetry = isTransientError,
    onRetry,
  } = options

  let lastError: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      if (attempt === maxRetries || !shouldRetry(error)) {
        throw error
      }

      const delay = Math.min(initialDelayMs * Math.pow(2, attempt), maxDelayMs)
      onRetry?.(attempt + 1, error)
      console.log(`Retry ${attempt + 1}/${maxRetries} after ${delay}ms:`, String(error))
      await sleep(delay)
    }
  }
  throw lastError
}

/**
 * Check if error is transient (worth retrying)
 */
function isTransientError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    // Network errors
    if (message.includes('network') || message.includes('timeout') ||
        message.includes('econnreset') || message.includes('econnrefused')) {
      return true
    }
  }
  // Response errors
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status: number }).status
    // Retry on 5xx errors and 429 (rate limit)
    return status >= 500 || status === 429
  }
  return false
}

/**
 * Fetch with timeout
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number } = {}
): Promise<Response> {
  const { timeout = 30000, ...fetchOptions } = options

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    })
    return response
  } finally {
    clearTimeout(timeoutId)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Parse German name with better handling of compound names
 */
function parseGermanName(fullName: string): { vorname: string; name: string } {
  if (!fullName || fullName.trim().length === 0) {
    return { vorname: '', name: '' }
  }

  fullName = fullName.trim()
    // IMPORTANT: Remove "Spielerprofil" FIRST, before removing "(Verein)"
    .replace(/\s*-?\s*(?:Spielerprofil|Basisprofil)\s*$/i, '')
    .trim()
    // NOW remove "(Verein)" which is at the end after Spielerprofil was removed
    .replace(/\s*\([^)]+\)\s*$/, '')
    .trim()

  // Handle "Nachname, Vorname" format
  if (fullName.includes(',')) {
    const [nachname, vorname] = fullName.split(',').map(s => s.trim())
    return { vorname: vorname || '', name: nachname || '' }
  }

  const parts = fullName.split(/\s+/)
  if (parts.length === 1) {
    return { vorname: '', name: parts[0] }
  }

  // Last part is surname, rest is first name (handles "Jan-Niklas Müller")
  const name = parts.pop() || ''
  const vorname = parts.join(' ')
  return { vorname, name }
}

// ===========================================
// CLAUDE VISION PROMPT
// ===========================================

const LINEUP_EXTRACTION_PROMPT = `Dies ist ein Screenshot von fussball.de. Analysiere das Bild und extrahiere die Aufstellung des Fußballspiels.

SCHRITT 1: Finde die Mannschaftsnamen
- Der Seitentitel zeigt meist "Team A - Team B"
- Links ist die Heim-Mannschaft (home), rechts die Gast-Mannschaft (away)

SCHRITT 2: Finde die Spielerliste
- Die Aufstellung zeigt Spieler mit Trikotnummer und Namen
- Format ist oft: [Nummer] [Vorname Nachname]
- Startelf: die ersten 11 Spieler pro Team
- Auswechsler/Bank: weitere Spieler darunter

SCHRITT 3: Extrahiere jeden Spieler
Für jeden sichtbaren Spieler notiere:
- nummer: Die Trikotnummer (z.B. "1", "7", "23")
- vorname: Der Vorname (z.B. "Max", "Jan-Niklas")
- name: Der Nachname (z.B. "Müller", "Schmidt")

WICHTIG:
- Schreibe Namen GENAU wie sie angezeigt werden
- Wenn nur ein Name sichtbar ist, setze ihn als "name" (Nachname)
- Bei Doppelnamen behalte die vollständige Schreibweise
- TRENNE Heim- und Gast-Spieler korrekt (links = Heim, rechts = Gast)

Gib das Ergebnis NUR als JSON zurück (KEIN Markdown, KEINE Erklärungen):
{
  "homeTeam": "Mannschaftsname links",
  "awayTeam": "Mannschaftsname rechts",
  "homeStarters": [{"nummer": "1", "vorname": "Max", "name": "Müller"}, ...],
  "homeSubs": [...],
  "awayStarters": [...],
  "awaySubs": []
}

Falls KEINE Spielernamen sichtbar sind (nur Nummern oder leere Seite):
{"homeTeam": "", "awayTeam": "", "homeStarters": [], "homeSubs": [], "awayStarters": [], "awaySubs": [], "noLineup": true}`

// ===========================================
// VISION METHOD (Screenshot + Claude)
// ===========================================

async function scrapeWithVision(
  lineupUrl: string,
  debugInfo: Record<string, unknown>
): Promise<ScrapeResult> {
  if (!BROWSERLESS_API_KEY || !ANTHROPIC_API_KEY) {
    console.log('Vision method: Missing API keys')
    return {
      success: false,
      errorCode: ScrapeErrorCode.VISION_SCREENSHOT_FAILED,
      error: 'Missing API keys for vision method',
    }
  }

  debugInfo.method = 'vision'

  // Step 1: Take screenshot with retry
  let screenshotBase64: string
  try {
    console.log('Taking screenshot of:', lineupUrl)

    const screenshotResponse = await withRetry(
      async () => {
        const response = await fetchWithTimeout(
          `${BROWSERLESS_SCREENSHOT_URL}?token=${BROWSERLESS_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            timeout: CONFIG.screenshotTimeoutMs,
            body: JSON.stringify({
              url: lineupUrl,
              gotoOptions: {
                waitUntil: 'networkidle2',
                timeout: CONFIG.screenshotTimeoutMs,
              },
              waitForTimeout: 12000, // Wait for Angular SPA
              options: {
                fullPage: true,
                type: 'png',
                encoding: 'base64',
              },
            }),
          }
        )

        if (!response.ok) {
          const errorText = await response.text()
          throw Object.assign(new Error(`Screenshot failed: ${errorText.substring(0, 200)}`), { status: response.status })
        }

        return response
      },
      {
        onRetry: (attempt) => {
          debugInfo[`screenshotRetry${attempt}`] = true
        },
      }
    )

    screenshotBase64 = await screenshotResponse.text()
    debugInfo.screenshotSize = screenshotBase64.length
    console.log('Screenshot captured, size:', screenshotBase64.length)

    if (screenshotBase64.length < 1000) {
      return {
        success: false,
        errorCode: ScrapeErrorCode.VISION_SCREENSHOT_FAILED,
        error: 'Screenshot too small (likely error page)',
      }
    }
  } catch (error) {
    console.error('Screenshot failed after retries:', error)
    debugInfo.screenshotError = String(error)
    return {
      success: false,
      errorCode: ScrapeErrorCode.VISION_SCREENSHOT_FAILED,
      error: `Screenshot failed: ${error}`,
    }
  }

  // Step 2: Claude Vision analysis with retry
  try {
    console.log('Sending to Claude Vision for analysis')

    const claudeResponse = await withRetry(
      async () => {
        const response = await fetchWithTimeout(
          'https://api.anthropic.com/v1/messages',
          {
            method: 'POST',
            timeout: CONFIG.claudeTimeoutMs,
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': ANTHROPIC_API_KEY,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: 'claude-sonnet-4-20250514',
              max_tokens: 8192,
              messages: [{
                role: 'user',
                content: [
                  {
                    type: 'image',
                    source: {
                      type: 'base64',
                      media_type: 'image/png',
                      data: screenshotBase64,
                    },
                  },
                  { type: 'text', text: LINEUP_EXTRACTION_PROMPT },
                ],
              }],
            }),
          }
        )

        if (!response.ok) {
          const errorText = await response.text()
          throw Object.assign(new Error(`Claude API error: ${errorText.substring(0, 200)}`), { status: response.status })
        }

        return response
      },
      {
        onRetry: (attempt) => {
          debugInfo[`claudeRetry${attempt}`] = true
        },
      }
    )

    const claudeResult = await claudeResponse.json()
    const responseText = claudeResult.content?.[0]?.text || ''
    debugInfo.claudeResponseLength = responseText.length

    // Parse JSON from response
    let jsonText = responseText.trim()
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.replace(/^```json\s*/, '').replace(/\s*```$/, '')
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```\s*/, '').replace(/\s*```$/, '')
    }

    const lineupData = JSON.parse(jsonText)

    if (lineupData.noLineup) {
      console.log('Claude: No lineup visible in screenshot')
      return {
        success: true,
        errorCode: ScrapeErrorCode.NO_LINEUP_AVAILABLE,
        method: 'vision',
        data: {
          homeTeam: '',
          awayTeam: '',
          homeStarters: [],
          homeSubs: [],
          awayStarters: [],
          awaySubs: [],
          available: false,
        },
      }
    }

    // Format and validate player data
    const formatPlayer = (p: { nummer?: string; vorname?: string; name?: string }): ScrapedPlayer => ({
      nummer: p.nummer || '',
      vorname: p.vorname || '',
      name: p.name || '',
      position: '',
      jahrgang: '',
    })

    const result: ScrapedLineups = {
      homeTeam: lineupData.homeTeam || '',
      awayTeam: lineupData.awayTeam || '',
      homeStarters: (lineupData.homeStarters || []).map(formatPlayer),
      homeSubs: (lineupData.homeSubs || []).map(formatPlayer),
      awayStarters: (lineupData.awayStarters || []).map(formatPlayer),
      awaySubs: (lineupData.awaySubs || []).map(formatPlayer),
      available: true,
    }

    // Validate result
    const totalHome = result.homeStarters.length + result.homeSubs.length
    const totalAway = result.awayStarters.length + result.awaySubs.length
    debugInfo.visionPlayersFound = { home: totalHome, away: totalAway }

    if (totalHome < CONFIG.minPlayersPerTeam || totalAway < CONFIG.minPlayersPerTeam) {
      console.log(`Vision: Insufficient players (home: ${totalHome}, away: ${totalAway})`)
      // Return partial data but mark as potentially incomplete
      debugInfo.visionWarning = 'Low player count'
    }

    console.log('Vision method successful:', {
      homeTeam: result.homeTeam,
      awayTeam: result.awayTeam,
      homeStarters: result.homeStarters.length,
      homeSubs: result.homeSubs.length,
      awayStarters: result.awayStarters.length,
      awaySubs: result.awaySubs.length,
    })

    return {
      success: true,
      errorCode: ScrapeErrorCode.NONE,
      method: 'vision',
      data: result,
    }
  } catch (error) {
    console.error('Claude Vision failed:', error)
    debugInfo.claudeError = String(error)

    // Check if it's a parse error
    if (error instanceof SyntaxError) {
      return {
        success: false,
        errorCode: ScrapeErrorCode.VISION_PARSE_FAILED,
        error: `Failed to parse Claude response: ${error}`,
      }
    }

    return {
      success: false,
      errorCode: ScrapeErrorCode.VISION_CLAUDE_FAILED,
      error: `Claude API failed: ${error}`,
    }
  }
}

// ===========================================
// AJAX METHOD (Fallback)
// ===========================================

async function scrapeWithAjax(
  gameId: string,
  url: string | undefined,
  debugInfo: Record<string, unknown>
): Promise<ScrapeResult> {
  debugInfo.method = 'ajax'

  const mainPageUrl = url ? url.split('#')[0] : `https://www.fussball.de/spiel/-/-/spiel/${gameId}`

  // Step 1: Load main page for session/cookies
  let mainPageHtml: string
  let homeTeam = ''
  let awayTeam = ''
  let cookies = ''

  try {
    const mainPageResponse = await withRetry(
      async () => {
        const response = await fetchWithTimeout(mainPageUrl, {
          method: 'GET',
          timeout: 15000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'de-DE,de;q=0.9',
          },
        })

        if (!response.ok) {
          throw Object.assign(new Error(`Main page failed: ${response.status}`), { status: response.status })
        }

        return response
      }
    )

    mainPageHtml = await mainPageResponse.text()
    debugInfo.mainPageLength = mainPageHtml.length

    // Extract teams from title
    const titleMatch = mainPageHtml.match(/<title>([^<]+)<\/title>/i)
    if (titleMatch) {
      const teamsMatch = titleMatch[1].match(/^(.+?)\s+-\s+(.+?)(?:\s+Ergebnis|\s*\|)/i)
      if (teamsMatch) {
        homeTeam = teamsMatch[1].trim()
        awayTeam = teamsMatch[2].trim()
      }
    }

    // Extract cookies
    const setCookieHeaders = mainPageResponse.headers.get('set-cookie') || ''
    cookies = setCookieHeaders.split(',').map(c => c.split(';')[0].trim()).filter(c => c).join('; ')
  } catch (error) {
    console.error('Main page fetch failed:', error)
    debugInfo.mainPageError = String(error)
    return {
      success: false,
      errorCode: ScrapeErrorCode.AJAX_MAIN_PAGE_FAILED,
      error: `Failed to load main page: ${error}`,
    }
  }

  // Step 2: AJAX request for lineup data
  try {
    const ajaxUrl = `https://www.fussball.de/ajax.match.lineup/-/mode/PAGE/spiel/${gameId}/ticker-id/selectedTickerId`

    const ajaxResponse = await withRetry(
      async () => {
        const headers: Record<string, string> = {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': mainPageUrl,
          'Accept': '*/*',
        }
        if (cookies) headers['Cookie'] = cookies

        const response = await fetchWithTimeout(ajaxUrl, {
          method: 'GET',
          timeout: 15000,
          headers,
        })

        if (!response.ok) {
          throw Object.assign(new Error(`AJAX failed: ${response.status}`), { status: response.status })
        }

        return response
      }
    )

    const ajaxHtml = await ajaxResponse.text()
    debugInfo.ajaxLength = ajaxHtml.length

    // Check if lineup data exists
    const noDataIndicators = ['keine Daten verfügbar', 'Noch keine Aufstellung', 'no lineup']
    const hasNoData = noDataIndicators.some(indicator =>
      ajaxHtml.toLowerCase().includes(indicator.toLowerCase())
    )
    const hasPlayers = ajaxHtml.includes('spielerprofil') || ajaxHtml.includes('player-wrapper')

    if (hasNoData || !hasPlayers) {
      console.log('AJAX: No lineup data available')
      return {
        success: true,
        errorCode: ScrapeErrorCode.NO_LINEUP_AVAILABLE,
        method: 'ajax',
        data: {
          homeTeam,
          awayTeam,
          homeStarters: [],
          homeSubs: [],
          awayStarters: [],
          awaySubs: [],
          available: false,
        },
      }
    }

    // Step 3: Extract players with improved team splitting
    const { home, away, confidence } = extractPlayersWithTeams(ajaxHtml)
    debugInfo.playersFound = { home: home.length, away: away.length, splitConfidence: confidence }
    console.log(`Found ${home.length} home + ${away.length} away players (confidence: ${confidence})`)

    // Validate split
    if (confidence < 0.5) {
      console.warn('Low confidence team split - results may be inaccurate')
      debugInfo.teamSplitWarning = 'Low confidence'
    }

    // Step 4: Fetch player names from profiles (with rate limiting)
    console.log('Fetching player names from profiles...')
    const homeWithNames = await fetchPlayerNamesFromProfiles(home, debugInfo)
    const awayWithNames = await fetchPlayerNamesFromProfiles(away, debugInfo)

    const namesFound = [...homeWithNames, ...awayWithNames].filter(p => p.name || p.vorname).length
    const clubsFound = [...homeWithNames, ...awayWithNames].filter(p => p.club).length
    debugInfo.namesFound = namesFound
    debugInfo.clubsFound = clubsFound
    console.log(`Extracted ${namesFound} names and ${clubsFound} clubs from profiles`)

    // Step 5: Correct team assignment based on club name in player profile
    // Player names often contain their club: "Kühn (RasenBallsport Leipzig)"
    const { correctedHome, correctedAway, corrections } = correctTeamAssignment(
      homeWithNames,
      awayWithNames,
      homeTeam,
      awayTeam
    )
    debugInfo.teamCorrections = corrections

    if (corrections > 0) {
      console.log(`Corrected ${corrections} player team assignments based on club names`)
    }

    // Use isSub flag if available (from player-wrapper extraction)
    // Otherwise fall back to taking first 11 as starters
    const splitBySubFlag = (players: ScrapedPlayer[]) => {
      const hasSubFlags = players.some(p => p.isSub !== undefined)
      if (hasSubFlags) {
        // Use isSub flag for accurate split
        const starters = players.filter(p => !p.isSub)
        const subs = players.filter(p => p.isSub)
        return { starters, subs }
      } else {
        // Fall back to first 11 as starters
        return {
          starters: players.slice(0, CONFIG.expectedStartersPerTeam),
          subs: players.slice(CONFIG.expectedStartersPerTeam)
        }
      }
    }

    const homeSplit = splitBySubFlag(correctedHome)
    const awaySplit = splitBySubFlag(correctedAway)

    const result: ScrapedLineups = {
      homeTeam,
      awayTeam,
      homeStarters: homeSplit.starters,
      homeSubs: homeSplit.subs,
      awayStarters: awaySplit.starters,
      awaySubs: awaySplit.subs,
      available: true,
    }

    console.log('AJAX method successful')
    return {
      success: true,
      errorCode: ScrapeErrorCode.NONE,
      method: 'ajax',
      data: result,
    }
  } catch (error) {
    console.error('AJAX lineup fetch failed:', error)
    debugInfo.ajaxError = String(error)
    return {
      success: false,
      errorCode: ScrapeErrorCode.AJAX_LINEUP_FAILED,
      error: `AJAX lineup request failed: ${error}`,
    }
  }
}

// ===========================================
// TEAM SPLITTING (Improved Algorithm)
// ===========================================

interface TeamSplitResult {
  home: ScrapedPlayer[]
  away: ScrapedPlayer[]
  confidence: number  // 0-1 confidence score
}

function extractPlayersWithTeams(html: string): TeamSplitResult {
  // Method 1: Try player-wrapper class based extraction (most reliable)
  // fussball.de uses class="player-wrapper home" and class="player-wrapper away"
  const playerWrapperResult = tryPlayerWrapperExtraction(html)
  if (playerWrapperResult) {
    return { ...playerWrapperResult, confidence: 0.99 }
  }

  // Method 2: Try HTML class-based splitting (legacy patterns)
  const classSplitResult = tryClassBasedSplit(html)
  if (classSplitResult) {
    return { ...classSplitResult, confidence: 0.95 }
  }

  // Method 3: Gap-based splitting with validation (fallback)
  const allPlayers = extractAllPlayers(html)

  if (allPlayers.length === 0) {
    return { home: [], away: [], confidence: 0 }
  }

  // Find best split point using multiple heuristics
  const bestSplit = findBestSplitPoint(allPlayers)

  // Preserve global HTML index for proper starter/subs ordering after team correction
  // This allows us to maintain original order even when players are moved between teams
  const homePlayers = allPlayers.slice(0, bestSplit.index).map(p => ({
    ...p.player,
    originalIndex: p.index,  // Global HTML position
  }))
  const awayPlayers = allPlayers.slice(bestSplit.index).map(p => ({
    ...p.player,
    originalIndex: p.index,  // Global HTML position
  }))

  return {
    home: homePlayers,
    away: awayPlayers,
    confidence: bestSplit.confidence,
  }
}

/**
 * Extract players using the player-wrapper class which includes team info.
 * fussball.de uses class="player-wrapper home" and class="player-wrapper away"
 * Also detects if player is in "substitutes" section to properly mark starters vs subs.
 */
function tryPlayerWrapperExtraction(html: string): { home: ScrapedPlayer[]; away: ScrapedPlayer[] } | null {
  const homePlayers: ScrapedPlayer[] = []
  const awayPlayers: ScrapedPlayer[] = []
  const seenUrls = new Set<string>()

  // Find position of substitutes section
  const substitutesMatch = html.match(/class="[^"]*substitutes[^"]*"/i)
  const substitutesPosition = substitutesMatch?.index ?? Infinity

  // Pattern to match player-wrapper with team info
  // Matches both players with profile URLs and players without (href="#")
  // Also captures firstname and lastname spans for players without profiles
  // Note: players with profiles have data-obfuscation attribute, players without don't
  // Goalkeeper is marked with "T" instead of a number, so we match [T\d]+ for player-number
  const playerPattern = /<a[^>]*href="([^"]*)"[^>]*class="player-wrapper (home|away)"[^>]*>[\s\S]*?<span[^>]*class="firstname"[^>]*>([^<]*)<\/span><span[^>]*class="lastname"[^>]*>([^<]*)<\/span>[\s\S]*?<span class="player-number">([T\d]+)<\/span>/gi

  for (const match of html.matchAll(playerPattern)) {
    const profileUrl = match[1]
    const team = match[2].toLowerCase()  // "home" or "away"
    const firstnameRaw = match[3]  // May be obfuscated or empty
    const lastnameRaw = match[4]   // May be "k.A." or obfuscated
    const nummerRaw = match[5]
    const matchPosition = match.index!

    // Check if goalkeeper (marked with "T" instead of number)
    const isGoalkeeper = nummerRaw.toUpperCase() === 'T'
    const nummer = isGoalkeeper ? '1' : nummerRaw  // Torwart gets number 1 if "T"

    // Skip duplicates (but not for players without profile URL)
    const hasProfile = profileUrl.includes('spielerprofil')
    if (hasProfile && seenUrls.has(profileUrl)) continue

    // Validate number (skip if not goalkeeper and not valid number)
    if (!isGoalkeeper) {
      const nummerInt = parseInt(nummer)
      if (isNaN(nummerInt) || nummerInt < 1 || nummerInt > 99) continue
    }

    if (hasProfile) {
      seenUrls.add(profileUrl)
    }

    // For players without profile, use the name directly from HTML
    // These players have "k.A." as lastname and empty firstname
    const isNoProfile = !hasProfile || lastnameRaw === 'k.A.'

    const player: ScrapedPlayer = {
      nummer,
      name: isNoProfile ? 'k.A.' : '',
      vorname: '',
      position: isGoalkeeper ? 'Torwart' : '',
      jahrgang: '',
      profileUrl: hasProfile ? profileUrl : undefined,
      originalIndex: matchPosition,
      isSub: matchPosition > substitutesPosition,  // Player is sub if after substitutes section
      isGoalkeeper,
    }

    if (team === 'home') {
      homePlayers.push(player)
    } else {
      awayPlayers.push(player)
    }
  }

  // Validate we found enough players
  if (homePlayers.length < CONFIG.minPlayersPerTeam || awayPlayers.length < CONFIG.minPlayersPerTeam) {
    console.log(`Player-wrapper extraction found too few players: ${homePlayers.length} home, ${awayPlayers.length} away`)
    return null
  }

  // Sort each team: starters (isSub=false) first, then subs (isSub=true)
  // Within starters, goalkeeper comes first
  // Within each group, sort by originalIndex
  const sortPlayers = (players: ScrapedPlayer[]) => {
    return players.sort((a, b) => {
      // Starters before subs
      if (a.isSub !== b.isSub) {
        return a.isSub ? 1 : -1
      }
      // Within starters: goalkeeper first
      if (!a.isSub && !b.isSub) {
        if (a.isGoalkeeper && !b.isGoalkeeper) return -1
        if (!a.isGoalkeeper && b.isGoalkeeper) return 1
      }
      // Within same group, sort by original position
      return (a.originalIndex ?? 0) - (b.originalIndex ?? 0)
    })
  }

  console.log(`Player-wrapper extraction successful: ${homePlayers.length} home, ${awayPlayers.length} away`)
  console.log(`  Substitutes section at position: ${substitutesPosition}`)

  return {
    home: sortPlayers(homePlayers),
    away: sortPlayers(awayPlayers),
  }
}

function tryClassBasedSplit(html: string): { home: ScrapedPlayer[]; away: ScrapedPlayer[] } | null {
  const splitPatterns = [
    // column-left / column-right
    {
      home: /class="[^"]*column-left[^"]*"([\s\S]*?)(?=class="[^"]*column-right)/i,
      away: /class="[^"]*column-right[^"]*"([\s\S]*?)(?=<\/div>\s*<\/div>\s*$|$)/i
    },
    // aufstellung-heim / aufstellung-gast
    {
      home: /class="[^"]*aufstellung[_-]?heim[^"]*"([\s\S]*?)(?=class="[^"]*aufstellung[_-]?gast)/i,
      away: /class="[^"]*aufstellung[_-]?gast[^"]*"([\s\S]*?)$/i
    },
    // row-team0 / row-team1
    {
      home: /class="[^"]*team[_-]?0[^"]*"([\s\S]*?)(?=class="[^"]*team[_-]?1)/i,
      away: /class="[^"]*team[_-]?1[^"]*"([\s\S]*?)$/i
    },
    // lineup-home / lineup-away
    {
      home: /class="[^"]*lineup[_-]?home[^"]*"([\s\S]*?)(?=class="[^"]*lineup[_-]?away)/i,
      away: /class="[^"]*lineup[_-]?away[^"]*"([\s\S]*?)$/i
    },
  ]

  for (const pattern of splitPatterns) {
    const homeMatch = html.match(pattern.home)
    const awayMatch = html.match(pattern.away)

    if (homeMatch && awayMatch) {
      const homePlayers = extractPlayersFromHtml(homeMatch[0])
      const awayPlayers = extractPlayersFromHtml(awayMatch[0])

      // Validate that both teams have reasonable player counts
      if (homePlayers.length >= CONFIG.minPlayersPerTeam &&
          awayPlayers.length >= CONFIG.minPlayersPerTeam) {
        console.log('Class-based split successful')
        return { home: homePlayers, away: awayPlayers }
      }
    }
  }

  return null
}

interface PlayerWithIndex {
  player: ScrapedPlayer
  index: number
}

function extractAllPlayers(html: string): PlayerWithIndex[] {
  const players: PlayerWithIndex[] = []
  const seenUrls = new Set<string>()

  const playerPattern = /<a[^>]*href="([^"]*spielerprofil[^"]*)"[^>]*>[\s\S]*?<span[^>]*>(\d+)<\/span>[\s\S]*?<\/a>/gi

  for (const match of html.matchAll(playerPattern)) {
    const profileUrl = match[1]
    const nummer = match[2]

    // Skip duplicates and invalid numbers
    if (seenUrls.has(profileUrl)) continue
    const nummerInt = parseInt(nummer)
    if (isNaN(nummerInt) || nummerInt < 1 || nummerInt > 99) continue

    seenUrls.add(profileUrl)

    players.push({
      player: {
        nummer,
        name: '',
        vorname: '',
        position: '',
        jahrgang: '',
        profileUrl: profileUrl.startsWith('http') ? profileUrl : `https://www.fussball.de${profileUrl}`,
      },
      index: match.index!,
    })
  }

  return players
}

interface SplitPoint {
  index: number
  confidence: number
}

function findBestSplitPoint(players: PlayerWithIndex[]): SplitPoint {
  if (players.length <= 1) {
    return { index: 0, confidence: 0 }
  }

  // Calculate gaps between consecutive players
  const gaps: { index: number; gap: number }[] = []
  for (let i = 1; i < players.length; i++) {
    gaps.push({
      index: i,
      gap: players[i].index - players[i - 1].index,
    })
  }

  // Find the largest gap
  gaps.sort((a, b) => b.gap - a.gap)
  const largestGap = gaps[0]
  const secondLargestGap = gaps[1]

  // Calculate confidence based on gap ratio
  let confidence = 0.5  // Base confidence

  if (secondLargestGap && largestGap.gap > 0) {
    // If largest gap is significantly bigger than second largest, high confidence
    const ratio = largestGap.gap / secondLargestGap.gap
    if (ratio > 3) confidence = 0.9
    else if (ratio > 2) confidence = 0.8
    else if (ratio > 1.5) confidence = 0.7
  }

  // Validate the split produces reasonable team sizes
  const homeCount = largestGap.index
  const awayCount = players.length - largestGap.index

  // Both teams should have between 7-25 players
  if (homeCount < CONFIG.minPlayersPerTeam || awayCount < CONFIG.minPlayersPerTeam ||
      homeCount > CONFIG.maxPlayersPerTeam || awayCount > CONFIG.maxPlayersPerTeam) {
    // Split doesn't make sense, fall back to middle
    console.log(`Invalid split (${homeCount}/${awayCount}), using middle`)
    const middleIndex = Math.ceil(players.length / 2)
    return { index: middleIndex, confidence: 0.3 }
  }

  // Teams should be roughly equal (within 50% difference)
  const sizeDiff = Math.abs(homeCount - awayCount) / Math.max(homeCount, awayCount)
  if (sizeDiff > 0.5) {
    confidence *= 0.7  // Reduce confidence for unequal teams
  }

  console.log(`Split at index ${largestGap.index} (gap: ${largestGap.gap}): ${homeCount} home, ${awayCount} away`)
  return { index: largestGap.index, confidence }
}

function extractPlayersFromHtml(html: string): ScrapedPlayer[] {
  const players: ScrapedPlayer[] = []
  const seenUrls = new Set<string>()

  const playerPattern = /<a[^>]*href="([^"]*spielerprofil[^"]*)"[^>]*>[\s\S]*?<span[^>]*>(\d+)<\/span>[\s\S]*?<\/a>/gi

  let index = 0
  for (const match of html.matchAll(playerPattern)) {
    const profileUrl = match[1]
    const nummer = match[2]

    if (seenUrls.has(profileUrl)) continue
    const nummerInt = parseInt(nummer)
    if (isNaN(nummerInt) || nummerInt < 1 || nummerInt > 99) continue

    seenUrls.add(profileUrl)

    players.push({
      nummer,
      name: '',
      vorname: '',
      position: '',
      jahrgang: '',
      profileUrl: profileUrl.startsWith('http') ? profileUrl : `https://www.fussball.de${profileUrl}`,
      originalIndex: index++,  // Preserve order within team section
    })
  }

  return players
}

// ===========================================
// TEAM CORRECTION (based on club name in profile)
// ===========================================

/**
 * Correct team assignments based on club name found in player profiles.
 * Player names from profiles often include the club: "Kühn (RasenBallsport Leipzig)"
 * This allows us to fix misassigned players after the initial split.
 */
function correctTeamAssignment(
  homePlayers: ScrapedPlayer[],
  awayPlayers: ScrapedPlayer[],
  homeTeam: string,
  awayTeam: string
): { correctedHome: ScrapedPlayer[]; correctedAway: ScrapedPlayer[]; corrections: number } {
  // Normalize team names for matching
  const normalizeTeamName = (name: string): string[] => {
    // Create multiple variants for matching
    const normalized = name.toLowerCase()
      .replace(/[^\w\säöüß]/g, '')  // Remove special chars except umlauts
      .trim()

    // Split into words and create variants
    const words = normalized.split(/\s+/)
    const variants = [normalized]

    // Add individual significant words (ignore common words)
    const ignoreWords = ['fc', 'sv', 'vfl', 'tsg', 'sc', 'fsv', 'bsc', 'ev', 'e.v.', '1.', '2.', 'i', 'ii', 'u15', 'u16', 'u17', 'u18', 'u19']
    for (const word of words) {
      if (word.length > 3 && !ignoreWords.includes(word)) {
        variants.push(word)
      }
    }

    // Add common abbreviations
    if (normalized.includes('rasenballsport') || normalized.includes('rb leipzig')) {
      variants.push('leipzig', 'rasenballsport', 'rb')
    }
    if (normalized.includes('borussia') || normalized.includes('bvb')) {
      variants.push('dortmund', 'borussia', 'bvb')
    }

    return variants
  }

  const homeVariants = normalizeTeamName(homeTeam)
  const awayVariants = normalizeTeamName(awayTeam)

  /**
   * Determine a player's team based on club info from their profile.
   * Priority: 1) club field (reliable), 2) name parsing (fallback)
   */
  const getTeamFromPlayer = (player: ScrapedPlayer): 'home' | 'away' | null => {
    // PRIORITY 1: Club field from profile (most reliable)
    if (player.club) {
      const clubLower = player.club.toLowerCase()

      // Check if it matches away team
      for (const variant of awayVariants) {
        if (clubLower.includes(variant)) {
          return 'away'
        }
      }

      // Check if it matches home team
      for (const variant of homeVariants) {
        if (clubLower.includes(variant)) {
          return 'home'
        }
      }
    }

    // PRIORITY 2: Check for team name in parentheses: "Name (Team)" (fallback)
    const fullName = `${player.vorname} ${player.name}`.toLowerCase()
    const parenMatch = fullName.match(/\(([^)]+)\)/)
    if (parenMatch) {
      const teamInName = parenMatch[1].toLowerCase()

      // Check if it matches away team
      for (const variant of awayVariants) {
        if (teamInName.includes(variant)) {
          return 'away'
        }
      }

      // Check if it matches home team
      for (const variant of homeVariants) {
        if (teamInName.includes(variant)) {
          return 'home'
        }
      }
    }

    return null
  }

  const correctedHome: ScrapedPlayer[] = []
  const correctedAway: ScrapedPlayer[] = []
  let corrections = 0

  // Process home players - check if they actually belong to away team
  for (const player of homePlayers) {
    const detectedTeam = getTeamFromPlayer(player)
    if (detectedTeam === 'away') {
      // Player has away team club but was assigned to home -> move to away
      correctedAway.push(player)
      corrections++
      console.log(`Moved ${player.vorname} ${player.name} (club: ${player.club}) from home to away`)
    } else {
      correctedHome.push(player)
    }
  }

  // Process away players - check if they actually belong to home team
  for (const player of awayPlayers) {
    const detectedTeam = getTeamFromPlayer(player)
    if (detectedTeam === 'home') {
      // Player has home team club but was assigned to away -> move to home
      correctedHome.push(player)
      corrections++
      console.log(`Moved ${player.vorname} ${player.name} (club: ${player.club}) from away to home`)
    } else {
      correctedAway.push(player)
    }
  }

  // Sort each team by originalIndex to restore proper starter/subs order
  // Players who appear earlier in the HTML are more likely to be starters
  const sortByIndex = (a: ScrapedPlayer, b: ScrapedPlayer) =>
    (a.originalIndex ?? Infinity) - (b.originalIndex ?? Infinity)

  correctedHome.sort(sortByIndex)
  correctedAway.sort(sortByIndex)

  return {
    correctedHome,
    correctedAway,
    corrections
  }
}

// ===========================================
// PROFILE FETCHING (with Rate Limiting)
// ===========================================

async function fetchPlayerNamesFromProfiles(
  players: ScrapedPlayer[],
  debugInfo: Record<string, unknown>
): Promise<ScrapedPlayer[]> {
  const results: ScrapedPlayer[] = []
  let profileErrors = 0

  // Process in batches with rate limiting
  for (let i = 0; i < players.length; i += CONFIG.profileBatchSize) {
    const batch = players.slice(i, i + CONFIG.profileBatchSize)

    const batchResults = await Promise.all(
      batch.map(async (player) => {
        if (!player.profileUrl) return player

        try {
          const response = await fetchWithTimeout(player.profileUrl, {
            method: 'GET',
            timeout: CONFIG.profileFetchTimeoutMs,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'de-DE,de;q=0.9',
            },
          })

          if (!response.ok) {
            profileErrors++
            return player
          }

          const html = await response.text()

          // Extract player name
          const name = extractNameFromProfileHtml(html)
          if (name) {
            player.vorname = name.vorname
            player.name = name.name
          }

          // Extract club for team assignment
          const club = extractClubFromProfileHtml(html)
          if (club) {
            player.club = club
          }

          // If no name found, set "k.A." (keine Angabe)
          if (!player.name && !player.vorname) {
            player.name = 'k.A.'
          }

          return player
        } catch (err) {
          profileErrors++
          console.warn('Profile fetch failed:', player.profileUrl, String(err).substring(0, 50))
          // Set "k.A." for failed profile fetches
          if (!player.name && !player.vorname) {
            player.name = 'k.A.'
          }
          return player
        }
      })
    )

    results.push(...batchResults)

    // Rate limiting delay between batches
    if (i + CONFIG.profileBatchSize < players.length) {
      await sleep(CONFIG.profileBatchDelayMs)
    }
  }

  debugInfo.profileErrors = profileErrors
  return results
}

function extractNameFromProfileHtml(html: string): { vorname: string; name: string } | null {
  // Pattern 1: <h1 class="headline">Vorname Nachname</h1>
  const h1Match = html.match(/<h1[^>]*class="[^"]*headline[^"]*"[^>]*>([^<]+)<\/h1>/i)
  if (h1Match) {
    const parsed = parseGermanName(h1Match[1])
    if (parsed.name) return parsed
  }

  // Pattern 2: <title>Vorname Nachname (Verein) Spielerprofil | FUSSBALL.DE</title>
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i)
  if (titleMatch) {
    let text = titleMatch[1].split('|')[0].trim()
    const parsed = parseGermanName(text)
    if (parsed.name) return parsed
  }

  // Pattern 3: og:title meta tag
  const ogMatch = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i)
  if (ogMatch) {
    let text = ogMatch[1].split('|')[0].trim()
    const parsed = parseGermanName(text)
    if (parsed.name) return parsed
  }

  // Pattern 4: Look for name in profile-header or similar
  const profileNameMatch = html.match(/<[^>]*class="[^"]*(?:profile-name|player-name|name)[^"]*"[^>]*>([^<]+)</i)
  if (profileNameMatch) {
    const parsed = parseGermanName(profileNameMatch[1])
    if (parsed.name) return parsed
  }

  return null
}

/**
 * Extract player's current club from profile HTML.
 * The profile page contains a link to the player's current team/club.
 * Example: <a href="...mannschaft...">Borussia Dortmund</a>
 */
function extractClubFromProfileHtml(html: string): string | null {
  // Pattern 1: Link zur Mannschaftsseite (most reliable)
  // <a href="...mannschaft...">Vereinsname</a>
  const mannschaftMatch = html.match(/<a[^>]*href="[^"]*\/mannschaft\/[^"]*"[^>]*>([^<]+)<\/a>/i)
  if (mannschaftMatch) {
    return mannschaftMatch[1].trim()
  }

  // Pattern 2: Verein im Profil-Header
  const clubMatch = html.match(/<span[^>]*class="[^"]*(?:club|verein|team)[^"]*"[^>]*>([^<]+)<\/span>/i)
  if (clubMatch) {
    return clubMatch[1].trim()
  }

  return null
}

// ===========================================
// MAIN HANDLER
// ===========================================

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const startTime = Date.now()
  const debugInfo: Record<string, unknown> = {
    browserlessKeyExists: !!BROWSERLESS_API_KEY,
    anthropicKeyExists: !!ANTHROPIC_API_KEY,
    startTime: new Date().toISOString(),
  }

  try {
    const { url, matchId, debug } = await req.json()

    if (!url && !matchId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'url or matchId is required',
          errorCode: ScrapeErrorCode.INVALID_INPUT,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // Extract matchId from URL
    let gameId = matchId
    if (!gameId && url) {
      const idMatch = url.match(/\/-\/spiel\/([A-Z0-9]{20,})/i)
      if (idMatch) {
        gameId = idMatch[1]
      } else {
        const fallbackMatch = url.match(/([A-Z0-9]{20,})(?:[\/\?#]|$)/i)
        if (fallbackMatch) {
          gameId = fallbackMatch[1]
        }
      }
    }

    if (!gameId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Could not extract match ID from URL',
          errorCode: ScrapeErrorCode.INVALID_INPUT,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    console.log('Processing lineup for match:', gameId)
    debugInfo.gameId = gameId

    // Build lineup URL
    const baseUrl = url || `https://www.fussball.de/spiel/-/-/spiel/${gameId}`
    const cleanUrl = baseUrl.split('#')[0]
    const lineupUrl = `${cleanUrl}#!/section/lineup`
    debugInfo.lineupUrl = lineupUrl

    // ===========================================
    // METHOD 1: AJAX (Primary - most reliable)
    // ===========================================
    // AJAX is more reliable than Vision because:
    // - It fetches data directly from the correct match ID
    // - Vision can capture wrong matches (e.g., featured Bundesliga games)
    // - AJAX uses player-wrapper classes for accurate team/starter detection
    console.log('Trying AJAX method first...')
    const ajaxResult = await scrapeWithAjax(gameId, url, debugInfo)

    debugInfo.duration = Date.now() - startTime

    if (ajaxResult.success && ajaxResult.data?.available) {
      // AJAX succeeded with lineup data
      debugInfo.duration = Date.now() - startTime
      const responseData: Record<string, unknown> = {
        success: true,
        data: ajaxResult.data,
        method: 'ajax',
        errorCode: ajaxResult.errorCode,
      }
      if (debug) responseData.debug = debugInfo

      return new Response(
        JSON.stringify(responseData),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    // AJAX returned no lineup - try Vision as fallback (slower but can read images)
    if (ajaxResult.errorCode === ScrapeErrorCode.NO_LINEUP_AVAILABLE && BROWSERLESS_API_KEY && ANTHROPIC_API_KEY) {
      console.log('AJAX found no lineup, trying Vision fallback...')
      const visionResult = await scrapeWithVision(lineupUrl, debugInfo)

      if (visionResult.success && visionResult.data?.available) {
        debugInfo.duration = Date.now() - startTime
        const responseData: Record<string, unknown> = {
          success: true,
          data: visionResult.data,
          method: 'vision',
        }
        if (debug) responseData.debug = debugInfo

        return new Response(
          JSON.stringify(responseData),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
      }
    }

    // No lineup available from either method
    if (ajaxResult.errorCode === ScrapeErrorCode.NO_LINEUP_AVAILABLE) {
      debugInfo.duration = Date.now() - startTime
      const responseData: Record<string, unknown> = {
        success: true,
        data: ajaxResult.data,  // Return empty lineup with available: false
        method: 'ajax',
        errorCode: ajaxResult.errorCode,
      }
      if (debug) responseData.debug = debugInfo

      return new Response(
        JSON.stringify(responseData),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    // Both methods failed
    console.error('All scraping methods failed')
    debugInfo.ajaxResult = ajaxResult.errorCode

    const responseData: Record<string, unknown> = {
      success: false,
      error: ajaxResult.error || 'All scraping methods failed',
      errorCode: ajaxResult.errorCode,
    }
    if (debug) responseData.debug = debugInfo

    return new Response(
      JSON.stringify(responseData),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    console.error('Scraping error:', error)
    debugInfo.duration = Date.now() - startTime
    debugInfo.fatalError = String(error)

    return new Response(
      JSON.stringify({
        success: false,
        error: 'Scraping failed: ' + String(error),
        errorCode: 'FATAL_ERROR',
        debug: debugInfo,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
