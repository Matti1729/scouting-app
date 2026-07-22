// player-details: Lädt on-demand Zusatzinfos zu einem Spieler von Transfermarkt
// - Transferhistorie (JSON-API von TM) -> letzter Verein + Datum/Saison
// - Einsätze aktuelle + letzte Saison (aus der Leistungsdaten-Seite)
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  'Accept-Language': 'de-DE,de;q=0.9',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  })
}

interface TransferInfo {
  season: string | null
  date: string | null // "DD.MM.YYYY"
  from: string | null
  to: string | null
}

async function fetchTransfers(playerId: string): Promise<TransferInfo[]> {
  try {
    const r = await fetch(`https://www.transfermarkt.de/ceapi/transferHistory/list/${playerId}`, {
      headers: { ...FETCH_HEADERS, Accept: 'application/json' },
    })
    if (!r.ok) return []
    const j = await r.json()
    const raw = j?.transfers || []
    return raw.map((t: any) => ({
      season: t?.season ?? null,
      date: t?.date ?? t?.dateUnformatted ?? null,
      from: t?.from?.clubName ?? null,
      to: t?.to?.clubName ?? null,
    }))
  } catch {
    return []
  }
}

/** Einsätze pro Saison (gespielte Spiele) über die TM-Performance-API */
async function fetchGamesBySeason(playerId: string): Promise<Record<number, number> | null> {
  try {
    const r = await fetch(`https://tmapi.transfermarkt.technology/player/${playerId}/performance-game`, {
      headers: { ...FETCH_HEADERS, Accept: 'application/json' },
    })
    if (!r.ok) return null
    const j = await r.json()
    const perf: any[] = j?.data?.performance || []
    const played: Record<number, number> = {}
    for (const g of perf) {
      const sid = g?.gameInformation?.seasonId
      const state = g?.statistics?.generalStatistics?.participationState
      if (typeof sid === 'number' && state === 'played') {
        played[sid] = (played[sid] || 0) + 1
      }
    }
    return played
  } catch {
    return null
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { playerId } = await req.json()
    if (!playerId || !/^\d+$/.test(String(playerId))) {
      return json({ success: false, error: 'playerId fehlt oder ungültig' })
    }
    const pid = String(playerId)

    // Aktuelle TM-Saison: ab Juli zählt das laufende Jahr als Saisonstart
    const now = new Date()
    const seasonYear = now.getMonth() + 1 >= 7 ? now.getFullYear() : now.getFullYear() - 1

    const [transfers, gamesBySeason] = await Promise.all([
      fetchTransfers(pid),
      fetchGamesBySeason(pid),
    ])

    return json({
      success: true,
      seasonYear,
      gamesCurrentSeason: gamesBySeason ? gamesBySeason[seasonYear] || 0 : null,
      gamesLastSeason: gamesBySeason ? gamesBySeason[seasonYear - 1] || 0 : null,
      transfers,
    })
  } catch (e) {
    return json({ success: false, error: String(e) }, 200)
  }
})
