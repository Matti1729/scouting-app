// stipendiumService.ts - Sportstipendium-Kandidaten
//
// Verwaltet Spieler im Stipendium-Prozess mit Status:
// interessant -> Interessante Spieler (über die Suchmaschine hinzugefügt)
// kontaktiert -> Spieler wurde kontaktiert
// go          -> Go-Kandidaten
// archiviert  -> Archiv (abgesagt / aktuell nicht interessant genug)

import { supabase } from '../config/supabase';

export type StipendiumStatus = 'interessant' | 'kontaktiert' | 'go' | 'archiviert';

export interface StipendiumEntry {
  id: string;
  player_name: string;
  birth_date: string | null;
  club_name: string | null;
  position: string | null;
  tm_player_id: string | null;
  tm_profile_url: string | null;
  market_value: string | null;
  status: StipendiumStatus;
  notes: string | null;
  added_at: string;
  updated_at: string;
}

export interface NewStipendiumEntry {
  player_name: string;
  birth_date?: string | null;
  club_name?: string | null;
  position?: string | null;
  tm_player_id?: string | null;
  tm_profile_url?: string | null;
  market_value?: string | null;
  status: StipendiumStatus;
  notes?: string | null;
}

export async function loadStipendiumEntries(): Promise<StipendiumEntry[]> {
  const { data, error } = await supabase
    .from('stipendium_entries')
    .select('*')
    .order('added_at', { ascending: false });

  if (error) {
    console.error('Error loading stipendium entries:', error);
    return [];
  }

  return (data || []) as StipendiumEntry[];
}

export async function addStipendiumEntry(entry: NewStipendiumEntry): Promise<StipendiumEntry | null> {
  const { data, error } = await supabase
    .from('stipendium_entries')
    .insert({
      player_name: entry.player_name,
      birth_date: entry.birth_date || null,
      club_name: entry.club_name || null,
      position: entry.position || null,
      tm_player_id: entry.tm_player_id || null,
      tm_profile_url: entry.tm_profile_url || null,
      market_value: entry.market_value || null,
      status: entry.status,
      notes: entry.notes || null,
    })
    .select()
    .single();

  if (error) {
    console.error('Error adding stipendium entry:', error);
    return null;
  }

  return data as StipendiumEntry;
}

export async function updateStipendiumStatus(id: string, status: StipendiumStatus): Promise<boolean> {
  const { error } = await supabase
    .from('stipendium_entries')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    console.error('Error updating stipendium status:', error);
    return false;
  }

  return true;
}

export async function updateStipendiumNotes(id: string, notes: string | null): Promise<boolean> {
  const { error } = await supabase
    .from('stipendium_entries')
    .update({ notes, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    console.error('Error updating stipendium notes:', error);
    return false;
  }

  return true;
}

export async function removeStipendiumEntry(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('stipendium_entries')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Error removing stipendium entry:', error);
    return false;
  }

  return true;
}

// ============================================================================
// SPIELER-DETAILS (on-demand von Transfermarkt via Edge Function)
// ============================================================================

export interface PlayerTmTransfer {
  season: string | null;
  date: string | null; // "DD.MM.YYYY"
  from: string | null;
  to: string | null;
}

export interface PlayerTmDetails {
  seasonYear: number;
  gamesCurrentSeason: number | null;
  gamesLastSeason: number | null;
  transfers: PlayerTmTransfer[];
}

export async function fetchPlayerTmDetails(tmPlayerId: string): Promise<PlayerTmDetails | null> {
  try {
    const { data, error } = await supabase.functions.invoke('player-details', {
      body: { playerId: tmPlayerId },
    });
    if (error || !data?.success) return null;
    return data as PlayerTmDetails;
  } catch (e) {
    console.error('Error fetching player details:', e);
    return null;
  }
}

/** Extrahiert die Transfermarkt-Spieler-ID aus einer Profil-URL */
export function extractTmPlayerId(profileUrl: string | null | undefined): string | null {
  if (!profileUrl) return null;
  const match = profileUrl.match(/\/spieler\/(\d+)/);
  return match ? match[1] : null;
}

// ============================================================================
// SPIELER-SUCHE (interne Datenbank, berater_players)
// ============================================================================

export interface StipendiumSearchFilters {
  name?: string;
  ages?: number[];          // exakte Alter (16..34), leer = alle
  agePlus?: boolean;        // "34+" = 34 und älter
  positions?: string[];     // Positions-Kürzel (TW, IV, ...), leer = alle
  leagueIds?: string[];     // leer = alle Ligen; bei vereinslos = letzte Liga
  vereinslos?: boolean;
  contractExpiring?: boolean; // Vertrag endet spätestens zum nächsten 30.06.
}

// Positions-Kürzel: TM speichert teils volle Namen ("Offensives Mittelfeld"),
// teils Kürzel — beides auf ein einheitliches Kürzel normalisieren
const POSITION_MAP: Record<string, string> = {
  'torwart': 'TW', 'tw': 'TW', 'to': 'TW',
  'innenverteidiger': 'IV', 'iv': 'IV',
  'linker verteidiger': 'LV', 'lv': 'LV',
  'rechter verteidiger': 'RV', 'rv': 'RV',
  'abwehr': 'AB', 'ab': 'AB',
  'defensives mittelfeld': 'DM', 'dm': 'DM',
  'zentrales mittelfeld': 'ZM', 'zm': 'ZM',
  'offensives mittelfeld': 'OM', 'om': 'OM',
  'linkes mittelfeld': 'LM', 'lm': 'LM',
  'rechtes mittelfeld': 'RM', 'rm': 'RM',
  'mittelfeld': 'MF', 'mf': 'MF',
  'linksaußen': 'LA', 'la': 'LA', 'lf': 'LA',
  'rechtsaußen': 'RA', 'ra': 'RA', 'rf': 'RA',
  'hängende spitze': 'ST', 'mittelstürmer': 'ST', 'sturm': 'ST', 'st': 'ST', 'ms': 'ST',
};

/** Normalisiert einen Positions-String auf ein Kürzel (TW, IV, ...).
 *  Versteht auch das TM-Verbundformat "Abwehr - Innenverteidiger". */
export function positionCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw.replace(/&nbsp;/g, ' ').trim().toLowerCase();
  if (!key) return null;
  if (POSITION_MAP[key]) return POSITION_MAP[key];
  // "Abwehr - Innenverteidiger" → spezifischster Teil zählt
  const parts = key.split(/\s+-\s+/);
  const specific = parts[parts.length - 1].trim();
  return POSITION_MAP[specific] || raw.trim();
}

export interface StipendiumSearchPlayer {
  id: string;
  player_name: string;
  birth_date: string | null;
  age: number | null;
  position: string | null;       // Kürzel (TW, IV, ...) oder Rohwert
  current_agent_name: string | null;
  tm_player_id: string | null;
  tm_profile_url: string | null;
  market_value: string | null;
  contract_until: string | null; // ISO "YYYY-MM-DD"
  is_vereinslos: boolean;
  club_name: string | null;
  club_tm_id: string | null; // für das Vereinswappen (TM-Bild-URL)
  league_name: string | null;
}

/** Alter aus "DD.MM.YYYY" berechnen */
export function ageFromBirthDate(birthDate: string | null): number | null {
  if (!birthDate) return null;
  const parts = birthDate.split('.');
  if (parts.length !== 3) return null;
  const birth = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
  if (isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) {
    age--;
  }
  if (age < 10 || age > 50) return null;
  return age;
}

/** Suchtext normalisieren: Kleinschreibung + Diakritika entfernen,
 *  damit "uriel" auch "Uriël" findet und "o" auch "ö" */
function normalizeSearch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // kombinierende Akzente entfernen
    .replace(/ø/g, 'o')
    .replace(/ß/g, 'ss')
    .replace(/æ/g, 'ae')
    .replace(/ł/g, 'l')
    .replace(/đ/g, 'd')
    .replace(/ð/g, 'd')
    .replace(/þ/g, 'th');
}

/** Nächster 30.06. (Saisonende) als ISO-Datum */
function nextSeasonEnd(): string {
  const now = new Date();
  const year = now.getMonth() + 1 > 6 ? now.getFullYear() + 1 : now.getFullYear();
  return `${year}-06-30`;
}

/** DB-Zeile (berater_players + Verein/Liga) auf das Such-/Detailformat mappen */
function mapRowToSearchPlayer(row: any): StipendiumSearchPlayer {
  return {
    id: row.id,
    player_name: row.player_name,
    birth_date: row.birth_date,
    age: ageFromBirthDate(row.birth_date),
    position: positionCode(row.position),
    current_agent_name: row.current_agent_name || null,
    tm_player_id: row.tm_player_id,
    tm_profile_url: row.tm_profile_url,
    market_value: row.market_value,
    contract_until: row.contract_until,
    is_vereinslos: !!row.is_vereinslos,
    club_name: row.berater_clubs?.club_name || null,
    club_tm_id: row.berater_clubs?.tm_club_id || null,
    league_name: row.berater_clubs?.berater_leagues?.name || null,
  };
}

const SEARCH_PLAYER_SELECT = `id, player_name, birth_date, position, current_agent_name, tm_player_id, tm_profile_url, market_value, contract_until, is_vereinslos,
   berater_clubs!inner (club_name, tm_club_id, league_id, berater_leagues (name, country))`;

/** Einzelnen Spieler (z.B. für das Detail-Modal im Sportstipendium-Board) laden */
export async function fetchSearchPlayer(
  tmPlayerId: string | null,
  playerName?: string | null
): Promise<StipendiumSearchPlayer | null> {
  let query = supabase.from('berater_players').select(SEARCH_PLAYER_SELECT).eq('is_active', true);
  if (tmPlayerId) {
    query = query.eq('tm_player_id', tmPlayerId);
  } else if (playerName) {
    query = query.eq('player_name', playerName);
  } else {
    return null;
  }
  const { data, error } = await query.limit(1).maybeSingle();
  if (error || !data) return null;
  return mapRowToSearchPlayer(data);
}

// ============================================================================
// SCOUT-PORTAL-SYNC (Go-Kandidaten -> Athletes-USA Scout Portal)
// ============================================================================

/** Meldet einen Go-Kandidaten an das Scout Portal (idempotent pro Eintrag).
 *  Rückgabe: true wenn der Lead angelegt wurde (oder schon existierte). */
export async function syncGoKandidat(entry: {
  id: string;
  player_name: string;
  tm_profile_url: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  // "Nachname, Vorname"-Logik ist Anzeige-Sache — das Portal erwartet Vor-/Nachname
  const parts = entry.player_name.trim().split(/\s+/);
  const first = parts[0] || entry.player_name;
  const last = parts.slice(1).join(' ');
  try {
    const { data, error } = await supabase.functions.invoke('stipendium-go-sync', {
      body: {
        first_name: first,
        last_name: last,
        profile_url: entry.tm_profile_url || '',
        source_lead_id: entry.id,
      },
    });
    if (error || !data?.success) {
      console.error('Scout-Portal-Sync fehlgeschlagen:', error || data);
      return { ok: false, error: (data as any)?.error || error?.message || 'unbekannter Fehler' };
    }
    return { ok: true };
  } catch (e) {
    console.error('Scout-Portal-Sync fehlgeschlagen:', e);
    return { ok: false, error: String(e) };
  }
}

// ============================================================================
// SPIELER-NOTIZEN (Notizen + Erstkontakt-Datum im Profil-Modal)
// ============================================================================

export interface PlayerNote {
  notes: string | null;
  first_contact_date: string | null; // ISO "YYYY-MM-DD"
}

export async function loadPlayerNote(playerId: string): Promise<PlayerNote> {
  const { data } = await supabase
    .from('player_notes')
    .select('notes, first_contact_date')
    .eq('player_id', playerId)
    .maybeSingle();
  return { notes: data?.notes || null, first_contact_date: data?.first_contact_date || null };
}

export async function savePlayerNote(playerId: string, note: PlayerNote): Promise<boolean> {
  const { error } = await supabase.from('player_notes').upsert({
    player_id: playerId,
    notes: note.notes,
    first_contact_date: note.first_contact_date,
    updated_at: new Date().toISOString(),
  });
  if (error) console.error('Error saving player note:', error);
  return !error;
}

export interface PlayerClubInfo {
  club_name: string | null;
  club_tm_id: string | null;
  is_vereinslos: boolean;
}

/** Aktuelle Vereinsinfo (inkl. Wappen-ID) für mehrere Spieler — für die Board-Karten */
export async function fetchPlayersClubInfo(tmPlayerIds: string[]): Promise<Record<string, PlayerClubInfo>> {
  if (tmPlayerIds.length === 0) return {};
  const { data, error } = await supabase
    .from('berater_players')
    .select('tm_player_id, is_vereinslos, berater_clubs (club_name, tm_club_id)')
    .eq('is_active', true)
    .in('tm_player_id', tmPlayerIds);
  if (error || !data) return {};
  const map: Record<string, PlayerClubInfo> = {};
  for (const row of data as any[]) {
    if (!row.tm_player_id) continue;
    map[row.tm_player_id] = {
      club_name: row.berater_clubs?.club_name || null,
      club_tm_id: row.berater_clubs?.tm_club_id || null,
      is_vereinslos: !!row.is_vereinslos,
    };
  }
  return map;
}

export async function searchStipendiumPlayers(
  filters: StipendiumSearchFilters
): Promise<{ players: StipendiumSearchPlayer[]; total: number; hiddenNoPosition: number }> {
  const PAGE_SIZE = 1000;

  function buildQuery() {
    let query = supabase
      .from('berater_players')
      .select(
        `id, player_name, birth_date, position, current_agent_name, tm_player_id, tm_profile_url, market_value, contract_until, is_vereinslos,
         berater_clubs!inner (club_name, tm_club_id, league_id, berater_leagues (name, country))`,
        { count: 'exact' }
      )
      .eq('is_active', true);

    // Ohne Filter alle Spieler (mit Verein UND vereinslos);
    // "vereinslos"-Button schränkt auf Vereinslose ein.
    if (filters.vereinslos) {
      query = query.eq('is_vereinslos', true);
    }

    if (filters.leagueIds && filters.leagueIds.length > 0) {
      query = query.in('berater_clubs.league_id', filters.leagueIds);
    }

    if (filters.contractExpiring) {
      query = query.not('contract_until', 'is', null).lte('contract_until', nextSeasonEnd());
    }

    return query.order('player_name', { ascending: true });
  }

  const { data: firstPage, error, count } = await buildQuery().range(0, PAGE_SIZE - 1);
  if (error) {
    console.error('Error searching players:', error);
    return { players: [], total: 0, hiddenNoPosition: 0 };
  }

  const allData: any[] = [...(firstPage || [])];
  const totalCount = count || 0;

  // Restliche Seiten parallel laden (PostgREST cappt bei 1000 Zeilen)
  if (totalCount > PAGE_SIZE) {
    const pages = Math.ceil(totalCount / PAGE_SIZE);
    const promises = [];
    for (let p = 1; p < pages; p++) {
      promises.push(buildQuery().range(p * PAGE_SIZE, (p + 1) * PAGE_SIZE - 1));
    }
    const results = await Promise.all(promises);
    for (const r of results) {
      if (!r.error && r.data) allData.push(...r.data);
    }
  }

  let players: StipendiumSearchPlayer[] = allData.map(mapRowToSearchPlayer);

  // Namens-/Vereinsfilter client-seitig und akzent-unabhängig ("uriel" findet "Uriël")
  if (filters.name?.trim()) {
    const needle = normalizeSearch(filters.name.trim());
    players = players.filter(
      (p) =>
        normalizeSearch(p.player_name).includes(needle) ||
        (p.club_name !== null && normalizeSearch(p.club_name).includes(needle))
    );
  }

  // Positionsfilter client-seitig (Rohwerte sind uneinheitlich).
  // Spieler ohne Positionsangabe können nicht gematcht werden — Anzahl mitgeben,
  // damit die UI erklären kann, warum ggf. wenige Treffer kommen.
  let hiddenNoPosition = 0;
  if (filters.positions && filters.positions.length > 0) {
    const posSet = new Set(filters.positions);
    hiddenNoPosition = players.filter((p) => p.position === null).length;
    players = players.filter((p) => p.position !== null && posSet.has(p.position));
  }

  // Altersfilter client-seitig (birth_date ist TEXT "DD.MM.YYYY")
  const hasAgeFilter = (filters.ages && filters.ages.length > 0) || filters.agePlus;
  if (hasAgeFilter) {
    const ageSet = new Set(filters.ages || []);
    players = players.filter((p) => {
      if (p.age === null) return false;
      if (ageSet.has(p.age)) return true;
      if (filters.agePlus && p.age >= 34) return true;
      return false;
    });
  }

  return { players, total: players.length, hiddenNoPosition };
}
