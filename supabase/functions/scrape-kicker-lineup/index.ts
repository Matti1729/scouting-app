// Supabase Edge Function: Scrape Lineup from kicker.de
// Automatischer Fallback für 1./2./3. Liga wenn fussball.de keine Aufstellung hat.
// Akzeptiert Team-Namen + Liga → sucht auf Kicker → scrapt Aufstellung via Vision.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// ===========================================
// CONFIGURATION
// ===========================================

const BROWSERLESS_API_KEY = Deno.env.get('BROWSERLESS_API_KEY') || ''
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''

const BROWSERLESS_SCREENSHOT_URL = 'https://chrome.browserless.io/screenshot'

const CONFIG = {
  maxRetries: 3,
  initialRetryDelayMs: 1000,
  maxRetryDelayMs: 8000,
  screenshotTimeoutMs: 60000,
  claudeTimeoutMs: 30000,
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
  matchDate?: string
  matchTime?: string
  location?: string
  league?: string
}

enum ScrapeErrorCode {
  NONE = 'NONE',
  INVALID_INPUT = 'INVALID_INPUT',
  SEARCH_FAILED = 'SEARCH_FAILED',
  SCREENSHOT_FAILED = 'SCREENSHOT_FAILED',
  CLAUDE_FAILED = 'CLAUDE_FAILED',
  PARSE_FAILED = 'PARSE_FAILED',
  NO_LINEUP_AVAILABLE = 'NO_LINEUP_AVAILABLE',
}

// ===========================================
// UTILITY FUNCTIONS
// ===========================================

async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number
    initialDelayMs?: number
    maxDelayMs?: number
    onRetry?: (attempt: number, error: unknown) => void
  } = {}
): Promise<T> {
  const {
    maxRetries = CONFIG.maxRetries,
    initialDelayMs = CONFIG.initialRetryDelayMs,
    maxDelayMs = CONFIG.maxRetryDelayMs,
    onRetry,
  } = options

  let lastError: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt === maxRetries) throw error

      const message = error instanceof Error ? error.message.toLowerCase() : ''
      const status = error && typeof error === 'object' && 'status' in error ? (error as { status: number }).status : 0
      const isTransient = message.includes('network') || message.includes('timeout') ||
        message.includes('econnreset') || status >= 500 || status === 429

      if (!isTransient) throw error

      const delay = Math.min(initialDelayMs * Math.pow(2, attempt), maxDelayMs)
      onRetry?.(attempt + 1, error)
      console.log(`Retry ${attempt + 1}/${maxRetries} after ${delay}ms:`, String(error))
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
  throw lastError
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number } = {}
): Promise<Response> {
  const { timeout = 30000, ...fetchOptions } = options
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)
  try {
    return await fetch(url, { ...fetchOptions, signal: controller.signal })
  } finally {
    clearTimeout(timeoutId)
  }
}

// ===========================================
// KICKER SEARCH: Team-Namen → Kicker URL
// ===========================================

/**
 * Sucht auf Kicker.de nach dem Spiel.
 * Strategie: Screenshot der Kicker-Suchseite → Claude findet den richtigen Link.
 */
async function findKickerMatchUrl(
  homeTeam: string,
  awayTeam: string,
  debugInfo: Record<string, unknown>
): Promise<string | null> {
  const searchQuery = `${homeTeam} ${awayTeam}`
  const searchUrl = `https://www.kicker.de/suche?q=${encodeURIComponent(searchQuery)}&scope=spieltag`

  console.log('Kicker search URL:', searchUrl)
  debugInfo.searchUrl = searchUrl

  // Screenshot der Suchergebnis-Seite
  let screenshotBase64: string
  try {
    const screenshotResponse = await withRetry(async () => {
      const response = await fetchWithTimeout(
        `${BROWSERLESS_SCREENSHOT_URL}?token=${BROWSERLESS_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          timeout: CONFIG.screenshotTimeoutMs,
          body: JSON.stringify({
            url: searchUrl,
            gotoOptions: { waitUntil: 'networkidle2', timeout: CONFIG.screenshotTimeoutMs },
            waitForTimeout: 5000,
            options: { fullPage: true, type: 'png', encoding: 'base64' },
          }),
        }
      )
      if (!response.ok) throw Object.assign(new Error('Search screenshot failed'), { status: response.status })
      return response
    })

    screenshotBase64 = await screenshotResponse.text()
    if (screenshotBase64.length < 1000) return null
  } catch (error) {
    console.error('Kicker search screenshot failed:', error)
    return null
  }

  // Claude findet den richtigen Match-Link
  try {
    const claudeResponse = await withRetry(async () => {
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
            max_tokens: 1024,
            messages: [{
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: { type: 'base64', media_type: 'image/png', data: screenshotBase64 },
                },
                {
                  type: 'text',
                  text: `Dies ist ein Screenshot der Kicker.de Suchergebnisse für "${homeTeam}" vs "${awayTeam}".

Finde das passende Spiel in den Suchergebnissen. Ich brauche die URL zur Aufstellungsseite.

Kicker-URLs folgen diesem Muster:
https://www.kicker.de/{match-slug}/aufstellung

Gib NUR die vollständige URL zurück, nichts anderes. Wenn du das Spiel nicht findest, antworte mit "NOT_FOUND".

Beispiel-Antwort: https://www.kicker.de/bayern-muenchen-gegen-bvb-2026-bundesliga-4769302/aufstellung`,
                },
              ],
            }],
          }),
        }
      )
      if (!response.ok) throw Object.assign(new Error('Claude search failed'), { status: response.status })
      return response
    })

    const result = await claudeResponse.json()
    const responseText = (result.content?.[0]?.text || '').trim()
    debugInfo.searchResult = responseText

    if (responseText === 'NOT_FOUND' || !responseText.includes('kicker.de')) {
      console.log('Kicker match not found in search results')
      return null
    }

    // URL extrahieren (falls Claude mehr Text zurückgibt)
    const urlMatch = responseText.match(/https?:\/\/[^\s"'<>]+kicker\.de[^\s"'<>]+/)
    if (!urlMatch) return null

    let matchUrl = urlMatch[0]
    // Sicherstellen dass es auf /aufstellung endet
    if (!matchUrl.endsWith('/aufstellung')) {
      const knownPages = ['spielinfo', 'aufstellung', 'schema', 'analyse', 'liveticker', 'spielbericht']
      const lastSegment = matchUrl.split('/').pop() || ''
      if (knownPages.includes(lastSegment)) {
        matchUrl = matchUrl.replace(new RegExp(`/${lastSegment}$`), '/aufstellung')
      } else {
        matchUrl = matchUrl.replace(/\/$/, '') + '/aufstellung'
      }
    }

    console.log('Found Kicker match URL:', matchUrl)
    return matchUrl

  } catch (error) {
    console.error('Claude search analysis failed:', error)
    return null
  }
}

// ===========================================
// KICKER LINEUP PROMPT
// ===========================================

const KICKER_LINEUP_PROMPT = `Dies ist ein Screenshot einer kicker.de Aufstellungsseite eines Fußballspiels (1., 2. oder 3. Bundesliga).

SCHRITT 1: Finde die Mannschaftsnamen
- Oben auf der Seite stehen die beiden Teams (Heim links, Gast rechts)
- Oft im Format "Team A" vs "Team B" oder mit Vereinslogos

SCHRITT 2: Finde die Aufstellung
- Kicker zeigt die Startelf (11 Spieler) und die Ersatzbank
- Format: Trikotnummer und Spielername
- Die Aufstellung kann als Liste oder als Aufstellungsgrafik dargestellt sein

SCHRITT 3: Extrahiere jeden Spieler
Für jeden sichtbaren Spieler notiere:
- nummer: Die Trikotnummer (z.B. "1", "7", "23")
- vorname: Der Vorname (z.B. "Max", "Jan-Niklas")
- name: Der Nachname (z.B. "Müller", "Schmidt")
- position: Die Position falls sichtbar (TW, IV, LV, RV, ZM, LM, RM, ZOM, ST, LA, RA, ZDM, OM)

WICHTIG:
- Schreibe Namen GENAU wie sie angezeigt werden
- Wenn nur ein Name sichtbar ist, setze ihn als "name" (Nachname)
- TRENNE Heim- und Gast-Spieler korrekt
- Startelf = die ersten 11 Spieler (homeStarters/awayStarters)
- Ersatzbank/Auswechselspieler = restliche Spieler (homeSubs/awaySubs)
- Wenn die Position nicht eindeutig erkennbar ist, lasse sie leer ("")

Gib das Ergebnis NUR als JSON zurück (KEIN Markdown, KEINE Erklärungen):
{
  "homeTeam": "Mannschaftsname Heim",
  "awayTeam": "Mannschaftsname Gast",
  "homeStarters": [{"nummer": "1", "vorname": "Max", "name": "Müller", "position": "TW"}, ...],
  "homeSubs": [...],
  "awayStarters": [...],
  "awaySubs": [],
  "result": "2:1"
}

Falls KEINE Aufstellung sichtbar ist:
{"homeTeam": "", "awayTeam": "", "homeStarters": [], "homeSubs": [], "awayStarters": [], "awaySubs": [], "noLineup": true}`

// ===========================================
// SCRAPE LINEUP FROM URL
// ===========================================

async function scrapeKickerLineup(url: string, debugInfo: Record<string, unknown>): Promise<{
  success: boolean
  data?: ScrapedLineups
  error?: string
  errorCode: ScrapeErrorCode
}> {
  debugInfo.lineupUrl = url

  // Step 1: Take screenshot
  let screenshotBase64: string
  try {
    console.log('Taking screenshot of kicker.de:', url)

    const screenshotResponse = await withRetry(
      async () => {
        const response = await fetchWithTimeout(
          `${BROWSERLESS_SCREENSHOT_URL}?token=${BROWSERLESS_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            timeout: CONFIG.screenshotTimeoutMs,
            body: JSON.stringify({
              url,
              gotoOptions: { waitUntil: 'networkidle2', timeout: CONFIG.screenshotTimeoutMs },
              waitForTimeout: 5000,
              options: { fullPage: true, type: 'png', encoding: 'base64' },
            }),
          }
        )
        if (!response.ok) {
          const errorText = await response.text()
          throw Object.assign(new Error(`Screenshot failed: ${errorText.substring(0, 200)}`), { status: response.status })
        }
        return response
      },
      { onRetry: (attempt) => { debugInfo[`screenshotRetry${attempt}`] = true } }
    )

    screenshotBase64 = await screenshotResponse.text()
    debugInfo.screenshotSize = screenshotBase64.length

    if (screenshotBase64.length < 1000) {
      return { success: false, errorCode: ScrapeErrorCode.SCREENSHOT_FAILED, error: 'Screenshot too small' }
    }
  } catch (error) {
    return { success: false, errorCode: ScrapeErrorCode.SCREENSHOT_FAILED, error: `Screenshot failed: ${error}` }
  }

  // Step 2: Claude Vision analysis
  try {
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
                  { type: 'image', source: { type: 'base64', media_type: 'image/png', data: screenshotBase64 } },
                  { type: 'text', text: KICKER_LINEUP_PROMPT },
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
      { onRetry: (attempt) => { debugInfo[`claudeRetry${attempt}`] = true } }
    )

    const claudeResult = await claudeResponse.json()
    const responseText = claudeResult.content?.[0]?.text || ''

    let jsonText = responseText.trim()
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.replace(/^```json\s*/, '').replace(/\s*```$/, '')
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```\s*/, '').replace(/\s*```$/, '')
    }

    const lineupData = JSON.parse(jsonText)

    if (lineupData.noLineup) {
      return {
        success: true,
        errorCode: ScrapeErrorCode.NO_LINEUP_AVAILABLE,
        data: { homeTeam: '', awayTeam: '', homeStarters: [], homeSubs: [], awayStarters: [], awaySubs: [], available: false },
      }
    }

    const normalizePlayer = (p: any): ScrapedPlayer => ({
      nummer: String(p.nummer || ''),
      vorname: String(p.vorname || ''),
      name: String(p.name || ''),
      position: String(p.position || ''),
      jahrgang: String(p.jahrgang || ''),
    })

    const data: ScrapedLineups = {
      homeTeam: lineupData.homeTeam || '',
      awayTeam: lineupData.awayTeam || '',
      homeStarters: (lineupData.homeStarters || []).map(normalizePlayer),
      homeSubs: (lineupData.homeSubs || []).map(normalizePlayer),
      awayStarters: (lineupData.awayStarters || []).map(normalizePlayer),
      awaySubs: (lineupData.awaySubs || []).map(normalizePlayer),
      result: lineupData.result || undefined,
      available: true,
    }

    const totalPlayers = data.homeStarters.length + data.homeSubs.length + data.awayStarters.length + data.awaySubs.length
    console.log(`Kicker lineup: ${data.homeTeam} vs ${data.awayTeam}, ${totalPlayers} players`)

    return { success: true, errorCode: ScrapeErrorCode.NONE, data }

  } catch (error) {
    return { success: false, errorCode: ScrapeErrorCode.CLAUDE_FAILED, error: `Vision analysis failed: ${error}` }
  }
}

// ===========================================
// SERVE
// ===========================================

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const debugInfo: Record<string, unknown> = {}

    if (!BROWSERLESS_API_KEY || !ANTHROPIC_API_KEY) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing API keys', errorCode: ScrapeErrorCode.SCREENSHOT_FAILED }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Modus 1: Direkte URL
    if (body.url) {
      console.log('=== Kicker Lineup Scraper (URL mode) ===')
      console.log('URL:', body.url)

      const result = await scrapeKickerLineup(body.url, debugInfo)
      return new Response(
        JSON.stringify({ ...result, debug: debugInfo }),
        { status: result.success ? 200 : 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Modus 2: Team-Suche
    if (body.homeTeam && body.awayTeam) {
      console.log('=== Kicker Lineup Scraper (Search mode) ===')
      console.log(`Teams: ${body.homeTeam} vs ${body.awayTeam} (${body.league})`)

      // Schritt 1: Match auf Kicker finden
      const matchUrl = await findKickerMatchUrl(body.homeTeam, body.awayTeam, debugInfo)

      if (!matchUrl) {
        return new Response(
          JSON.stringify({
            success: false,
            error: `Spiel "${body.homeTeam} vs ${body.awayTeam}" nicht auf Kicker.de gefunden`,
            errorCode: ScrapeErrorCode.SEARCH_FAILED,
            debug: debugInfo,
          }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Schritt 2: Aufstellung scrapen
      const result = await scrapeKickerLineup(matchUrl, debugInfo)
      return new Response(
        JSON.stringify({ ...result, debug: debugInfo }),
        { status: result.success ? 200 : 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: 'Either "url" or "homeTeam"+"awayTeam" must be provided',
        errorCode: ScrapeErrorCode.INVALID_INPUT,
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Unhandled error:', error)
    return new Response(
      JSON.stringify({ success: false, error: `Internal error: ${error}`, errorCode: ScrapeErrorCode.PARSE_FAILED }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
