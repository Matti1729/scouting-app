// resolve-game-venue: Spielstätte (Name + Adresse) von einer fussball.de-
// Spielseite holen — on-demand für Umgebungs-Spiele, deren Adresse der
// nächtliche KMH-Sync (Budget-begrenzt) noch nicht aufgelöst hat.
// Gleiche Extraktionslogik wie sync-area-games/fetchGameVenue.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { game_url } = await req.json()
    if (!game_url || !/^https:\/\/www\.fussball\.de\/spiel\//.test(String(game_url))) {
      return json({ success: false, error: 'game_url (fussball.de/spiel/...) erforderlich' }, 400)
    }

    const resp = await fetch(game_url, {
      headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'de-DE,de;q=0.9' },
    })
    if (!resp.ok) {
      return json({ success: false, error: `HTTP ${resp.status}` }, 502)
    }
    const html = await resp.text()

    // Spielstätten-Block trägt einen fertigen google.de/maps-Link
    const m = html.match(/google\.de\/maps\?q=([^"&]+)"[^>]*>\s*([\s\S]{0,200}?)</)
    if (!m) {
      return json({ success: true, venue: null, address: null })
    }
    const address = decodeURIComponent(m[1].replace(/\+/g, ' ')).replace(/\s+/g, ' ').trim()
    const venue = m[2].replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().replace(/\s*,$/, '') || null
    return json({ success: true, venue, address })
  } catch (e) {
    console.error('resolve-game-venue error:', e)
    return json({ success: false, error: String(e) }, 500)
  }
})
