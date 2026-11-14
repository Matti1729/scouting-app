// player-details: Lädt on-demand Zusatzinfos zu einem Spieler von Transfermarkt
// - Transferhistorie (JSON-API von TM) -> letzter Verein + Datum/Saison
// - Einsätze aktuelle + letzte Saison (tmapi performance-game), aufgeschlüsselt nach Wettbewerb
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { denyUnlessAccess } from '../_shared/access.ts';

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

interface SeasonStats {
  games: number
  goals: number
  assists: number
}

/** Ein Wettbewerb einer Saison, z. B. "3. Liga · VfB Stuttgart II · 8 Spiele" (Pfeil im Spielerprofil) */
interface CompetitionStats extends SeasonStats {
  competitionId: string
  competition: string
  club: string | null
  national: boolean // Länderspiel (Mannschaft ist eine Nationalmannschaft)
}

interface SeasonPerformance {
  totals: Record<number, SeasonStats>
  // Saison -> "Wettbewerb|Verein" -> Werte
  byCompetition: Record<number, Map<string, SeasonStats & { competitionId: string; clubId: string | null }>>
}

/** Einsätze/Tore/Vorlagen pro Saison (gespielte Spiele) über die TM-Performance-API, auch je Wettbewerb */
async function fetchGamesBySeason(playerId: string): Promise<SeasonPerformance | null> {
  try {
    const r = await fetch(`https://tmapi.transfermarkt.technology/player/${playerId}/performance-game`, {
      headers: { ...FETCH_HEADERS, Accept: 'application/json' },
    })
    if (!r.ok) return null
    const j = await r.json()
    const perf: any[] = j?.data?.performance || []
    const totals: Record<number, SeasonStats> = {}
    const byCompetition: SeasonPerformance['byCompetition'] = {}
    for (const g of perf) {
      // Saison nach Spieldatum (Wechsel im Juli). TM führt Länderspiel-Wettbewerbe nach Kalenderjahr
      // (U19-EM-Quali März 2026 hat seasonId 2026), die gehören aber zur Saison 25/26 (Redzepi, Matti 2026-11-14)
      const date = g?.gameInformation?.date?.dateTimeUTC
      const d = date ? new Date(date) : null
      const sid = d && !isNaN(d.getTime())
        ? (d.getUTCMonth() + 1 >= 7 ? d.getUTCFullYear() : d.getUTCFullYear() - 1)
        : g?.gameInformation?.seasonId
      const state = g?.statistics?.generalStatistics?.participationState
      if (typeof sid === 'number' && state === 'played') {
        const goals = g?.statistics?.goalStatistics?.goalsScoredTotal || 0
        const assists = g?.statistics?.goalStatistics?.assists || 0
        const s = (totals[sid] ||= { games: 0, goals: 0, assists: 0 })
        s.games += 1
        s.goals += goals
        s.assists += assists
        const competitionId = String(g?.gameInformation?.competitionId || '?')
        const clubId = g?.clubsInformation?.club?.clubId ? String(g.clubsInformation.club.clubId) : null
        const comps = (byCompetition[sid] ||= new Map())
        const c = comps.get(`${competitionId}|${clubId}`) || { games: 0, goals: 0, assists: 0, competitionId, clubId }
        c.games += 1
        c.goals += goals
        c.assists += assists
        comps.set(`${competitionId}|${clubId}`, c)
      }
    }
    return { totals, byCompetition }
  } catch {
    return null
  }
}

// tmapi liefert internationale Wettbewerbe auch mit locale=de auf Englisch
const COMPETITION_NAMES: Record<string, string> = { L1: '1. Bundesliga', L2: '2. Bundesliga' }
function germanCompetitionName(id: string, shortName: string | null): string {
  if (COMPETITION_NAMES[id]) return COMPETITION_NAMES[id]
  if (!shortName) return id
  return shortName
    .replace(/^(U\d+) Euro qualification$/, '$1-EM-Qualifikation')
    .replace(/^European Qualifiers$/, 'EM-Qualifikation')
    .replace(/World Cup qualification/i, 'WM-Qualifikation')
    .replace(/^(International )?Friendlies$/, 'Testspiele')
    // kurz für eine Zeile: "U19 Nachwuchsliga - Gr. D" -> "U19 Nachwuchsliga", "... - Liga A" -> "... Liga A"
    .replace(/ - (Gr\.|Vorrunde Gruppe) \w+$/, '')
    .replace(/ - (Liga [AB])$/, ' $1')
    .replace(/^DFB-Pokal der Junioren$/, 'DFB-Pokal Junioren')
}

/** Namen für Wettbewerbe und Vereine der gezeigten Saisons (je ein Sammelabruf) */
async function namesFor(path: 'competitions' | 'clubs', ids: string[]): Promise<Map<string, any>> {
  const out = new Map<string, any>()
  if (ids.length === 0) return out
  try {
    const q = ids.map((id) => `ids[]=${encodeURIComponent(id)}`).join('&')
    const r = await fetch(`https://tmapi.transfermarkt.technology/${path}?${q}&locale=de`, {
      headers: { ...FETCH_HEADERS, Accept: 'application/json' },
    })
    if (!r.ok) return out
    const j = await r.json()
    for (const item of j?.data || []) out.set(String(item.id), item)
  } catch {
    // ohne Namen geht es mit der Kennung weiter
  }
  return out
}

async function competitionBreakdown(perf: SeasonPerformance, seasons: number[]): Promise<Record<number, CompetitionStats[]>> {
  const entries = seasons.flatMap((sid) => [...(perf.byCompetition[sid]?.values() || [])])
  const [comps, clubs] = await Promise.all([
    namesFor('competitions', [...new Set(entries.map((e) => e.competitionId))]),
    namesFor('clubs', [...new Set(entries.map((e) => e.clubId).filter(Boolean) as string[])]),
  ])
  const out: Record<number, CompetitionStats[]> = {}
  for (const sid of seasons) {
    out[sid] = [...(perf.byCompetition[sid]?.values() || [])]
      .map((e) => ({
        competitionId: e.competitionId,
        competition: germanCompetitionName(e.competitionId, comps.get(e.competitionId)?.shortName ?? comps.get(e.competitionId)?.name ?? null),
        // "VfB Stuttgart UEFA U19" (Youth-League-Mannschaft) -> "VfB Stuttgart U19"
        club: e.clubId ? clubs.get(e.clubId)?.name?.replace(/ UEFA (?=U\d+)/, ' ') ?? null : null,
        national: !!(e.clubId && clubs.get(e.clubId)?.baseDetails?.isNationalTeam),
        games: e.games,
        goals: e.goals,
        assists: e.assists,
      }))
      .sort((a, b) => b.games - a.games || b.goals - a.goals)
  }
  return out
}

interface NationalTeamInfo {
  name: string
  countryId: number | null
}

/** Aktueller Verein (clubAssignment type=current), deutscher Name via locale=de */
async function fetchCurrentClub(playerId: string): Promise<string | null> {
  try {
    const r = await fetch(`https://tmapi.transfermarkt.technology/player/${playerId}`, {
      headers: { ...FETCH_HEADERS, Accept: 'application/json' },
    })
    if (!r.ok) return null
    const j = await r.json()
    const assignments: any[] = j?.data?.clubAssignments || []
    const cur = assignments.find((a) => a?.type === 'current')
    if (!cur?.clubId) return null
    const rc = await fetch(`https://tmapi.transfermarkt.technology/club/${cur.clubId}?locale=de`, {
      headers: { ...FETCH_HEADERS, Accept: 'application/json' },
    })
    if (!rc.ok) return null
    const jc = await rc.json()
    return jc?.data?.name || null
  } catch {
    return null
  }
}

/** Aktuelle Nationalmannschaft (clubAssignment type=nationalTeam) inkl. Land */
async function fetchNationalTeam(playerId: string): Promise<NationalTeamInfo | null> {
  // 1) TM-API: clubAssignment type=nationalTeam — fehlt allerdings bei
  //    manchen Jugendnationalspielern, dann greift der Seiten-Fallback
  try {
    const r = await fetch(`https://tmapi.transfermarkt.technology/player/${playerId}`, {
      headers: { ...FETCH_HEADERS, Accept: 'application/json' },
    })
    if (r.ok) {
      const j = await r.json()
      const assignments: any[] = j?.data?.clubAssignments || []
      const nat = assignments.filter((a) => a?.type === 'nationalTeam').pop()
      if (nat?.clubId) {
        // locale=de: deutsche Teamnamen ("Deutschland U16" statt "Germany U16")
        const rc = await fetch(`https://tmapi.transfermarkt.technology/club/${nat.clubId}?locale=de`, {
          headers: { ...FETCH_HEADERS, Accept: 'application/json' },
        })
        if (rc.ok) {
          const jc = await rc.json()
          const name = jc?.data?.name
          if (name) return { name, countryId: jc?.data?.baseDetails?.countryId ?? null }
        }
      }
    }
  } catch {
    // weiter zum Seiten-Fallback
  }

  // 2) Fallback: Profilseite ("Nationalspieler:" im Kopfbereich)
  try {
    const r = await fetch(`https://www.transfermarkt.de/-/profil/spieler/${playerId}`, {
      headers: FETCH_HEADERS,
    })
    if (!r.ok) return null
    const html = await r.text()
    const idx = html.indexOf('Nationalspieler:')
    if (idx < 0) return null
    // "Ehem. Nationalspieler:" = kein AKTUELLER Nationalspieler
    if (/Ehem\.\s*$/.test(html.slice(Math.max(0, idx - 20), idx))) return null
    const seg = html.slice(idx, idx + 800)
    const nameMatch = seg.match(/<a[^>]*href="[^"]*\/verein\/\d+"[^>]*>([^<]+)<\/a>/)
    if (!nameMatch) return null
    const flagMatch = seg.match(/\/flagge\/\w+\/(\d+)\.png/)
    return { name: nameMatch[1].trim(), countryId: flagMatch ? parseInt(flagMatch[1], 10) : null }
  } catch {
    return null
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const denied = await denyUnlessAccess(req, corsHeaders, 'staff');
  if (denied) return denied;

  try {
    const { playerId } = await req.json()
    if (!playerId || !/^\d+$/.test(String(playerId))) {
      return json({ success: false, error: 'playerId fehlt oder ungültig' })
    }
    const pid = String(playerId)

    // Aktuelle TM-Saison: ab Juli zählt das laufende Jahr als Saisonstart
    const now = new Date()
    const seasonYear = now.getMonth() + 1 >= 7 ? now.getFullYear() : now.getFullYear() - 1

    const [transfers, gamesBySeason, nationalTeam, currentClub] = await Promise.all([
      fetchTransfers(pid),
      fetchGamesBySeason(pid),
      fetchNationalTeam(pid),
      fetchCurrentClub(pid),
    ])

    const cur = gamesBySeason ? gamesBySeason.totals[seasonYear] : null
    const last = gamesBySeason ? gamesBySeason.totals[seasonYear - 1] : null
    const breakdown = gamesBySeason ? await competitionBreakdown(gamesBySeason, [seasonYear, seasonYear - 1]) : null
    return json({
      success: true,
      seasonYear,
      gamesCurrentSeason: gamesBySeason ? cur?.games || 0 : null,
      gamesLastSeason: gamesBySeason ? last?.games || 0 : null,
      statsCurrentSeason: gamesBySeason ? cur || { games: 0, goals: 0, assists: 0 } : null,
      statsLastSeason: gamesBySeason ? last || { games: 0, goals: 0, assists: 0 } : null,
      competitionsCurrentSeason: breakdown ? breakdown[seasonYear] : null,
      competitionsLastSeason: breakdown ? breakdown[seasonYear - 1] : null,
      transfers,
      nationalTeam,
      currentClub,
    })
  } catch (e) {
    return json({ success: false, error: String(e) }, 200)
  }
})
