// Supabase Edge Function: Berater-Scan
// Prüft die Kader der überwachten Vereine auf Beraterstatus-Änderungen.
// Quelle ist die Transfermarkt-Schnittstelle (tmapi), nicht die HTML-Seiten: Die antworten Servern
// mit 405, und sie bräuchten je Spieler einen Abruf. Nur bootstrap_clubs liest noch eine HTML-Seite.
// Aktionen: bootstrap_clubs, scan_club, scan_next_batch, get_status

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { denyUnlessAccess } from '../_shared/access.ts';

// ============================================================================
// KONFIGURATION
// ============================================================================

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
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

// Delay zwischen Profil-Requests: moderat ~1.5-2s + ±0.4s Jitter
function getRequestDelay(): number {
  const base = 1500 + Math.random() * 500 // 1500-2000ms
  const jitter = (Math.random() - 0.5) * 800 // ±400ms
  return Math.max(1100, base + jitter)
}

// Delay zwischen Vereinen: 5-10s
function getClubDelay(): number {
  return 5000 + Math.random() * 5000
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
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
// GLOCKEN-ALARM (Abo auf Beraterstatus-Änderung eines Spielers)
// ============================================================================

/** Telegram-Nachricht über den Magnus-Bot (Token/Empfänger = Projekt-Secrets) */
async function sendAgentAlertTelegram(playerName: string, oldAgent: string | null, newAgent: string | null) {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN')
  const users = (Deno.env.get('TELEGRAM_ALLOWED_USERS') || '')
    .split(',').map((s) => s.trim()).filter(Boolean)
  if (!token || users.length === 0) return
  const text =
    `🔔 Scouting-App: Bei ${playerName} hat sich der Beraterstatus geändert.\n` +
    `${oldAgent || 'kein Berater'} → ${newAgent || 'kein Berater'}`
  for (const chatId of users) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: Number(chatId), text }),
    }).catch((e) => console.log('Telegram alert failed:', e))
  }
}

/** Falls der Spieler eine Glocke (Abo) hat: In-App-Notification + Telegram */
async function fireAgentAlert(
  supabase: any,
  playerId: string,
  playerName: string,
  oldAgent: string | null,
  newAgent: string | null
) {
  try {
    const { data: sub } = await supabase
      .from('berater_alert_subs')
      .select('id')
      .eq('player_id', playerId)
      .maybeSingle()
    if (!sub) return
    await supabase.from('berater_alert_notifications').insert({
      player_id: playerId,
      player_name: playerName,
      message: `Bei ${playerName} hat sich der Beraterstatus geändert.`,
    })
    await sendAgentAlertTelegram(playerName, oldAgent, newAgent)
    console.log(`ALERT fired for ${playerName}`)
  } catch (e) {
    console.log('Agent alert error:', e)
  }
}

// ============================================================================
// TYPES
// ============================================================================

interface AgentInfo {
  fullName: string | null   // echter Spielername (mit Diakritika)
  agentName: string | null
  agentCompany: string | null
  agentUrl: string | null
  birthDate: string | null
  isRetired: boolean
  currentClubId: string | null  // Transfermarkt-Vereinsnummer, null bei vereinslos/Karriereende
  marketValue: string | null
  contractUntil: string | null  // ISO "YYYY-MM-DD"
  position: string | null      // z.B. "Mittelfeld - Offensives Mittelfeld"
}

interface SquadPlayer {
  name: string
  tmPlayerId: string
  profileUrl: string
  position?: string
}

// ============================================================================
// HTML PARSING - Berater-Info von Profilseite
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

async function fetchWithRetry(url: string, maxRetries = 3): Promise<Response | null> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: getBrowserHeaders(),
      })

      if (response.status === 429) {
        const backoff = Math.pow(2, attempt) * 5000 // 5s, 10s, 20s
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

const TM_API = 'https://tmapi.transfermarkt.technology'
const CLUB_VEREINSLOS = '515'
const CLUB_KARRIEREENDE = '123'

const POSITIONS: Record<string, string> = {
  'Goalkeeper': 'Torwart',
  'Centre-Back': 'Abwehr - Innenverteidiger',
  'Left-Back': 'Abwehr - Linker Verteidiger',
  'Right-Back': 'Abwehr - Rechter Verteidiger',
  'Defensive Midfield': 'Mittelfeld - Defensives Mittelfeld',
  'Central Midfield': 'Mittelfeld - Zentrales Mittelfeld',
  'Attacking Midfield': 'Mittelfeld - Offensives Mittelfeld',
  'Left Midfield': 'Mittelfeld - Linkes Mittelfeld',
  'Right Midfield': 'Mittelfeld - Rechtes Mittelfeld',
  'Left Winger': 'Sturm - Linksaußen',
  'Right Winger': 'Sturm - Rechtsaußen',
  'Centre-Forward': 'Sturm - Mittelstürmer',
  'Second Striker': 'Sturm - Hängende Spitze',
}
const POSITION_GROUPS: Record<string, string> = {
  GOALKEEPER: 'Torwart', DEFENDER: 'Abwehr', MIDFIELDER: 'Mittelfeld', FORWARD: 'Sturm',
}

const NO_DATA: AgentInfo = {
  fullName: null, agentName: null, agentCompany: null, agentUrl: null, birthDate: null,
  isRetired: false, currentClubId: null, marketValue: null, contractUntil: null, position: null,
}

async function tmApi(path: string): Promise<any> {
  let lastError = ''
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(attempt * 3000)
    try {
      const r = await fetch(`${TM_API}/${path}`, {
        headers: { 'User-Agent': getRandomUserAgent(), Accept: 'application/json' },
      })
      if (r.ok) {
        const j = await r.json()
        if (j?.success) return j.data
        lastError = j?.message || 'keine Daten'
      } else {
        lastError = `HTTP ${r.status}`
      }
    } catch (error) {
      lastError = String(error)
    }
  }
  throw new Error(`Transfermarkt-Schnittstelle ${path.split('?')[0]}: ${lastError}`)
}

function formatMarketValue(value: number | null | undefined): string | null {
  if (!value) return null
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2).replace('.', ',')} Mio. €`
  return `${Math.round(value / 1000)} Tsd. €`
}

function toAgentInfo(p: any): AgentInfo {
  const ag = p.attributes?.consultantAgency
  // Sonderfälle (Familienangehörige, ohne Berater) tragen den deutschen Text im shortName
  const agentName = (ag?.isSpecialConsultantAgency ? ag?.shortName : ag?.name)?.trim() || null
  const clubId = (p.clubAssignments || []).find((c: any) => c.type === 'current')?.clubId?.toString() ?? null
  const dob = (p.lifeDates?.dateOfBirth || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return {
    fullName: p.name || null,
    agentName: agentName || 'kein Beratereintrag',
    agentCompany: agentName,
    agentUrl: ag?.relativeUrl ? `https://www.transfermarkt.de${ag.relativeUrl}` : null,
    birthDate: dob ? `${dob[3]}.${dob[2]}.${dob[1]}` : null,
    isRetired: clubId === CLUB_KARRIEREENDE,
    currentClubId: clubId && clubId !== CLUB_VEREINSLOS && clubId !== CLUB_KARRIEREENDE ? clubId : null,
    marketValue: formatMarketValue(p.marketValueDetails?.current?.value),
    contractUntil: p.attributes?.contractUntil || null,
    position: POSITIONS[p.attributes?.position?.name] || POSITION_GROUPS[p.attributes?.positionGroup] || null,
  }
}

async function fetchSquadIds(tmClubId: string): Promise<string[]> {
  const data = await tmApi(`club/${tmClubId}/squad?locale=de`)
  return [...new Set<string>((data?.squad || []).map((s: any) => String(s.playerId)))]
}

/** Spielerdaten gesammelt abrufen (ein Abruf je 50 Spieler) */
async function fetchPlayers(tmPlayerIds: string[]): Promise<Map<string, any>> {
  const players = new Map<string, any>()
  for (let i = 0; i < tmPlayerIds.length; i += 50) {
    const query = tmPlayerIds.slice(i, i + 50).map((id) => `ids[]=${id}`).join('&')
    for (const p of (await tmApi(`players?locale=de&${query}`)) || []) players.set(String(p.id), p)
  }
  return players
}

// ============================================================================
// WETTBEWERBSSEITE PARSEN (nur bootstrap_clubs)
// ============================================================================

/**
 * Extrahiert Vereins-Links von einer TM-Wettbewerbsseite.
 * Gibt Club-IDs und Namen zurück.
 */
function parseCompetitionPage(html: string): Array<{ tmClubId: string; clubName: string; squadUrl: string }> {
  const clubs: Array<{ tmClubId: string; clubName: string; squadUrl: string }> = []
  const seenIds = new Set<string>()

  // Pattern: Vereins-Links auf Wettbewerbsseiten
  // href="/fc-bayern-munchen/startseite/verein/27" oder /kader/verein/27
  const clubPattern = /href="\/([^\/]+)\/(?:startseite|kader)\/verein\/(\d+)(?:\/saison_id\/\d+)?"/gi

  for (const match of html.matchAll(clubPattern)) {
    const urlSlug = match[1]
    const tmClubId = match[2]

    if (seenIds.has(tmClubId)) continue
    seenIds.add(tmClubId)

    // Vereinsname aus URL-Slug (Backup, wird durch title-Attribut ersetzt wenn möglich)
    let clubName = urlSlug.replace(/-/g, ' ')
      .split(' ')
      .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')

    // Versuche besseren Namen aus title-Attribut zu finden
    const titlePattern = new RegExp(`title="([^"]+)"[^>]*href="/${urlSlug}/(?:startseite|kader)/verein/${tmClubId}`, 'i')
    const titleMatch = html.match(titlePattern)
    if (titleMatch) {
      clubName = decodeHtmlEntities(titleMatch[1])
    } else {
      // Alternativ: title nach href
      const titleAfterPattern = new RegExp(`href="/${urlSlug}/(?:startseite|kader)/verein/${tmClubId}[^"]*"[^>]*title="([^"]+)"`, 'i')
      const titleAfterMatch = html.match(titleAfterPattern)
      if (titleAfterMatch) {
        clubName = decodeHtmlEntities(titleAfterMatch[1])
      }
    }

    const squadUrl = `https://www.transfermarkt.de/${urlSlug}/kader/verein/${tmClubId}`

    clubs.push({ tmClubId, clubName, squadUrl })
  }

  return clubs
}

// ============================================================================
// NORMALISIERUNG
// ============================================================================

function normalizeAgentName(name: string | null | undefined): string | null {
  if (!name) return null
  const trimmed = name.trim()
  if (!trimmed || trimmed === '-' || trimmed === '---' || trimmed === 'kein Beratereintrag' || trimmed === 'ohne Berater') {
    return null
  }
  return trimmed
}

/** "Berater bekannt - Spieler unter 16": TM versteckt den Berater auf der
 *  Profilseite, die TM-API liefert ihn aber trotzdem (consultantAgency). */
async function resolveHiddenU16Agent(
  tmPlayerId: string
): Promise<{ name: string; company: string; url: string | null } | null> {
  try {
    const r = await fetch(`https://tmapi.transfermarkt.technology/player/${tmPlayerId}?locale=de`, {
      headers: { 'User-Agent': getRandomUserAgent(), Accept: 'application/json' },
    })
    if (!r.ok) return null
    const j = await r.json()
    const ag = j?.data?.attributes?.consultantAgency
    // shortName bevorzugen: bei Sonderfällen deutsch ("Familienangehörige" statt "Relatives")
    const name = (ag?.shortName || ag?.name || '').trim()
    if (!name) return null
    return {
      name,
      company: name,
      url: ag?.relativeUrl ? `https://www.transfermarkt.de${ag.relativeUrl}` : null,
    }
  } catch {
    return null
  }
}

function agentsAreDifferent(oldName: string | null, newName: string | null): boolean {
  const normalizedOld = normalizeAgentName(oldName)
  const normalizedNew = normalizeAgentName(newName)

  // Beide null/leer → kein Wechsel
  if (!normalizedOld && !normalizedNew) return false

  // Alter Eintrag war der U16-Platzhalter → wir erfahren nur den schon
  // vorhandenen Berater, das ist KEIN Beraterwechsel
  if (/spieler unter 16/i.test(oldName || '')) return false

  // Einer null, anderer nicht → Wechsel
  if (!normalizedOld || !normalizedNew) return true

  const oldLower = normalizedOld.toLowerCase()
  const newLower = normalizedNew.toLowerCase()

  // Abgekürzte Namen erkennen ("Funke ..." == "Funke Spielerberatung")
  if (oldLower.endsWith('...')) {
    const prefix = oldLower.slice(0, -3).trim()
    if (prefix && newLower.startsWith(prefix)) return false
  }
  if (newLower.endsWith('...')) {
    const prefix = newLower.slice(0, -3).trim()
    if (prefix && oldLower.startsWith(prefix)) return false
  }

  return oldLower !== newLower
}

/** Gleiche Berater-ID in beiden TM-URLs? Dann hat sich nur die Agentur
 *  umbenannt (z.B. Wasserman -> THE·TEAM, beide /berater/440) — kein Wechsel. */
function sameAgencyId(oldUrl: string | null, newUrl: string | null): boolean {
  const idOld = oldUrl?.match(/\/berater\/(\d+)/)?.[1]
  const idNew = newUrl?.match(/\/berater\/(\d+)/)?.[1]
  return !!idOld && !!idNew && idOld === idNew
}

// ============================================================================
// AKTION: bootstrap_clubs
// ============================================================================

async function bootstrapClubs(supabase: ReturnType<typeof createClient>): Promise<{ clubsAdded: number; clubsDeactivated: number; leagues: number }> {
  // Lade alle aktiven Ligen
  const { data: leagues, error: leagueError } = await supabase
    .from('berater_leagues')
    .select('*')
    .eq('is_active', true)

  if (leagueError || !leagues) {
    throw new Error(`Failed to load leagues: ${leagueError?.message}`)
  }

  console.log(`Bootstrapping clubs for ${leagues.length} active leagues...`)

  let totalAdded = 0
  let totalDeactivated = 0

  for (const league of leagues) {
    console.log(`Processing league: ${league.name} (${league.id})`)

    await sleep(getRequestDelay())

    const response = await fetchWithRetry(league.tm_competition_url)
    if (!response || !response.ok) {
      console.error(`Failed to fetch league page for ${league.id}: ${response?.status}`)
      continue
    }

    const html = await response.text()
    const foundClubs = parseCompetitionPage(html)

    console.log(`Found ${foundClubs.length} clubs in ${league.name}`)

    if (foundClubs.length === 0) {
      console.warn(`No clubs found for ${league.id} - skipping deactivation`)
      continue
    }

    const foundClubIds = new Set(foundClubs.map(c => c.tmClubId))

    // Upsert gefundene Vereine
    for (const club of foundClubs) {
      const { error } = await supabase
        .from('berater_clubs')
        .upsert({
          league_id: league.id,
          tm_club_id: club.tmClubId,
          club_name: club.clubName,
          tm_squad_url: club.squadUrl,
          is_active: true,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'tm_club_id' })

      if (error) {
        console.error(`Failed to upsert club ${club.clubName}:`, error.message)
      } else {
        totalAdded++
      }
    }

    // Vereine die nicht mehr in der Liga sind → deaktivieren (Abstieg)
    const { data: existingClubs } = await supabase
      .from('berater_clubs')
      .select('id, tm_club_id, club_name')
      .eq('league_id', league.id)
      .eq('is_active', true)

    if (existingClubs) {
      for (const existing of existingClubs) {
        if (!foundClubIds.has(existing.tm_club_id)) {
          console.log(`Deactivating club (not in league anymore): ${existing.club_name}`)
          await supabase
            .from('berater_clubs')
            .update({ is_active: false, updated_at: new Date().toISOString() })
            .eq('id', existing.id)
          totalDeactivated++
        }
      }
    }
  }

  // Update total_clubs in scan_state
  const { count } = await supabase
    .from('berater_clubs')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)

  await supabase
    .from('berater_scan_state')
    .update({ total_clubs: count || 0, updated_at: new Date().toISOString() })
    .eq('id', 1)

  return { clubsAdded: totalAdded, clubsDeactivated: totalDeactivated, leagues: leagues.length }
}

// ============================================================================
// AKTION: scan_club
// ============================================================================

async function scanClub(supabase: ReturnType<typeof createClient>, clubId: string): Promise<{
  playersScanned: number
  changesDetected: number
  newPlayers: number
  deactivated: number
  clubName: string
  skipped?: boolean
}> {
  // Club laden
  const { data: club, error: clubError } = await supabase
    .from('berater_clubs')
    .select('*')
    .eq('id', clubId)
    .single()

  if (clubError || !club) {
    throw new Error(`Club not found: ${clubId}`)
  }

  console.log(`Scanning club: ${club.club_name} (TM ID: ${club.tm_club_id})`)

  const squadIds = await fetchSquadIds(club.tm_club_id)
  console.log(`Found ${squadIds.length} players in squad of ${club.club_name}`)

  // Schutz: Bei (fast) leerem Kader nicht weitermachen, sonst würde unten der ganze
  // Kader als vereinslos markiert. Legitim in der Sommerpause, vor allem bei Jugendteams.
  if (squadIds.length < 5) {
    console.log(`Skipping ${club.club_name}: only ${squadIds.length} players listed`)
    return {
      playersScanned: squadIds.length,
      changesDetected: 0,
      newPlayers: 0,
      deactivated: 0,
      clubName: club.club_name,
      skipped: true,
    }
  }

  const apiPlayers = await fetchPlayers(squadIds)
  const squadPlayers: SquadPlayer[] = squadIds.map((id) => {
    const p = apiPlayers.get(id)
    return {
      name: p?.name || id,
      tmPlayerId: id,
      profileUrl: `https://www.transfermarkt.de${p?.relativeUrl || `/x/profil/spieler/${id}`}`,
    }
  })

  let changesDetected = 0
  let newPlayers = 0
  const scannedPlayerIds = new Set<string>()

  // Pro Spieler: Profil laden, Berater extrahieren, vergleichen
  for (let i = 0; i < squadPlayers.length; i++) {
    const sp = squadPlayers[i]
    scannedPlayerIds.add(sp.tmPlayerId)

    console.log(`[${i + 1}/${squadPlayers.length}] Scanning: ${sp.name}`)

    const apiPlayer = apiPlayers.get(sp.tmPlayerId)
    const agentInfo = apiPlayer ? toAgentInfo(apiPlayer) : NO_DATA

    // Spieler existiert bereits in DB?
    const { data: existingPlayer } = await supabase
      .from('berater_players')
      .select('*')
      .eq('tm_player_id', sp.tmPlayerId)
      .maybeSingle()

    // Fix 1: Skip player if fetch/parse failed — don't treat as agent change
    if (agentInfo.agentName === null) {
      console.log(`SKIPPED ${sp.name}: fetch/parse failed, keeping existing data`)
      if (existingPlayer) {
        await supabase.from('berater_players').update({
          last_scanned_at: new Date().toISOString(),
        }).eq('id', existingPlayer.id)
      }
      continue
    }

    // Karriereende erkannt → Spieler deaktivieren
    if (agentInfo.isRetired) {
      console.log(`RETIRED ${sp.name}: Karriereende erkannt, deaktiviere Spieler`)
      if (existingPlayer) {
        await supabase.from('berater_players').update({
          is_active: false,
          last_scanned_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', existingPlayer.id)
      }
      continue
    }

    const hasAgent = !!(agentInfo.agentName && agentInfo.agentName !== 'kein Beratereintrag')
    const now = new Date().toISOString()

    if (existingPlayer) {
      // Spieler existiert → Update + Change-Detection
      const wasAlreadyScanned = !!existingPlayer.agent_updated_at

      // Prüfe auf Beraterwechsel (nur wenn vorher schon gescannt)
      if (
        wasAlreadyScanned &&
        agentsAreDifferent(existingPlayer.current_agent_name, agentInfo.agentName) &&
        !sameAgencyId(existingPlayer.agent_url, agentInfo.agentUrl)
      ) {
        const oldHadRealAgent = !!normalizeAgentName(existingPlayer.current_agent_name)
        const newHasNoAgent = !normalizeAgentName(agentInfo.agentName)

        // Fix 3: Bestätigungslogik für Berater-Verlust
        // Wenn alter Berater vorhanden war und jetzt "kein Berater" gescannt wird:
        // Erst beim zweiten Scan bestätigen, um false-positives zu vermeiden
        if (oldHadRealAgent && newHasNoAgent && !existingPlayer.pending_agent_removal) {
          console.log(`PENDING REMOVAL for ${sp.name}: "${existingPlayer.current_agent_name}" → "${agentInfo.agentName}" (awaiting confirmation)`)
          await supabase.from('berater_players').update({
            pending_agent_removal: now,
            last_scanned_at: now,
            updated_at: now,
          }).eq('id', existingPlayer.id)
          continue
        }

        if (oldHadRealAgent && newHasNoAgent && existingPlayer.pending_agent_removal) {
          console.log(`CONFIRMED REMOVAL for ${sp.name}: "${existingPlayer.current_agent_name}" → "${agentInfo.agentName}" (pending since ${existingPlayer.pending_agent_removal})`)
        } else {
          console.log(`CHANGE DETECTED for ${sp.name}: "${existingPlayer.current_agent_name}" → "${agentInfo.agentName}"`)
        }

        // Change loggen
        const { data: leagueData } = await supabase
          .from('berater_clubs')
          .select('league_id')
          .eq('id', clubId)
          .single()

        await supabase
          .from('berater_changes')
          .insert({
            player_id: existingPlayer.id,
            previous_agent_name: existingPlayer.current_agent_name,
            previous_agent_company: existingPlayer.current_agent_company,
            new_agent_name: agentInfo.agentName,
            new_agent_company: agentInfo.agentCompany,
            player_name: sp.name,
            club_name: club.club_name,
            league_id: leagueData?.league_id || club.league_id,
            birth_date: agentInfo.birthDate || existingPlayer.birth_date,
            tm_profile_url: sp.profileUrl,
          })

        // Glocken-Abo: In-App-Benachrichtigung + Telegram über Magnus
        await fireAgentAlert(
          supabase,
          existingPlayer.id,
          sp.name,
          existingPlayer.current_agent_name,
          agentInfo.agentName
        )

        changesDetected++
      } else if (existingPlayer.pending_agent_removal) {
        // Agents stimmen wieder überein → false alarm, pending aufheben
        console.log(`FALSE ALARM for ${sp.name}: agent "${agentInfo.agentName}" confirmed, clearing pending removal`)
      }

      // Spieler updaten (inkl. club_id falls Vereinswechsel)
      const agentChanged =
        wasAlreadyScanned &&
        agentsAreDifferent(existingPlayer.current_agent_name, agentInfo.agentName) &&
        !sameAgencyId(existingPlayer.agent_url, agentInfo.agentUrl)
      const updateData: Record<string, any> = {
        club_id: clubId,
        player_name: agentInfo.fullName || sp.name,
        tm_profile_url: sp.profileUrl,
        birth_date: agentInfo.birthDate || existingPlayer.birth_date,
        position: agentInfo.position || sp.position || existingPlayer.position,
        current_agent_name: agentInfo.agentName,
        current_agent_company: agentInfo.agentCompany,
        agent_url: agentInfo.agentUrl,
        market_value: agentInfo.marketValue,
        contract_until: agentInfo.contractUntil || existingPlayer.contract_until,
        has_agent: hasAgent,
        agent_updated_at: now,
        last_scanned_at: now,
        is_active: true,
        is_vereinslos: false,
        updated_at: now,
        pending_agent_removal: null, // Clear pending on any successful update
      }
      // agent_since nur bei Beraterwechsel aktualisieren, NICHT bei jedem Scan
      if (agentChanged) {
        updateData.agent_since = now
      }
      await supabase
        .from('berater_players')
        .update(updateData)
        .eq('id', existingPlayer.id)
    } else {
      // Neuer Spieler → Insert
      await supabase
        .from('berater_players')
        .insert({
          club_id: clubId,
          player_name: agentInfo.fullName || sp.name,
          tm_player_id: sp.tmPlayerId,
          tm_profile_url: sp.profileUrl,
          birth_date: agentInfo.birthDate,
          position: agentInfo.position || sp.position,
          current_agent_name: agentInfo.agentName,
          current_agent_company: agentInfo.agentCompany,
        agent_url: agentInfo.agentUrl,
        market_value: agentInfo.marketValue,
          contract_until: agentInfo.contractUntil,
          has_agent: hasAgent,
          agent_updated_at: now,
          agent_since: now,
          last_scanned_at: now,
          is_active: true,
          is_vereinslos: false,
        })

      newPlayers++
    }
  }

  // Spieler die nicht mehr im Kader sind → als vereinslos markieren
  let deactivated = 0
  const { data: dbPlayers } = await supabase
    .from('berater_players')
    .select('id, tm_player_id, player_name')
    .eq('club_id', clubId)
    .eq('is_active', true)
    .eq('is_vereinslos', false)

  if (dbPlayers) {
    for (const dbPlayer of dbPlayers) {
      if (dbPlayer.tm_player_id && !scannedPlayerIds.has(dbPlayer.tm_player_id)) {
        console.log(`Player no longer in squad (vereinslos): ${dbPlayer.player_name}`)
        await supabase
          .from('berater_players')
          .update({ is_vereinslos: true, updated_at: new Date().toISOString() })
          .eq('id', dbPlayer.id)
        deactivated++
      }
    }
  }

  // Club-Metadaten updaten
  await supabase
    .from('berater_clubs')
    .update({
      player_count: squadPlayers.length,
      last_scanned_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', clubId)

  return {
    playersScanned: squadPlayers.length,
    changesDetected,
    newPlayers,
    deactivated,
    clubName: club.club_name,
  }
}

// ============================================================================
// AKTION: cleanup_vereinslose
// Prüft vereinslose Spieler ob sie wieder in einem Verein sind oder Karriereende haben
// ============================================================================

async function cleanupVereinslose(supabase: ReturnType<typeof createClient>, batchSize = 10): Promise<{
  checked: number
  reactivated: number
  retired: number
  leftLeagues: number
}> {
  // Vereinslose Spieler laden (älteste zuerst, die am längsten nicht gescannt wurden)
  const { data: vereinslose, error } = await supabase
    .from('berater_players')
    .select('id, player_name, tm_player_id, tm_profile_url, current_agent_name, current_agent_company, birth_date, position, club_id, contract_until')
    .eq('is_active', true)
    .eq('is_vereinslos', true)
    .order('last_scanned_at', { ascending: true, nullsFirst: true })
    .limit(batchSize)

  if (error || !vereinslose || vereinslose.length === 0) {
    console.log('No vereinslose players to check')
    return { checked: 0, reactivated: 0, retired: 0, leftLeagues: 0 }
  }

  console.log(`Checking ${vereinslose.length} vereinslose players...`)
  const apiPlayers = await fetchPlayers(vereinslose.map((p: any) => String(p.tm_player_id)).filter((id: string) => id !== 'null'))

  let reactivated = 0
  let retired = 0
  let leftLeagues = 0
  const now = new Date().toISOString()

  for (let i = 0; i < vereinslose.length; i++) {
    const player = vereinslose[i]

    console.log(`[vereinslos ${i + 1}/${vereinslose.length}] Checking: ${player.player_name}`)

    const apiPlayer = apiPlayers.get(String(player.tm_player_id))
    const agentInfo = apiPlayer ? toAgentInfo(apiPlayer) : NO_DATA

    // Fetch fehlgeschlagen → überspringen
    if (agentInfo.agentName === null) {
      console.log(`  SKIPPED: fetch/parse failed`)
      await supabase.from('berater_players').update({
        last_scanned_at: now,
      }).eq('id', player.id)
      continue
    }

    // Karriereende → deaktivieren
    if (agentInfo.isRetired) {
      console.log(`  RETIRED: ${player.player_name} hat Karriereende`)
      await supabase.from('berater_players').update({
        is_active: false,
        last_scanned_at: now,
        updated_at: now,
      }).eq('id', player.id)
      retired++
      continue
    }

    // Spieler hat wieder einen Verein → Verein finden und zuordnen
    if (agentInfo.currentClubId) {
      console.log(`  BACK IN CLUB: ${player.player_name} → ${agentInfo.currentClubId}`)

      // Verein in DB suchen
      const { data: matchedClub } = await supabase
        .from('berater_clubs')
        .select('id')
        .eq('tm_club_id', agentInfo.currentClubId)
        .eq('is_active', true)
        .maybeSingle()

      // Neuer Verein ist nicht in den überwachten Ligen → Spieler hat die
      // überwachten Ligen verlassen (z.B. Wechsel ins Ausland) → deaktivieren.
      if (!matchedClub) {
        console.log(`  LEFT MONITORED LEAGUES: ${player.player_name} → ${agentInfo.currentClubId} (nicht überwacht), deaktiviere`)
        await supabase.from('berater_players').update({
          is_active: false,
          is_vereinslos: false,
          last_scanned_at: now,
          updated_at: now,
        }).eq('id', player.id)
        leftLeagues++
        continue
      }

      const hasAgent = !!(agentInfo.agentName && agentInfo.agentName !== 'kein Beratereintrag')

      await supabase.from('berater_players').update({
        is_vereinslos: false,
        club_id: matchedClub.id,
        player_name: agentInfo.fullName || player.player_name,
        current_agent_name: agentInfo.agentName,
        current_agent_company: agentInfo.agentCompany,
        agent_url: agentInfo.agentUrl,
        market_value: agentInfo.marketValue,
        contract_until: agentInfo.contractUntil || player.contract_until,
        position: agentInfo.position || player.position,
        has_agent: hasAgent,
        birth_date: agentInfo.birthDate || player.birth_date,
        agent_updated_at: now,
        last_scanned_at: now,
        updated_at: now,
      }).eq('id', player.id)
      reactivated++
      continue
    }

    // Immer noch vereinslos — nur Berater-Info + Scan-Timestamp updaten
    const hasAgent = !!(agentInfo.agentName && agentInfo.agentName !== 'kein Beratereintrag')
    await supabase.from('berater_players').update({
      player_name: agentInfo.fullName || player.player_name,
      current_agent_name: agentInfo.agentName,
      current_agent_company: agentInfo.agentCompany,
        market_value: agentInfo.marketValue,
      contract_until: agentInfo.contractUntil || player.contract_until,
      position: agentInfo.position || player.position,
      has_agent: hasAgent,
      birth_date: agentInfo.birthDate || player.birth_date,
      agent_updated_at: now,
      last_scanned_at: now,
      updated_at: now,
    }).eq('id', player.id)
  }

  console.log(`Vereinslose cleanup done: ${vereinslose.length} checked, ${reactivated} reactivated, ${retired} retired, ${leftLeagues} left monitored leagues`)
  return { checked: vereinslose.length, reactivated, retired, leftLeagues }
}

// ============================================================================
// AKTION: scan_next_batch
// ============================================================================

async function scanNextBatch(supabase: ReturnType<typeof createClient>): Promise<{
  scanned: boolean
  clubName?: string
  playersScanned?: number
  changesDetected?: number
  newPlayers?: number
  cycleProgress?: string
  cycleComplete?: boolean
}> {
  // Scan-State laden
  const { data: state, error: stateError } = await supabase
    .from('berater_scan_state')
    .select('*')
    .eq('id', 1)
    .single()

  if (stateError || !state) {
    throw new Error('Failed to load scan state')
  }

  // Alle aktiven Clubs laden (sortiert nach ID für konsistente Reihenfolge)
  const { data: clubs, error: clubsError } = await supabase
    .from('berater_clubs')
    .select('id, club_name')
    .eq('is_active', true)
    .order('created_at', { ascending: true })

  if (clubsError || !clubs || clubs.length === 0) {
    return { scanned: false }
  }

  let nextIndex = state.next_club_index || 0
  let cycleComplete = false

  // Neuen Zyklus starten?
  if (nextIndex >= clubs.length) {
    nextIndex = 0
    cycleComplete = false // Wird am Ende gesetzt

    await supabase
      .from('berater_scan_state')
      .update({
        current_cycle: (state.current_cycle || 0) + 1,
        next_club_index: 0,
        cycle_started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1)
  }

  const club = clubs[nextIndex]
  console.log(`Scanning club ${nextIndex + 1}/${clubs.length}: ${club.club_name}`)

  // Scan-State auf "running" setzen
  await supabase
    .from('berater_scan_state')
    .update({
      is_running: true,
      last_scanned_club: club.club_name,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1)

  try {
    const result = await scanClub(supabase, club.id)

    // Nach jedem Club-Scan: ein paar vereinslose Spieler prüfen
    const cleanupResult = await cleanupVereinslose(supabase, 3)

    // Nächsten Index berechnen
    const newNextIndex = nextIndex + 1
    cycleComplete = newNextIndex >= clubs.length

    // Scan-State updaten
    await supabase
      .from('berater_scan_state')
      .update({
        next_club_index: newNextIndex,
        last_scan_at: new Date().toISOString(),
        last_scanned_club: club.club_name,
        is_running: false,
        error_count: 0,
        updated_at: new Date().toISOString(),
        ...(cycleComplete ? { current_cycle: (state.current_cycle || 0) + 1 } : {}),
      })
      .eq('id', 1)

    return {
      scanned: true,
      clubName: result.clubName,
      playersScanned: result.playersScanned,
      changesDetected: result.changesDetected,
      newPlayers: result.newPlayers,
      cycleProgress: `${nextIndex + 1}/${clubs.length}`,
      cycleComplete,
      vereinsloseChecked: cleanupResult.checked,
      vereinsloseReactivated: cleanupResult.reactivated,
      vereinsloseRetired: cleanupResult.retired,
    }
  } catch (error) {
    console.error(`Error scanning club ${club.club_name}:`, error)

    // Error count erhöhen. Da der Index bei Fehlern nicht weiterrückt, zählt
    // error_count die Fehlversuche am SELBEN Verein (Reset bei Erfolg).
    // Nach 5 Versuchen: Verein überspringen, damit der Scan nie dauerhaft hängt.
    const newErrorCount = (state.error_count || 0) + 1
    const skipClub = newErrorCount >= 5
    if (skipClub) {
      console.warn(`Skipping ${club.club_name} after ${newErrorCount} failed attempts`)
    }
    await supabase
      .from('berater_scan_state')
      .update({
        is_running: false,
        error_count: skipClub ? 0 : newErrorCount,
        ...(skipClub
          ? { next_club_index: nextIndex + 1, last_scan_at: new Date().toISOString() }
          : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1)

    throw error
  }
}

// ============================================================================
// AKTION: get_status
// ============================================================================

async function getStatus(supabase: ReturnType<typeof createClient>) {
  // Scan-State
  const { data: state } = await supabase
    .from('berater_scan_state')
    .select('*')
    .eq('id', 1)
    .single()

  // Statistiken
  const { count: totalPlayers } = await supabase
    .from('berater_players')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)

  const { count: playersWithoutAgent } = await supabase
    .from('berater_players')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)
    .eq('has_agent', false)

  const { count: totalClubs } = await supabase
    .from('berater_clubs')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)

  const { count: totalChanges } = await supabase
    .from('berater_changes')
    .select('*', { count: 'exact', head: true })

  // Letzte 7 Tage Änderungen
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { count: recentChanges } = await supabase
    .from('berater_changes')
    .select('*', { count: 'exact', head: true })
    .gte('detected_at', sevenDaysAgo)

  // Aktive Ligen
  const { count: activeLeagues } = await supabase
    .from('berater_leagues')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)

  return {
    scanState: state,
    stats: {
      totalPlayers: totalPlayers || 0,
      playersWithoutAgent: playersWithoutAgent || 0,
      totalClubs: totalClubs || 0,
      totalChanges: totalChanges || 0,
      recentChanges: recentChanges || 0,
      activeLeagues: activeLeagues || 0,
    },
  }
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

// AUTO-SCAN: Via pg_cron + pg_net (alle 5 Min. aus der Datenbank heraus)
// Deno.cron nicht verwendet — Supabase Edge Functions unterstützen es nicht stabil.

// ============================================================================
// HTTP HANDLER (manueller Scan aus der App)
// ============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const denied = await denyUnlessAccess(req, corsHeaders, 'scouting');
  if (denied) return denied;

  try {
    const { action, clubId } = await req.json()
    const supabase = getSupabaseClient()

    console.log(`berater-scan: action=${action}`)

    switch (action) {
      case 'bootstrap_clubs': {
        const result = await bootstrapClubs(supabase)
        return new Response(
          JSON.stringify({ success: true, ...result }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
      }

      case 'scan_club': {
        if (!clubId) {
          return new Response(
            JSON.stringify({ success: false, error: 'clubId is required' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
          )
        }
        const result = await scanClub(supabase, clubId)
        return new Response(
          JSON.stringify({ success: true, ...result }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
      }

      case 'scan_next_batch': {
        const result = await scanNextBatch(supabase)
        return new Response(
          JSON.stringify({ success: true, ...result }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
      }

      case 'cleanup_vereinslose': {
        const result = await cleanupVereinslose(supabase, 20)
        return new Response(
          JSON.stringify({ success: true, ...result }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
      }

      case 'resolve_u16': {
        // Einmal-Aktion: alle "Berater bekannt - Spieler unter 16"-Einträge
        // über die TM-API auflösen (kein Wechsel, nur die Sichtbarkeit)
        const { data: hiddenPlayers } = await supabase
          .from('berater_players')
          .select('id, player_name, tm_player_id')
          .ilike('current_agent_name', '%unter 16%')
          .eq('is_active', true)
          .limit(200)
        let resolved = 0
        let failed = 0
        for (const p of (hiddenPlayers || []) as any[]) {
          if (!p.tm_player_id) { failed++; continue }
          const hidden = await resolveHiddenU16Agent(p.tm_player_id)
          if (hidden) {
            await supabase.from('berater_players').update({
              current_agent_name: hidden.name,
              current_agent_company: hidden.company,
              agent_url: hidden.url,
              has_agent: true,
              updated_at: new Date().toISOString(),
            }).eq('id', p.id)
            resolved++
            console.log(`U16 resolved: ${p.player_name} -> ${hidden.name}`)
          } else {
            failed++
          }
          await sleep(150)
        }
        return new Response(
          JSON.stringify({ success: true, total: (hiddenPlayers || []).length, resolved, failed }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
      }

      case 'cleanup_u16_changes': {
        // Einmal-Aktion: alte Wechsel-Einträge mit dem U16-Platzhalter löschen.
        // Kein echter Beraterwechsel (Berater war nur versteckt, siehe agentsAreDifferent)
        const { data: staleChanges } = await supabase
          .from('berater_changes')
          .select('id')
          .or('previous_agent_name.ilike.%unter 16%,new_agent_name.ilike.%unter 16%')
          .limit(500)
        const ids = ((staleChanges || []) as any[]).map((c) => c.id)
        if (ids.length > 0) {
          const { error: delErr } = await supabase.from('berater_changes').delete().in('id', ids)
          if (delErr) throw new Error(`cleanup_u16_changes delete failed: ${delErr.message}`)
        }
        return new Response(
          JSON.stringify({ success: true, deleted: ids.length }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
      }

      case 'get_status': {
        const result = await getStatus(supabase)
        return new Response(
          JSON.stringify({ success: true, ...result }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
      }

      default:
        return new Response(
          JSON.stringify({ success: false, error: `Unknown action: ${action}` }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
    }
  } catch (error) {
    console.error('berater-scan error:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Internal error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
