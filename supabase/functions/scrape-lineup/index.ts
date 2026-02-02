// Supabase Edge Function: Scrape Lineup from fussball.de
// Nutzt Browserless.io Screenshot + Claude Vision für Namen-Extraktion
// (fussball.de obfuskiert Namen als Canvas/Bilder)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// API Keys
const BROWSERLESS_API_KEY = Deno.env.get('BROWSERLESS_API_KEY') || ''
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''

// Browserless Endpoints
const BROWSERLESS_SCREENSHOT_URL = 'https://chrome.browserless.io/screenshot'
const BROWSERLESS_CONTENT_URL = 'https://chrome.browserless.io/content'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ScrapedPlayer {
  nummer: string
  name: string
  vorname: string
  position: string
  jahrgang: string
  profileUrl?: string
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

// Claude Vision Prompt für Aufstellungs-Extraktion
const LINEUP_EXTRACTION_PROMPT = `Dies ist ein Screenshot von fussball.de. Analysiere das Bild und extrahiere die Aufstellung des Fußballspiels.

SCHRITT 1: Finde die Mannschaftsnamen
- Der Seitentitel zeigt meist "Team A - Team B"
- Links ist die Heim-Mannschaft (home), rechts die Gast-Mannschaft (away)

SCHRITT 2: Finde die Spielerliste
- Die Aufstellung zeigt Spieler mit Trikotnummer und Namen
- Format ist oft: [Nummer] [Vorname Nachname]
- Startelf: die ersten 11 Spieler
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

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { url, matchId, debug } = await req.json()

    const debugInfo: Record<string, unknown> = {
      browserlessKeyExists: !!BROWSERLESS_API_KEY,
      anthropicKeyExists: !!ANTHROPIC_API_KEY,
    }

    if (!url && !matchId) {
      return new Response(
        JSON.stringify({ success: false, error: 'url or matchId is required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // Extrahiere matchId aus URL
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
        JSON.stringify({ success: false, error: 'Could not extract match ID from URL' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    console.log('Processing lineup for match:', gameId)
    debugInfo.gameId = gameId

    // URL für Aufstellungs-Tab
    const baseUrl = url || `https://www.fussball.de/spiel/-/-/spiel/${gameId}`
    const cleanUrl = baseUrl.split('#')[0]
    const lineupUrl = `${cleanUrl}#!/section/lineup`

    debugInfo.lineupUrl = lineupUrl

    // ========================================
    // METHODE 1: Screenshot + Claude Vision
    // ========================================
    if (BROWSERLESS_API_KEY && ANTHROPIC_API_KEY) {
      console.log('Using Screenshot + Claude Vision method')
      debugInfo.method = 'vision'

      try {
        // 1. Screenshot mit Browserless machen
        console.log('Taking screenshot of:', lineupUrl)

        // Screenshot mit Hash-Link für Aufstellungs-Tab
        // Der Hash wird von fussball.de Angular App verarbeitet
        const screenshotResponse = await fetch(`${BROWSERLESS_SCREENSHOT_URL}?token=${BROWSERLESS_API_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: lineupUrl,  // Mit #!/section/lineup Hash
            gotoOptions: {
              waitUntil: 'networkidle2',
              timeout: 60000,
            },
            // Lange Wartezeit für Angular SPA
            waitForTimeout: 10000,
            options: {
              fullPage: true,
              type: 'png',
              encoding: 'base64',
            },
          }),
        })

        debugInfo.screenshotStatus = screenshotResponse.status

        if (!screenshotResponse.ok) {
          const errorText = await screenshotResponse.text()
          console.error('Screenshot failed:', errorText)
          debugInfo.screenshotError = errorText.substring(0, 500)
        } else {
          const screenshotBase64 = await screenshotResponse.text()
          console.log('Screenshot captured, size:', screenshotBase64.length)
          debugInfo.screenshotSize = screenshotBase64.length

          if (screenshotBase64.length > 1000) {
            // 2. Claude Vision für Analyse
            console.log('Sending to Claude Vision for analysis')

            const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
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
                    {
                      type: 'text',
                      text: LINEUP_EXTRACTION_PROMPT,
                    },
                  ],
                }],
              }),
            })

            debugInfo.claudeStatus = claudeResponse.status

            if (claudeResponse.ok) {
              const claudeResult = await claudeResponse.json()
              const responseText = claudeResult.content?.[0]?.text || ''

              console.log('Claude response length:', responseText.length)
              debugInfo.claudeResponseLength = responseText.length

              // Parse JSON aus der Antwort
              try {
                // Entferne eventuelle Markdown-Codeblocks
                let jsonText = responseText.trim()
                if (jsonText.startsWith('```json')) {
                  jsonText = jsonText.replace(/^```json\s*/, '').replace(/\s*```$/, '')
                } else if (jsonText.startsWith('```')) {
                  jsonText = jsonText.replace(/^```\s*/, '').replace(/\s*```$/, '')
                }

                const lineupData = JSON.parse(jsonText)

                // Prüfe ob Aufstellung gefunden wurde
                if (lineupData.noLineup) {
                  console.log('Claude: No lineup visible in screenshot')
                  debugInfo.claudeResult = 'noLineup'
                } else {
                  console.log('Claude extracted lineup:', {
                    homeTeam: lineupData.homeTeam,
                    awayTeam: lineupData.awayTeam,
                    homeStarters: lineupData.homeStarters?.length || 0,
                    homeSubs: lineupData.homeSubs?.length || 0,
                    awayStarters: lineupData.awayStarters?.length || 0,
                    awaySubs: lineupData.awaySubs?.length || 0,
                  })

                  // Formatiere Spieler-Daten
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

                  // Erfolg!
                  const responseData: Record<string, unknown> = { success: true, data: result }
                  if (debug) {
                    responseData.debug = debugInfo
                  }

                  return new Response(
                    JSON.stringify(responseData),
                    { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
                  )
                }
              } catch (parseError) {
                console.error('Failed to parse Claude response:', parseError)
                debugInfo.claudeParseError = String(parseError)
                debugInfo.claudeRawResponse = responseText.substring(0, 1000)
              }
            } else {
              const errorText = await claudeResponse.text()
              console.error('Claude API error:', errorText)
              debugInfo.claudeError = errorText.substring(0, 500)
            }
          }
        }
      } catch (visionError) {
        console.error('Vision method error:', visionError)
        debugInfo.visionException = String(visionError)
      }
    }

    // ========================================
    // METHODE 2: Fallback - AJAX HTML Parsing
    // (funktioniert für Trikotnummern, aber nicht Namen)
    // ========================================
    console.log('Falling back to AJAX method')
    debugInfo.fallbackUsed = true

    const mainPageUrl = url ? url.split('#')[0] : `https://www.fussball.de/spiel/-/-/spiel/${gameId}`

    // Lade Hauptseite für Session/Cookies
    const mainPageResponse = await fetch(mainPageUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'de-DE,de;q=0.9',
      },
      redirect: 'follow',
    })

    debugInfo.mainPageStatus = mainPageResponse.status

    let homeTeam = ''
    let awayTeam = ''

    if (mainPageResponse.ok) {
      const mainPageHtml = await mainPageResponse.text()
      debugInfo.mainPageLength = mainPageHtml.length

      // Extrahiere Teams aus Title
      const titleMatch = mainPageHtml.match(/<title>([^<]+)<\/title>/i)
      if (titleMatch) {
        const teamsMatch = titleMatch[1].match(/^(.+?)\s+-\s+(.+?)(?:\s+Ergebnis|\s*\|)/i)
        if (teamsMatch) {
          homeTeam = teamsMatch[1].trim()
          awayTeam = teamsMatch[2].trim()
        }
      }

      // AJAX für Aufstellungen
      const setCookieHeaders = mainPageResponse.headers.get('set-cookie') || ''
      const ajaxUrl = `https://www.fussball.de/ajax.match.lineup/-/mode/PAGE/spiel/${gameId}/ticker-id/selectedTickerId`

      const ajaxHeaders: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': mainPageUrl,
        'Accept': '*/*',
      }
      if (setCookieHeaders) {
        const cookieParts = setCookieHeaders.split(',').map(c => c.split(';')[0].trim()).filter(c => c)
        ajaxHeaders['Cookie'] = cookieParts.join('; ')
      }

      const ajaxResponse = await fetch(ajaxUrl, { method: 'GET', headers: ajaxHeaders })
      debugInfo.ajaxStatus = ajaxResponse.status

      if (ajaxResponse.ok) {
        const ajaxHtml = await ajaxResponse.text()
        debugInfo.ajaxLength = ajaxHtml.length

        const hasData = !ajaxHtml.includes('keine Daten verfügbar') &&
                       !ajaxHtml.includes('Noch keine Aufstellung') &&
                       (ajaxHtml.includes('spielerprofil') || ajaxHtml.includes('player-wrapper'))

        if (hasData) {
          // Parse Spieler (Nummern + Profil-URLs)
          const players = extractPlayersFromAjax(ajaxHtml)
          console.log('Found', players.length, 'players with profile URLs')
          debugInfo.playersFound = players.length

          // ========================================
          // NAMEN VON SPIELERPROFILEN HOLEN
          // ========================================
          console.log('Fetching player names from profiles...')
          const playersWithNames = await fetchPlayerNamesFromProfiles(players)
          debugInfo.namesFound = playersWithNames.filter(p => p.name || p.vorname).length

          const midpoint = Math.ceil(playersWithNames.length / 2)
          const homePlayers = playersWithNames.slice(0, midpoint)
          const awayPlayers = playersWithNames.slice(midpoint)

          const result: ScrapedLineups = {
            homeTeam,
            awayTeam,
            homeStarters: homePlayers.slice(0, 11),
            homeSubs: homePlayers.slice(11),
            awayStarters: awayPlayers.slice(0, 11),
            awaySubs: awayPlayers.slice(11),
            available: true,
          }

          const responseData: Record<string, unknown> = { success: true, data: result }
          if (debug) {
            responseData.debug = debugInfo
          }

          return new Response(
            JSON.stringify(responseData),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
          )
        }
      }
    }

    // Keine Aufstellung gefunden
    const emptyResult: ScrapedLineups = {
      homeTeam,
      awayTeam,
      homeStarters: [],
      homeSubs: [],
      awayStarters: [],
      awaySubs: [],
      available: false,
    }

    const responseData: Record<string, unknown> = { success: true, data: emptyResult }
    if (debug) {
      debugInfo.result = 'No lineup data found'
      responseData.debug = debugInfo
    }

    return new Response(
      JSON.stringify(responseData),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    console.error('Scraping error:', error)
    return new Response(
      JSON.stringify({ success: false, error: 'Scraping failed: ' + String(error) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})

/**
 * Extrahiert Spieler aus AJAX HTML (nur Nummern, Namen sind obfuskiert)
 */
function extractPlayersFromAjax(html: string): ScrapedPlayer[] {
  const players: ScrapedPlayer[] = []
  const seenUrls = new Set<string>()

  // Pattern: Spieler-Link mit Nummer
  const playerPattern = /<a[^>]*href="([^"]*spielerprofil[^"]*)"[^>]*>[\s\S]*?<span[^>]*>(\d+)<\/span>[\s\S]*?<\/a>/gi

  for (const match of html.matchAll(playerPattern)) {
    const profileUrl = match[1]
    const nummer = match[2]

    if (seenUrls.has(profileUrl)) continue
    if (parseInt(nummer) > 99) continue

    seenUrls.add(profileUrl)

    players.push({
      nummer,
      name: '',  // Namen werden später von Profil geholt
      vorname: '',
      position: '',
      jahrgang: '',
      profileUrl: profileUrl.startsWith('http') ? profileUrl : `https://www.fussball.de${profileUrl}`,
    })
  }

  return players
}

/**
 * Holt Spielernamen von den Profil-Seiten (parallel, max 5 gleichzeitig)
 */
async function fetchPlayerNamesFromProfiles(players: ScrapedPlayer[]): Promise<ScrapedPlayer[]> {
  const BATCH_SIZE = 5  // Max parallele Requests
  const results: ScrapedPlayer[] = []

  // Verarbeite in Batches
  for (let i = 0; i < players.length; i += BATCH_SIZE) {
    const batch = players.slice(i, i + BATCH_SIZE)

    const batchResults = await Promise.all(
      batch.map(async (player) => {
        if (!player.profileUrl) return player

        try {
          const response = await fetch(player.profileUrl, {
            method: 'GET',
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'de-DE,de;q=0.9',
            },
          })

          if (!response.ok) return player

          const html = await response.text()

          // Extrahiere Namen aus der Profil-Seite
          // Pattern 1: <h1 class="headline">Vorname Nachname</h1>
          const h1Match = html.match(/<h1[^>]*class="[^"]*headline[^"]*"[^>]*>([^<]+)<\/h1>/i)
          if (h1Match) {
            let fullName = h1Match[1].trim()
              .replace(/\s*\([^)]+\)\s*$/, '')  // Entferne (Verein)
              .trim()

            if (fullName) {
              const parts = fullName.split(/\s+/)
              if (parts.length >= 2) {
                player.name = parts.pop() || ''
                player.vorname = parts.join(' ')
              } else {
                player.name = fullName
              }
              return player
            }
          }

          // Pattern 2: <title>Vorname Nachname (Verein) Spielerprofil | FUSSBALL.DE</title>
          const titleMatch = html.match(/<title>([^<]+)<\/title>/i)
          if (titleMatch) {
            // Title-Formate (KEIN Bindestrich vor Spielerprofil!):
            // "Max Müller (FC Beispiel) Spielerprofil | FUSSBALL.DE"
            // "Max Müller Basisprofil | FUSSBALL.DE"
            let fullName = titleMatch[1].trim()

            // 1. Entferne alles ab " | " (z.B. "| FUSSBALL.DE")
            fullName = fullName.split('|')[0].trim()

            // 2. Entferne "Spielerprofil" oder "Basisprofil" (mit oder ohne Bindestrich)
            fullName = fullName.replace(/\s*-?\s*(?:Spielerprofil|Basisprofil)\s*$/i, '').trim()

            // 3. Entferne Vereinsname in Klammern am Ende
            fullName = fullName.replace(/\s*\([^)]+\)\s*$/, '').trim()

            if (fullName && fullName.length > 1) {
              const parts = fullName.split(/\s+/)
              if (parts.length >= 2) {
                player.name = parts.pop() || ''
                player.vorname = parts.join(' ')
              } else {
                player.name = fullName
              }
              return player
            }
          }

          // Pattern 3: og:title meta tag (gleiche Logik wie Pattern 2)
          const ogMatch = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i)
          if (ogMatch) {
            let fullName = ogMatch[1].trim()
            fullName = fullName.split('|')[0].trim()
            fullName = fullName.replace(/\s*-?\s*(?:Spielerprofil|Basisprofil)\s*$/i, '').trim()
            fullName = fullName.replace(/\s*\([^)]+\)\s*$/, '').trim()

            if (fullName && fullName.length > 1) {
              const parts = fullName.split(/\s+/)
              if (parts.length >= 2) {
                player.name = parts.pop() || ''
                player.vorname = parts.join(' ')
              } else {
                player.name = fullName
              }
            }
          }

          return player
        } catch (err) {
          console.error('Error fetching profile:', player.profileUrl, err)
          return player
        }
      })
    )

    results.push(...batchResults)

    // Kleine Pause zwischen Batches um Rate-Limiting zu vermeiden
    if (i + BATCH_SIZE < players.length) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }

  return results
}
