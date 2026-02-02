// Supabase Edge Function: Lineup Vision
// Extrahiert Aufstellungen aus Bildern/PDFs mit Claude Vision API

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Claude API Konfiguration
const CLAUDE_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages'

interface ScrapedPlayer {
  nummer: string
  vorname: string
  name: string
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
  available: boolean
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { imageBase64, mimeType, homeTeamHint, awayTeamHint } = await req.json()

    if (!imageBase64) {
      return new Response(
        JSON.stringify({ success: false, error: 'imageBase64 is required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    if (!CLAUDE_API_KEY) {
      console.error('CLAUDE_API_KEY not configured')
      return new Response(
        JSON.stringify({ success: false, error: 'API key not configured' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      )
    }

    console.log('Processing image with Claude Vision...')
    console.log('MIME type:', mimeType)
    console.log('Home team hint:', homeTeamHint)
    console.log('Away team hint:', awayTeamHint)

    // Call Claude Vision API
    const lineupData = await extractLineupsWithVision(
      imageBase64,
      mimeType || 'image/jpeg',
      homeTeamHint,
      awayTeamHint
    )

    console.log('Extraction result:', JSON.stringify(lineupData, null, 2))

    return new Response(
      JSON.stringify({ success: true, data: lineupData }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ success: false, error: 'Vision processing error: ' + (error as Error).message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})

async function extractLineupsWithVision(
  imageBase64: string,
  mimeType: string,
  homeTeamHint?: string,
  awayTeamHint?: string
): Promise<ScrapedLineups> {

  const systemPrompt = `Du bist ein Experte für Fußball-Aufstellungen. Extrahiere die Spielerdaten aus dem Bild.

Gib die Daten als JSON in folgendem Format zurück:
{
  "homeTeam": "Vereinsname",
  "awayTeam": "Vereinsname",
  "homeStarters": [{ "nummer": "1", "vorname": "Max", "name": "Mustermann", "position": "TW", "jahrgang": "2008" }],
  "homeSubs": [...],
  "awayStarters": [...],
  "awaySubs": [],
  "available": true
}

Regeln:
- nummer: Trikotnummer, falls sichtbar (sonst leer)
- vorname und name: Trenne Vor- und Nachname korrekt. Bei nur einem Namen, setze ihn als "name" und lasse "vorname" leer
- position: TW, IV, LV, RV, ZM, LM, RM, ZOM, ST etc. (falls erkennbar, sonst leer)
- jahrgang: 4-stellige Jahreszahl (2008, 2009 etc.) falls sichtbar, sonst leer
- Starter = die ersten 11 Spieler jeder Mannschaft (oder alle wenn weniger)
- Subs = Ersatzspieler/Auswechselspieler (falls vorhanden)
- Wenn nur eine Mannschaft sichtbar ist, fülle nur diese (die andere bleibt leer)
- Bei unleserlichen Daten: setze das Feld auf leeren String
- Gib NUR das JSON zurück, ohne zusätzlichen Text oder Markdown-Formatierung`

  const userPrompt = homeTeamHint && awayTeamHint
    ? `Extrahiere die Aufstellung. Hinweis: Heimmannschaft ist "${homeTeamHint}", Auswärtsmannschaft ist "${awayTeamHint}".`
    : `Extrahiere die Aufstellung aus diesem Bild/Dokument.`

  // Determine media type for Claude API
  let mediaType = mimeType
  if (mimeType === 'application/pdf') {
    mediaType = 'application/pdf'
  } else if (!mimeType.startsWith('image/')) {
    mediaType = 'image/jpeg'
  }

  const response = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': CLAUDE_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: mediaType === 'application/pdf' ? 'document' : 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: imageBase64,
              },
            },
            {
              type: 'text',
              text: userPrompt,
            },
          ],
        },
      ],
      system: systemPrompt,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('Claude API error:', response.status, errorText)
    throw new Error(`Claude API error: ${response.status}`)
  }

  const result = await response.json()
  const textContent = result.content?.find((c: { type: string }) => c.type === 'text')?.text || ''

  console.log('Claude response:', textContent)

  // Parse JSON from response (handle markdown code blocks if present)
  let jsonStr = textContent.trim()

  // Remove markdown code blocks if present
  const jsonMatch = jsonStr.match(/```(?:json)?\n?([\s\S]*?)\n?```/)
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim()
  }

  // Try to find JSON object in the response
  const objectMatch = jsonStr.match(/\{[\s\S]*\}/)
  if (objectMatch) {
    jsonStr = objectMatch[0]
  }

  try {
    const parsed = JSON.parse(jsonStr)

    // Ensure all required fields exist
    return {
      homeTeam: parsed.homeTeam || homeTeamHint || '',
      awayTeam: parsed.awayTeam || awayTeamHint || '',
      homeStarters: Array.isArray(parsed.homeStarters) ? parsed.homeStarters : [],
      homeSubs: Array.isArray(parsed.homeSubs) ? parsed.homeSubs : [],
      awayStarters: Array.isArray(parsed.awayStarters) ? parsed.awayStarters : [],
      awaySubs: Array.isArray(parsed.awaySubs) ? parsed.awaySubs : [],
      available: parsed.available !== false,
    }
  } catch (parseError) {
    console.error('JSON parse error:', parseError, 'Raw:', jsonStr)

    // Return empty result on parse failure
    return {
      homeTeam: homeTeamHint || '',
      awayTeam: awayTeamHint || '',
      homeStarters: [],
      homeSubs: [],
      awayStarters: [],
      awaySubs: [],
      available: false,
    }
  }
}
