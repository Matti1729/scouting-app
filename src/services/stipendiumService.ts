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

export interface PlayerTmSeasonStats {
  games: number;
  goals: number;
  assists: number;
}

export interface PlayerNationalTeam {
  name: string;             // z.B. "England U21", "Deutschland U16"
  countryId: number | null; // TM-Land-ID für die Länderflagge (CDN)
}

export interface PlayerTmDetails {
  seasonYear: number;
  gamesCurrentSeason: number | null;
  gamesLastSeason: number | null;
  statsCurrentSeason: PlayerTmSeasonStats | null;
  statsLastSeason: PlayerTmSeasonStats | null;
  transfers: PlayerTmTransfer[];
  nationalTeam: PlayerNationalTeam | null;
}

/** TM-Länderflagge (kleines PNG) zur TM-Land-ID — Fallback, wenn kein Emoji bekannt */
export function tmFlagUrl(countryId: number): string {
  return `https://tmssl.akamaized.net/images/flagge/head/${countryId}.png`;
}

// Deutscher Ländername -> ISO-Code für die Emoji-Flagge (gleicher Flaggentyp
// wie im Land-Dropdown; Emoji-Flaggen gibt es für alle Länder, England/
// Schottland/Wales haben eigene Sonder-Flaggen)
const COUNTRY_NAME_TO_ISO: Record<string, string> = {
  'deutschland': 'DE', 'österreich': 'AT', 'schweiz': 'CH', 'niederlande': 'NL',
  'england': 'gb-eng', 'schottland': 'gb-sct', 'wales': 'gb-wls', 'nordirland': 'GB',
  'frankreich': 'FR', 'italien': 'IT', 'spanien': 'ES', 'portugal': 'PT',
  'belgien': 'BE', 'dänemark': 'DK', 'schweden': 'SE', 'norwegen': 'NO',
  'finnland': 'FI', 'island': 'IS', 'irland': 'IE', 'polen': 'PL',
  'tschechien': 'CZ', 'slowakei': 'SK', 'ungarn': 'HU', 'kroatien': 'HR',
  'serbien': 'RS', 'bosnien-herzegowina': 'BA', 'slowenien': 'SI',
  'nordmazedonien': 'MK', 'albanien': 'AL', 'kosovo': 'XK', 'montenegro': 'ME',
  'griechenland': 'GR', 'türkei': 'TR', 'russland': 'RU', 'ukraine': 'UA',
  'belarus': 'BY', 'weißrussland': 'BY', 'rumänien': 'RO', 'bulgarien': 'BG',
  'luxemburg': 'LU', 'liechtenstein': 'LI', 'malta': 'MT', 'zypern': 'CY',
  'estland': 'EE', 'lettland': 'LV', 'litauen': 'LT', 'moldau': 'MD',
  'färöer': 'FO', 'gibraltar': 'GI', 'andorra': 'AD', 'san marino': 'SM',
  'georgien': 'GE', 'armenien': 'AM', 'aserbaidschan': 'AZ', 'kasachstan': 'KZ',
  'usbekistan': 'UZ', 'israel': 'IL', 'saudi-arabien': 'SA', 'katar': 'QA',
  'vereinigte arabische emirate': 'AE', 'iran': 'IR', 'irak': 'IQ',
  'japan': 'JP', 'südkorea': 'KR', 'china': 'CN', 'indien': 'IN',
  'indonesien': 'ID', 'thailand': 'TH', 'vietnam': 'VN', 'australien': 'AU',
  'neuseeland': 'NZ', 'usa': 'US', 'vereinigte staaten': 'US', 'kanada': 'CA',
  'mexiko': 'MX', 'jamaika': 'JM', 'costa rica': 'CR', 'honduras': 'HN',
  'panama': 'PA', 'trinidad und tobago': 'TT', 'haiti': 'HT',
  'dominikanische republik': 'DO', 'brasilien': 'BR', 'argentinien': 'AR',
  'uruguay': 'UY', 'chile': 'CL', 'kolumbien': 'CO', 'peru': 'PE',
  'ecuador': 'EC', 'paraguay': 'PY', 'venezuela': 'VE', 'bolivien': 'BO',
  'marokko': 'MA', 'algerien': 'DZ', 'tunesien': 'TN', 'ägypten': 'EG',
  'libyen': 'LY', 'senegal': 'SN', 'ghana': 'GH', 'nigeria': 'NG',
  'kamerun': 'CM', 'elfenbeinküste': 'CI', 'mali': 'ML', 'burkina faso': 'BF',
  'guinea': 'GN', 'guinea-bissau': 'GW', 'gambia': 'GM', 'kap verde': 'CV',
  'dr kongo': 'CD', 'demokratische republik kongo': 'CD', 'kongo': 'CG',
  'angola': 'AO', 'mosambik': 'MZ', 'sambia': 'ZM', 'simbabwe': 'ZW',
  'südafrika': 'ZA', 'kenia': 'KE', 'tansania': 'TZ', 'uganda': 'UG',
  'äthiopien': 'ET', 'sudan': 'SD', 'togo': 'TG', 'benin': 'BJ',
  'niger': 'NE', 'tschad': 'TD', 'gabun': 'GA', 'mauretanien': 'MR',
  'madagaskar': 'MG', 'sierra leone': 'SL', 'liberia': 'LR', 'ruanda': 'RW',
  'burundi': 'BI', 'äquatorialguinea': 'GQ', 'komoren': 'KM',
};

function flagEmojiFromIso(iso: string): string {
  if (iso.startsWith('gb-')) {
    // Sub-Flaggen (England/Schottland/Wales) als Tag-Sequenz
    const tags = [...`gb${iso.slice(3)}`].map((c) => String.fromCodePoint(0xe0000 + c.charCodeAt(0)));
    return `\u{1F3F4}${tags.join('')}\u{E007F}`;
  }
  return [...iso.toUpperCase()]
    .map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65))
    .join('');
}

/** Emoji-Flagge zum Nationalteam-Namen ("Deutschland U19" -> 🇩🇪); null wenn unbekannt */
export function flagForNationalTeam(teamName: string | null): string | null {
  if (!teamName) return null;
  const country = teamName.replace(/\s+U-?\d{1,2}$/i, '').trim().toLowerCase();
  const iso = COUNTRY_NAME_TO_ISO[country];
  return iso ? flagEmojiFromIso(iso) : null;
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
  ages?: number[];          // exakte Alter (14..32), leer = alle; 14 = "14 und jünger"
  agePlus?: boolean;        // "≥33" = 33 und älter
  positions?: string[];     // Positions-Kürzel (TW, IV, ...), leer = alle
  leagueIds?: string[];     // leer = alle Ligen; bei vereinslos = letzte Liga
  nations?: string[];       // Länderkürzel der Ligen (DE, AT, ...), leer = egal
  clubIds?: string[];       // konkrete Mannschaften (berater_clubs.id), leer = alle
  /** Basisnamen der ausgewählten Vereine (z.B. "Borussia Dortmund"): findet auch
   *  per Bericht angelegte Spieler (U15/U16 ohne TM-Mannschaft) über den
   *  Vereinsnamen im Scouting-Bericht */
  clubBaseNames?: string[];
  /** Explizit ausgewählte Berichts-Mannschaften (z.B. "Borussia Dortmund U15")
   *  — synthetische Dropdown-Einträge ohne berater_clubs-Zeile */
  reportTeams?: string[];
  vereinslos?: boolean;
  contractExpiring?: boolean; // Vertrag endet spätestens zum nächsten 30.06.
  wechselTage?: number;     // nur Spieler mit Beraterwechsel in den letzten N Tagen
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
  current_agent_company: string | null;
  agent_url: string | null;      // TM-Link der Berateragentur
  tm_player_id: string | null;
  tm_profile_url: string | null;
  market_value: string | null;
  contract_until: string | null; // ISO "YYYY-MM-DD"
  is_vereinslos: boolean;
  club_name: string | null;
  club_tm_id: string | null; // für das Vereinswappen (TM-Bild-URL)
  league_name: string | null;
  /** Letzter Beraterwechsel (nur gesetzt, wenn mit wechselTage gesucht wurde) */
  last_change?: { from: string | null; to: string | null; date: string } | null;
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
export function normalizeSearch(text: string): string {
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

/** Agentur-Namen aus TM-URL-Slugs enthalten HTML-Entity-Reste:
 *  "Middot" = · (the-middot-team = THE·TEAM), "Amp" = & (sport-amp-entertainment),
 *  "Quot" = Anführungszeichen (quot-to-be-quot = "to be") */
function cleanAgencyName(name: string | null): string | null {
  if (!name) return null;
  return name
    .replace(/\s*\bmiddot\b\s*/gi, '·')
    .replace(/\s\bamp\b\s/gi, ' & ')
    // paarweise: quot X quot -> "X"; übrig gebliebene einzelne quot ebenfalls ersetzen
    .replace(/\bquot\s+(.+?)\s+quot\b/gi, '"$1"')
    .replace(/\s*\bquot\b\s*/gi, '"');
}

/** Einheitliche Berater-Anzeige überall: Agentur vor Personenname,
 *  Platzhalter ("kein Beratereintrag") zählen als leer. */
export function agentDisplayName(
  name: string | null | undefined,
  company: string | null | undefined
): string | null {
  const clean = (v: string | null | undefined): string | null => {
    const c = cleanAgencyName(v ?? null);
    if (!c) return null;
    const n = c.trim().toLowerCase();
    // Platzhalter zählen als "kein Berater": kein Beratereintrag, k.A.,
    // ohne Berater. "Familienangehörige" wird dagegen ANGEZEIGT (echter
    // Eintrag) — zählt nur im "ohne Berater"-Filter als beraterlos.
    const kompakt = n.replace(/\s/g, '');
    if (
      !n ||
      n === 'kein beratereintrag' ||
      n === 'kein eintrag' ||
      n === 'ohne berater' ||
      n === '-' ||
      n === '—' ||
      kompakt === 'k.a.'
    ) return null;
    return c;
  };
  return clean(company) || clean(name);
}

/** DB-Zeile (berater_players + Verein/Liga) auf das Such-/Detailformat mappen */
function mapRowToSearchPlayer(row: any): StipendiumSearchPlayer {
  return {
    id: row.id,
    player_name: row.player_name,
    birth_date: row.birth_date,
    age: ageFromBirthDate(row.birth_date),
    position: positionCode(row.position),
    current_agent_name: cleanAgencyName(row.current_agent_name),
    current_agent_company: cleanAgencyName(row.current_agent_company),
    agent_url: row.agent_url || null,
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

const SEARCH_PLAYER_SELECT = `id, player_name, birth_date, position, current_agent_name, current_agent_company, agent_url, tm_player_id, tm_profile_url, market_value, contract_until, is_vereinslos,
   berater_clubs (club_name, tm_club_id, league_id, berater_leagues (name, country))`;

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

/** "DD.MM.YYYY" -> ISO "YYYY-MM-DD" (fürs Portal) */
function birthDateToIso(birthDate: string | null): string | null {
  if (!birthDate) return null;
  const m = birthDate.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/** Meldet einen Go-Kandidaten an das Scout Portal (idempotent pro Eintrag).
 *  Rückgabe: true wenn der Lead angelegt wurde (oder schon existierte). */
export async function syncGoKandidat(entry: {
  id: string;
  player_name: string;
  tm_profile_url: string | null;
  birth_date?: string | null;
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
        // Geburtsdatum hilft dem Portal, vorhandene Spieler zu erkennen (Zusammenführen)
        date_of_birth: birthDateToIso(entry.birth_date || null),
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

/** Prüft, ob ein Go-Kandidat im Scout Portal (noch) gelistet ist.
 *  Rückgabe null = Prüfung nicht möglich (dann vorsichtshalber gesperrt lassen). */
export async function checkGoKandidatImPortal(entry: {
  id: string;
  player_name: string;
  tm_profile_url: string | null;
  birth_date?: string | null;
}): Promise<boolean | null> {
  const parts = entry.player_name.trim().split(/\s+/);
  try {
    const { data, error } = await supabase.functions.invoke('stipendium-go-sync', {
      body: {
        action: 'check',
        first_name: parts[0] || entry.player_name,
        last_name: parts.slice(1).join(' '),
        profile_url: entry.tm_profile_url || '',
        source_lead_id: entry.id,
        date_of_birth: birthDateToIso(entry.birth_date || null),
      },
    });
    if (error || !data?.success) return null;
    return !!(data as any).exists;
  } catch {
    return null;
  }
}

// ============================================================================
// SPIELER-NOTIZEN (Notizen + Erstkontakt-Datum im Profil-Modal)
// ============================================================================

export interface PlayerNote {
  notes: string | null;
  first_contact_date: string | null; // ISO "YYYY-MM-DD"
}

/** Name des Scouts, der den Spieler ins Sportstipendium aufgenommen hat */
export async function fetchEntryAddedBy(tmPlayerId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('get_entry_added_by', { p_tm_player_id: tmPlayerId });
  if (error) return null;
  return (data as string | null) || null;
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

/** Nur den Notiztext speichern (Erstkontakt-Datum bleibt unberührt) —
 *  für die Synchronisierung mit den Watchlist-Notizen */
export async function savePlayerNotesText(playerId: string, notes: string | null): Promise<boolean> {
  const { error } = await supabase.from('player_notes').upsert({
    player_id: playerId,
    notes,
    updated_at: new Date().toISOString(),
  });
  if (error) console.error('Error saving player note text:', error);
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

export interface ClubOption {
  id: string;
  name: string;
  league_id: string | null;
  country: string | null; // Land der Liga — fürs Kaskadieren mit dem Land-Filter
  tm_club_id: string | null; // fürs Vereinswappen im Dropdown
}

/** "Borussia Dortmund U19" -> "Borussia Dortmund" (Mannschafts-Suffix abtrennen) */
export function baseClubName(name: string): string {
  return name.replace(/\s+(U-?\d{1,2}|II|III|IV|B|2|Amateure|Jugend)$/i, '').trim() || name;
}

// ---- Berichts-Mannschaften: Spieler ohne TM-Verein hängen an der Mannschaft
// ihres Scouting-Berichts (Verein + Altersklasse) ----

/** Rang einer Altersklasse: U-Zahl, Herren = 99 */
export function agRank(ag: string | null): number {
  if (!ag) return -1;
  const m = ag.match(/u[-\s]?(\d{1,2})/i);
  if (m) return parseInt(m[1], 10);
  if (/herren|senior/i.test(ag)) return 99;
  return -1;
}

/** "Borussia Dortmund" + "U16" -> "Borussia Dortmund U16" */
export function teamLabel(club: string, ag: string | null): string {
  // Mannschafts-Suffix steht schon im Vereinsnamen? Dann nichts anhängen.
  if (/\bu[-\s]?\d{1,2}\b|\bII\b|\bIII\b/i.test(club)) return club;
  const m = (ag || '').match(/u[-\s]?(\d{1,2})/i);
  return m ? `${club} U${m[1]}` : club;
}

/** match_date liegt gemischt vor ("11.04.2026" und "2026-08-28") -> ISO */
function evalIsoDate(d: string): string {
  const m = d.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : d;
}

/** Bedeutsame Namens-Tokens für den Vereins-Vergleich ("TSG 1899 Hoffenheim"
 *  matcht "TSG Hoffenheim U15": Jahreszahlen zählen nicht) */
function clubNameTokens(name: string): string[] {
  return normalizeSearch(name)
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t));
}

type BestEval = { club: string; ag: string | null; date: string };

/** Je Bericht-Spieler die maßgebliche Mannschaft: höchste Altersklasse gewinnt,
 *  bei Gleichstand der neueste Bericht (U15, drei Wochen später U16 => U16). */
async function loadBestEvalTeams(): Promise<Map<string, BestEval>> {
  const { data: allEvals } = await supabase
    .from('player_evaluations')
    .select('berater_player_id, current_club, age_group, match_date')
    .not('berater_player_id', 'is', null)
    .not('current_club', 'is', null);
  const bestEval = new Map<string, BestEval>();
  for (const ev of (allEvals || []) as any[]) {
    if (!ev.berater_player_id || !ev.current_club) continue;
    const cand = { club: ev.current_club, ag: ev.age_group || null, date: evalIsoDate(ev.match_date || '') };
    const prev = bestEval.get(ev.berater_player_id);
    if (
      !prev ||
      agRank(cand.ag) > agRank(prev.ag) ||
      (agRank(cand.ag) === agRank(prev.ag) && cand.date > prev.date)
    ) {
      bestEval.set(ev.berater_player_id, cand);
    }
  }
  return bestEval;
}

/** Mannschafts-Labels aus Berichten (z.B. "Borussia Dortmund U15") von Spielern
 *  OHNE TM-Verein — fürs Vereins-Dropdown der Suchmaschine. */
export async function loadReportTeams(): Promise<string[]> {
  const bestEval = await loadBestEvalTeams();
  if (bestEval.size === 0) return [];
  const ids = [...bestEval.keys()];
  const labels = new Set<string>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await supabase
      .from('berater_players')
      .select('id, club_id, is_vereinslos')
      .eq('is_active', true)
      .in('id', ids.slice(i, i + 100));
    for (const row of (data || []) as any[]) {
      if (row.club_id || row.is_vereinslos) continue;
      const be = bestEval.get(row.id);
      if (be) labels.add(teamLabel(be.club, be.ag));
    }
  }
  return [...labels].sort((a, b) => a.localeCompare(b, 'de'));
}

/** Alle Mannschaften (berater_clubs) fürs Vereins-Dropdown der Suchmaschine.
 *  Seitenweise laden, weil PostgREST bei 1000 Zeilen cappt. */
export async function loadAllClubs(): Promise<ClubOption[]> {
  const PAGE_SIZE = 1000;
  const clubs: ClubOption[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from('berater_clubs')
      .select('id, club_name, tm_club_id, league_id, berater_leagues (country)')
      .order('club_name', { ascending: true })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) {
      console.error('Error loading clubs:', error);
      break;
    }
    for (const row of (data || []) as any[]) {
      if (row.club_name) {
        clubs.push({
          id: row.id,
          name: row.club_name,
          league_id: row.league_id || null,
          country: row.berater_leagues?.country || null,
          tm_club_id: row.tm_club_id || null,
        });
      }
    }
    if (!data || data.length < PAGE_SIZE) break;
  }
  return clubs;
}

export async function searchStipendiumPlayers(
  filters: StipendiumSearchFilters
): Promise<{ players: StipendiumSearchPlayer[]; total: number; hiddenNoPosition: number }> {
  const PAGE_SIZE = 1000;

  function buildQuery() {
    // Left-Join auf den Verein: auch gescoutete Spieler ohne Vereinszuordnung
    // (z.B. U16 ohne TM-Profil, per Bericht angelegt) sollen auffindbar sein.
    // Nur Liga-/Nations-Filter erzwingen den Inner-Join.
    const hasNations = !!(filters.nations && filters.nations.length > 0);
    const hasClubFilter =
      (filters.leagueIds && filters.leagueIds.length > 0) || hasNations;
    const clubJoin = hasClubFilter ? 'berater_clubs!inner' : 'berater_clubs';
    const leagueJoin = hasNations ? 'berater_leagues!inner' : 'berater_leagues';
    let query = supabase
      .from('berater_players')
      .select(
        `id, player_name, birth_date, position, current_agent_name, current_agent_company, agent_url, tm_player_id, tm_profile_url, market_value, contract_until, is_vereinslos,
         ${clubJoin} (club_name, tm_club_id, league_id, ${leagueJoin} (name, country))`,
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

    // Vereinsfilter: konkrete Mannschaften; Vereinslose zählen nicht mehr zu
    // ihrem alten Verein (gleiche Regel wie bei der Vereins-Namenssuche)
    if (filters.clubIds && filters.clubIds.length > 0) {
      query = query.in('club_id', filters.clubIds).eq('is_vereinslos', false);
    }

    if (filters.nations && filters.nations.length > 0) {
      query = query.in('berater_clubs.berater_leagues.country', filters.nations);
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

  // Mannschaft aus Scouting-Berichten: per Bericht angelegte Spieler (kein
  // TM-Verein) werden der Mannschaft zugeordnet, bei der der Bericht
  // aufgenommen wurde ("Borussia Dortmund" + Altersklasse U16 des Spiels =
  // "Borussia Dortmund U16"). Ein TM-Verein hat immer Vorrang.
  const bestEval = await loadBestEvalTeams();
  for (const p of players) {
    if (!p.club_name && !p.is_vereinslos) {
      const be = bestEval.get(p.id);
      if (be) p.club_name = teamLabel(be.club, be.ag);
    }
  }

  // Bericht-Spieler ohne TM-Mannschaft nachladen und anhängen
  const addEvalPlayers = async (ids: string[]) => {
    if (ids.length === 0) return;
    const { data: extra } = await supabase
      .from('berater_players')
      .select(SEARCH_PLAYER_SELECT)
      .eq('is_active', true)
      .in('id', ids);
    for (const row of (extra || []) as any[]) {
      const p = mapRowToSearchPlayer(row);
      if (p.is_vereinslos) continue;
      if (!p.club_name) {
        const be = bestEval.get(p.id);
        p.club_name = be ? teamLabel(be.club, be.ag) : null;
      }
      players.push(p);
    }
    players.sort((a, b) => a.player_name.localeCompare(b.player_name, 'de'));
  };

  const hasClubIds = !!(filters.clubIds && filters.clubIds.length > 0);
  const hasReportTeams = !!(filters.reportTeams && filters.reportTeams.length > 0);

  // Vereinsfilter-Ergänzung: Bericht-Spieler über den Basisnamen des
  // ausgewählten Vereins ODER die explizit gewählte Berichts-Mannschaft
  if (hasClubIds || hasReportTeams) {
    const bases = (filters.clubBaseNames || [])
      .map((b) => ({ norm: normalizeSearch(b), tokens: clubNameTokens(b) }))
      .filter((b) => b.norm.length > 0);
    const matchesBase = (club: string) =>
      bases.some((b) =>
        b.tokens.length > 0 ? b.tokens.every((t) => club.includes(t)) : club.startsWith(b.norm)
      );
    const teamSet = new Set((filters.reportTeams || []).map(normalizeSearch));
    const have = new Set(players.map((p) => p.id));
    const extraIds: string[] = [];
    for (const [pid, be] of bestEval) {
      if (have.has(pid)) continue;
      const label = normalizeSearch(teamLabel(be.club, be.ag));
      const byBase = hasClubIds && matchesBase(normalizeSearch(be.club));
      const byTeam = hasReportTeams && teamSet.has(label);
      if (byBase || byTeam) extraIds.push(pid);
    }
    await addEvalPlayers(extraIds);
    // Nur Berichts-Mannschaften gewählt (keine TM-Mannschaft): die Hauptabfrage
    // war dann club-seitig ungefiltert -> auf die passenden Spieler einschränken
    if (!hasClubIds && hasReportTeams) {
      players = players.filter((p) => {
        const be = bestEval.get(p.id);
        return !!be && !p.is_vereinslos && teamSet.has(normalizeSearch(teamLabel(be.club, be.ag)));
      });
    }
  } else if (filters.nations && filters.nations.length > 0) {
    // Land-Filter: der Inner-Join wirft Bericht-Spieler ohne TM-Verein raus.
    // Über das Land ihres Berichts-Vereins wieder mitnehmen (Aburime spielt
    // bei "Borussia Dortmund" -> Deutschland).
    const clubNames: string[] = [];
    for (let page = 0; ; page++) {
      const { data } = await supabase
        .from('berater_clubs')
        .select('club_name, berater_leagues!inner (country)')
        .in('berater_leagues.country', filters.nations)
        .range(page * 1000, (page + 1) * 1000 - 1);
      for (const r of (data || []) as any[]) {
        if (r.club_name) clubNames.push(r.club_name);
      }
      if (!data || data.length < 1000) break;
    }
    const baseSets = new Map<string, string[]>();
    for (const n of clubNames) {
      const base = baseClubName(n);
      if (!baseSets.has(base)) baseSets.set(base, clubNameTokens(base));
    }
    const tokenSets = [...baseSets.values()].filter((t) => t.length > 0);
    const have = new Set(players.map((p) => p.id));
    const extraIds: string[] = [];
    for (const [pid, be] of bestEval) {
      if (have.has(pid)) continue;
      const clubNorm = normalizeSearch(be.club);
      if (tokenSets.some((ts) => ts.every((t) => clubNorm.includes(t)))) extraIds.push(pid);
    }
    await addEvalPlayers(extraIds);
  }

  // Namens-/Vereinsfilter client-seitig und akzent-unabhängig ("uriel" findet "Uriël")
  if (filters.name?.trim()) {
    const needle = normalizeSearch(filters.name.trim());
    players = players.filter(
      (p) =>
        normalizeSearch(p.player_name).includes(needle) ||
        // Vereinssuche: Vereinslose nicht über ihren ALTEN Verein finden
        // (die tauchen nur über den vereinslos-Filter oder ihren Namen auf)
        (!p.is_vereinslos && p.club_name !== null && normalizeSearch(p.club_name).includes(needle))
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
      // Randwerte sind offen: "≤14" heißt 14 und jünger, "≥33" heißt 33 und älter
      if (ageSet.has(14) && p.age < 14) return true;
      if (filters.agePlus && p.age >= 33) return true;
      return false;
    });
  }

  // Beraterwechsel-Filter: nur Spieler mit Wechsel in den letzten N Tagen,
  // angereichert um den letzten Wechsel (für die Zusatzspalten)
  if (filters.wechselTage && filters.wechselTage > 0) {
    const cutoff = new Date(Date.now() - filters.wechselTage * 86400000).toISOString();
    const { data: changes, error: chErr } = await supabase
      .from('berater_changes')
      .select('player_id, previous_agent_name, previous_agent_company, new_agent_name, new_agent_company, detected_at')
      .gte('detected_at', cutoff)
      .order('detected_at', { ascending: false })
      .limit(2000);
    if (chErr) {
      console.error('Error loading berater changes:', chErr);
      return { players: [], total: 0, hiddenNoPosition };
    }
    // neuester Wechsel je Spieler
    const latest = new Map<string, any>();
    for (const c of (changes || []) as any[]) {
      if (c.player_id && !latest.has(c.player_id)) latest.set(c.player_id, c);
    }
    players = players
      .filter((p) => latest.has(p.id))
      .map((p) => {
        const c = latest.get(p.id);
        return {
          ...p,
          last_change: {
            from: agentDisplayName(c.previous_agent_name, c.previous_agent_company),
            to: agentDisplayName(c.new_agent_name, c.new_agent_company),
            date: c.detected_at,
          },
        };
      });
  }

  return { players, total: players.length, hiddenNoPosition };
}
