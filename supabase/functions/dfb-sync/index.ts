// dfb-sync: DFB-Termine (U15–U21 Männer) + zugehörige Kader täglich von dfb.de
// abgleichen und in scouting_matches / scouting_lineups spiegeln.
//
// - Termine werden über einen stabilen source_key (Jahrgang|Startdatum|Titel)
//   angelegt bzw. aktualisiert (kein Löschen/Neuanlegen → IDs bleiben stabil,
//   Berichte/Notizen hängen weiter am richtigen Spiel).
// - Zukünftige DFB-Termine, die auf dfb.de verschwunden sind, werden gelöscht.
//   Vergangene bleiben als Archiv.
// - Kader (Datencenter-Tabelle oder PDF unter "Weitere Kader") werden dem/den
//   Termin(en) mit überlappendem Zeitraum zugeordnet und als Aufstellung (team
//   'home') gespeichert; Änderungen per Hash erkannt, Spieler per Name
//   abgeglichen (bestehende Zeilen bleiben erhalten → lineup_player_id stabil).
//
// Aufruf: POST /dfb-sync            → voller Lauf (Cron täglich)
//         GET  /dfb-sync?dry=1      → nur parsen, nichts schreiben
//         ?age=16                   → nur ein Jahrgang
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getDocumentProxy } from 'npm:unpdf@0.12.1'
import {
  AGES, termineUrl, teamUrl, parseTerminePage, parseTeamPage, kaderMatchesTermin,
  parsePeopleListHtml, parseKaderPdfItems, kaderHash,
  type DfbKaderPlayer, type DfbKaderSource, type DfbTermin, type PdfTextItem,
} from './parse.ts'

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

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': '*/*' } })
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`)
  return await r.text()
}
async function fetchJson(url: string): Promise<any> {
  return JSON.parse(await fetchText(url))
}

/** Kader-PDF → Spieler (Text-Items mit Koordinaten, Seiten per y-Offset getrennt) */
async function loadKaderPdf(url: string): Promise<DfbKaderPlayer[]> {
  const r = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`)
  const buf = new Uint8Array(await r.arrayBuffer())
  const doc = await getDocumentProxy(buf)
  const items: PdfTextItem[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const tc = await page.getTextContent()
    for (const it of tc.items as any[]) {
      if (typeof it.str !== 'string') continue
      items.push({ str: it.str, x: it.transform[4], y: it.transform[5] - p * 10000 })
    }
  }
  return parseKaderPdfItems(items)
}

async function loadKader(src: DfbKaderSource): Promise<DfbKaderPlayer[]> {
  if (src.kind === 'datencenter') return parsePeopleListHtml(await fetchText(src.url))
  return await loadKaderPdf(src.url)
}

const normName = (s: string) =>
  (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
const playerKey = (name: string, vorname: string) => `${normName(name)}|${normName(vorname)}`

/**
 * Aufstellung eines DFB-Termins mit dem Kader abgleichen:
 * vorhandene Spieler (gleicher Name) aktualisieren, neue einfügen, nur
 * DFB-stämmige Zeilen entfernen, die nicht mehr im Kader stehen.
 */
async function syncLineup(
  sb: SupabaseClient,
  matchId: string,
  players: DfbKaderPlayer[],
  jahrgang: string | null,
): Promise<{ inserted: number; updated: number; deleted: number }> {
  const { data: existing, error } = await sb
    .from('scouting_lineups')
    .select('id, name, vorname, source, club, nummer, is_goalkeeper, jahrgang, birth_date')
    .eq('match_id', matchId)
  if (error) throw error
  const byKey = new Map<string, any>()
  for (const row of existing || []) byKey.set(playerKey(row.name, row.vorname || ''), row)

  const seen = new Set<string>()
  const inserts: any[] = []
  let updated = 0
  for (const p of players) {
    const key = playerKey(p.name, p.vorname)
    if (seen.has(key)) continue
    seen.add(key)
    const ex = byKey.get(key)
    const birth = p.birthDate ? p.birthDate.split('.').reverse().join('-') : null
    if (ex) {
      const patch: any = {}
      if (p.club && ex.club !== p.club) patch.club = p.club
      if ((ex.nummer || null) !== (p.nummer || null)) patch.nummer = p.nummer
      if (p.isGoalkeeper !== !!ex.is_goalkeeper) patch.is_goalkeeper = p.isGoalkeeper
      if (!ex.jahrgang && jahrgang) patch.jahrgang = jahrgang
      if (!ex.birth_date && birth) patch.birth_date = birth
      if (!ex.source) patch.source = 'dfb'
      if (Object.keys(patch).length) {
        const { error: ue } = await sb.from('scouting_lineups').update(patch).eq('id', ex.id)
        if (ue) throw ue
        updated++
      }
    } else {
      inserts.push({
        match_id: matchId,
        team: 'home',
        is_starter: true,
        nummer: p.nummer,
        vorname: p.vorname || null,
        name: p.name,
        jahrgang,
        birth_date: birth,
        is_goalkeeper: p.isGoalkeeper,
        club: p.club,
        source: 'dfb',
      })
    }
  }
  if (inserts.length) {
    const { error: ie } = await sb.from('scouting_lineups').insert(inserts)
    if (ie) throw ie
  }
  const toDelete = (existing || [])
    .filter((r) => r.source === 'dfb' && !seen.has(playerKey(r.name, r.vorname || '')))
    .map((r) => r.id)
  if (toDelete.length) {
    const { error: de } = await sb.from('scouting_lineups').delete().in('id', toDelete)
    if (de) throw de
  }
  return { inserted: inserts.length, updated, deleted: toDelete.length }
}

function terminRow(t: DfbTermin) {
  return {
    home_team: t.homeTeam,
    away_team: t.awayTeam,
    match_date: t.start,
    match_date_end: t.end,
    match_time: t.time,
    age_group: t.age,
    match_type: 'Nationalmannschaft',
    location: t.location,
    source: 'dfb',
    source_key: t.sourceKey,
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const url = new URL(req.url)
  const dry = url.searchParams.get('dry') === '1'
  const onlyAge = url.searchParams.get('age') ? Number(url.searchParams.get('age')) : null
  const ages = onlyAge ? AGES.filter((a) => a === onlyAge) : [...AGES]
  const today = new Date().toISOString().slice(0, 10)

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const stats = {
    dry,
    ages: ages.map((a) => `U${a}`),
    termine: 0, inserted: 0, updated: 0, unchanged: 0, deleted: 0, legacyDeleted: 0,
    kaderAssigned: 0, kaderUnchanged: 0, lineups: { inserted: 0, updated: 0, deleted: 0 },
    errors: [] as string[],
    preview: [] as any[],
  }

  // Bestehende DFB-Termine (alle, auch vergangene → Kader-Hash & Update)
  const { data: existingRows, error: exErr } = await sb
    .from('scouting_matches')
    .select('id, source_key, match_date, kader_hash, home_team, away_team, match_date_end, match_time, location, age_group')
    .eq('source', 'dfb')
  if (exErr && !dry) return json({ error: exErr.message }, 500)
  if (exErr) stats.errors.push(`DB (dry, ignoriert): ${exErr.message}`)
  const existingByKey = new Map<string, any>()
  for (const r of existingRows || []) if (r.source_key) existingByKey.set(r.source_key, r)
  const seenKeys = new Set<string>()

  for (const age of ages) {
    try {
      const tp = parseTerminePage(age, await fetchJson(termineUrl(age)))
      let kaderSources: DfbKaderSource[] = []
      try {
        kaderSources = parseTeamPage(age, await fetchJson(teamUrl(age)), tp.seasonStartYear)
      } catch (e) {
        stats.errors.push(`U${age} Team-Seite: ${(e as Error).message}`)
      }
      const kaderCache = new Map<string, Promise<DfbKaderPlayer[]>>()
      const loadCached = (src: DfbKaderSource) => {
        if (!kaderCache.has(src.url)) kaderCache.set(src.url, loadKader(src))
        return kaderCache.get(src.url)!
      }

      for (const t of tp.termine) {
        stats.termine++
        seenKeys.add(t.sourceKey)
        const row = terminRow(t)
        const ex = existingByKey.get(t.sourceKey)

        // Passende Kader-Quelle: Datencenter (Profil-Links) vor PDF
        const srcs = kaderSources.filter((k) => kaderMatchesTermin(k, t))
        const src = srcs.find((k) => k.kind === 'datencenter') || srcs[0] || null

        if (dry) {
          // Trockenlauf lädt den Kader trotzdem (testet Datencenter/PDF-Parser), schreibt aber nichts
          let kaderCount: number | null = null
          if (src) {
            try { kaderCount = (await loadCached(src)).length }
            catch (e) { stats.errors.push(`U${age} Kader ${src.url}: ${(e as Error).message}`) }
          }
          stats.preview.push({ ...row, kader: src ? `${src.kind}: ${src.title}` : null, kaderCount, existing: !!ex })
          continue
        }

        let matchId: string | null = ex?.id || null
        if (ex) {
          const changed = ['home_team', 'away_team', 'match_date', 'match_date_end', 'match_time', 'location', 'age_group']
            .some((k) => (ex[k] ?? null) !== ((row as any)[k] ?? null))
          if (changed) {
            const { error } = await sb.from('scouting_matches')
              .update({ ...row, updated_at: new Date().toISOString() }).eq('id', ex.id)
            if (error) throw error
            stats.updated++
          } else stats.unchanged++
        } else {
          const { data, error } = await sb.from('scouting_matches')
            .insert({ ...row, is_archived: false }).select('id').single()
          if (error) throw error
          matchId = data.id
          stats.inserted++
        }

        if (src && matchId) {
          try {
            const players = await loadCached(src)
            if (players.length >= 5) {
              const hash = await kaderHash(players)
              if (ex?.kader_hash === hash) {
                stats.kaderUnchanged++
              } else {
                const r = await syncLineup(sb, matchId, players, tp.jahrgang)
                stats.lineups.inserted += r.inserted
                stats.lineups.updated += r.updated
                stats.lineups.deleted += r.deleted
                const { error } = await sb.from('scouting_matches')
                  .update({ kader_hash: hash, kader_source: src.url }).eq('id', matchId)
                if (error) throw error
                stats.kaderAssigned++
              }
            }
          } catch (e) {
            stats.errors.push(`U${age} Kader ${src.url}: ${(e as Error).message}`)
          }
        }
      }
    } catch (e) {
      stats.errors.push(`U${age}: ${(e as Error).message}`)
    }
  }

  if (!dry) {
    // Zukünftige DFB-Termine, die es auf dfb.de nicht mehr gibt → löschen
    // (nur für die tatsächlich verarbeiteten Jahrgänge und nur, wenn deren
    // Seite fehlerfrei geladen wurde — sonst würde ein Ausfall alles löschen)
    const failedAges = new Set(stats.errors.map((e) => e.match(/^U(\d+):/)?.[1]).filter(Boolean).map(Number))
    const stale = (existingRows || []).filter((r) =>
      r.source_key && !seenKeys.has(r.source_key) && r.match_date >= today &&
      ages.includes(Number(String(r.age_group || '').replace(/^U/, ''))) &&
      !failedAges.has(Number(String(r.age_group || '').replace(/^U/, ''))),
    )
    if (stale.length) {
      const { error } = await sb.from('scouting_matches').delete().in('id', stale.map((r) => r.id))
      if (error) stats.errors.push(`Löschen: ${error.message}`)
      else stats.deleted = stale.length
    }
    // Einmalige Bereinigung: alte, aus der statischen Liste angelegte
    // Nationalmannschafts-Termine (ohne source) in der Zukunft entfernen
    if (!onlyAge) {
      const { data: legacy, error } = await sb.from('scouting_matches')
        .select('id')
        .eq('match_type', 'Nationalmannschaft')
        .is('source', null)
        .gte('match_date', today)
      if (!error && legacy && legacy.length) {
        const { error: de } = await sb.from('scouting_matches').delete().in('id', legacy.map((r) => r.id))
        if (de) stats.errors.push(`Legacy-Löschen: ${de.message}`)
        else stats.legacyDeleted = legacy.length
      }
    }
  }

  return json(stats)
})
