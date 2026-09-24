// areaGamesService: Spiele "in der Umgebung" aus der KMH-App.
// Beide Apps teilen dieselbe Supabase-Datenbank — die KMH-Seite synct täglich
// fussball.de-Spielpläne inkl. Geokoordinaten (sync-area-games), wir lesen nur.
import { supabase } from '../config/supabase';

export interface AreaLeague {
  league_key: string;
  name: string;
  marker_group: 'herren' | 'jugend' | 'gemischt' | null;
}

export interface AreaClub {
  league_key: string;
  name: string;
  fussballde_team_id: string | null;
  venue: string | null;
  venue_address: string | null;
  lat: number | null;
  lng: number | null;
}

export interface AreaGame {
  league_key: string;
  match_key: string;
  kickoff_date: string; // ISO "YYYY-MM-DD"
  kickoff_time: string | null;
  home_name: string;
  away_name: string;
  home_team_id: string | null;
  away_team_id?: string | null;
  wettbewerb: string | null;
  game_url: string | null;
  lat: number | null;
  lng: number | null;
  venue: string | null;
  venue_address: string | null;
}

/** Aktivierte Ligen, Vereine (für Spielstätten-Fallback) + anstehende Spiele laden */
export async function loadAreaData(): Promise<{ leagues: AreaLeague[]; clubs: AreaClub[]; games: AreaGame[] }> {
  const today = new Date().toISOString().slice(0, 10);
  const [leaguesRes, clubsRes, gamesRes] = await Promise.all([
    supabase
      .from('area_leagues')
      .select('league_key, name, marker_group')
      .eq('enabled', true)
      .order('sort_order'),
    supabase
      .from('area_clubs')
      .select('league_key, name, fussballde_team_id, venue, venue_address, lat, lng')
      .limit(3000),
    supabase
      .from('area_games')
      .select('league_key, match_key, kickoff_date, kickoff_time, home_name, away_name, home_team_id, away_team_id, wettbewerb, game_url, lat, lng, venue, venue_address')
      .gte('kickoff_date', today)
      .order('kickoff_date')
      .limit(2000),
  ]);
  if (leaguesRes.error) console.error('area_leagues laden fehlgeschlagen:', leaguesRes.error);
  if (clubsRes.error) console.error('area_clubs laden fehlgeschlagen:', clubsRes.error);
  if (gamesRes.error) console.error('area_games laden fehlgeschlagen:', gamesRes.error);
  return {
    leagues: (leaguesRes.data as AreaLeague[]) || [],
    clubs: (clubsRes.data as AreaClub[]) || [],
    games: (gamesRes.data as AreaGame[]) || [],
  };
}

/** Spielstätte on-demand von der fussball.de-Spielseite holen (Edge Function) */
export async function resolveGameVenue(
  gameUrl: string
): Promise<{ venue: string | null; address: string | null } | null> {
  try {
    const { data, error } = await supabase.functions.invoke('resolve-game-venue', {
      body: { game_url: gameUrl },
    });
    if (error || !data?.success) return null;
    return { venue: (data as any).venue || null, address: (data as any).address || null };
  } catch {
    return null;
  }
}

/** Aufgelöste Spielstätte in area_games nachtragen (ohne geo_checked —
 *  die Koordinaten ermittelt weiterhin der nächtliche KMH-Sync). */
export async function saveGameVenue(matchKey: string, venue: string | null, address: string): Promise<void> {
  await supabase.from('area_games').update({ venue, venue_address: address }).eq('match_key', matchKey);
}

/** Jahrgang aus Wettbewerb/Teamnamen ("U17"), sonst 'Herren'.
 *  U20+ (U21/U23) ist eine MANNSCHAFT, keine Altersklasse -> zählt als Herren. */
export function areaAge(g: AreaGame, leagueName: string): string {
  for (const src of [g.wettbewerb || '', g.home_name, g.away_name, leagueName]) {
    const m = src.match(/\bU[\s-]?(\d{2})\b/i);
    if (m) return parseInt(m[1], 10) >= 20 ? 'Herren' : 'U' + m[1];
  }
  return 'Herren';
}

/** Langen Ort-String auf den Spielstätten-Namen kürzen:
 *  "Kunstrasenplatz, Sportplatz Herringhausen-Eickum, Am Sportplatz 18, 32051 …"
 *  -> "Sportplatz Herringhausen-Eickum"; "Stadion an der Gellertstraße" bleibt. */
export function shortVenueName(ort?: string | null): string | null {
  if (!ort) return null;
  const parts = ort.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  let i = 0;
  // Führenden Platztyp ("Kunstrasenplatz", "Rasenplatz 2", "Kennel A-Platz") überspringen
  if (parts.length > 1 && /platz\.?\s*\d*$/i.test(parts[0])) i = 1;
  const name: string[] = [];
  for (; i < parts.length; i++) {
    const part = parts[i];
    // Adresse erreicht? (PLZ, Hausnummer oder Straßenname)
    if (/\d{4,}/.test(part) || /\d+\s*$/.test(part) || /(str\.|straße|weg|allee|gasse|ring)\s*$/i.test(part)) break;
    name.push(part);
    if (name.length >= 2) break;
  }
  return name.length ? name.join(', ') : parts[0];
}

/** "U19 SC Freiburg" -> "SC Freiburg" (Jahrgang steht in eigener Spalte).
 *  U20+ ist die zweite Mannschaft -> als "II" kennzeichnen ("VfL Bochum II"). */
export function stripAge(name: string): string {
  return (name || '')
    // \b vor dem U: "VfB Zwenkau 02" darf NICHT als "U 02"-Label gelesen werden
    .replace(/\s*\bU[\s-]?(\d{2})\b/gi, (_full, num) => (parseInt(num, 10) >= 20 ? ' II' : ''))
    // Abteilungs-/NLZ-Zusätze und Klammer-Anhänge raus ("LZ", "NLZ", "Fußball")
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\b(N?LZ|Fußball|Fussball)\b/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Teamname auf die Vereins-Basis normalisieren ("1. FC Köln U15" -> "1 fc köln")
 *  für den Wappen-Lookup über berater_clubs (Jahreszahlen/II/U-Labels egal) */
export function clubBase(name: string): string {
  return (name || '')
    .toLowerCase()
    // Akzente vereinheitlichen ("René" = "Rene"); deutsche Umlaute bleiben
    .replace(/[áàâã]/g, 'a')
    .replace(/[éèêë]/g, 'e')
    .replace(/[íìî]/g, 'i')
    .replace(/[óòôõ]/g, 'o')
    .replace(/[úùû]/g, 'u')
    .replace(/ç/g, 'c')
    .replace(/\brasenballsport\b/g, 'rb')
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\bu[\s-]?\d{1,2}\b/g, '')
    // Abteilungs-/Team-Zusätze von fussball.de: "Fußball", "B-Junioren", "B1"
    .replace(/\b(fußball|fussball|[a-d][\s-]?junior(en|innen)|junior(en|innen)|[a-d]\d)\b/g, '')
    .replace(/\b(ii|iii|iv|2|3|1\.hr\.?|lz|nlz)\b/g, '')
    .replace(/\b\d{2,4}\b/g, '')
    .replace(/[().]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // Abkürzungen mit Punkten ("U.S.I.", "F.C.") zerfallen zu Einzelbuchstaben → wieder zusammenziehen
    .replace(/\b(?:[a-zäöü] )+[a-zäöü]\b/g, (m) => m.replace(/ /g, ''));
}

/**
 * Gründungs-/Jahreszahlen im Vereinsnamen (2-4-stellig, ohne U-Altersklassen).
 * "FSV Babelsberg 74" und "SV Babelsberg 03" landen sonst beide auf "babelsberg";
 * die Zahl ist hier das einzige Unterscheidungsmerkmal.
 */
export function clubNumbers(name: string): Set<string> {
  const cleaned = (name || '').toLowerCase().replace(/\bu[\s-]?\d{1,2}\b/g, '').replace(/\b[a-d]\d\b/g, '');
  return new Set((cleaned.match(/\b\d{2,4}\b/g) || []).filter((n) => n !== '1' && n !== '2' && n !== '3'));
}
/** true, wenn kein Zahlen-Widerspruch: eine Seite ohne Zahl, oder gemeinsame Zahl */
export function clubNumbersCompatible(a: string, b: string): boolean {
  const na = clubNumbers(a); const nb = clubNumbers(b);
  if (!na.size || !nb.size) return true;
  for (const n of na) if (nb.has(n)) return true;
  return false;
}

/** Vereins-Kern ohne Rechtsform-Präfixe ("fc würzburger kickers" -> "würzburger kickers")
 *  — Fallback, wenn fussball.de und Transfermarkt den Verein unterschiedlich führen */
function clubCore(base: string): string {
  return base
    // Rechtsform-/Kürzel-Tokens raus; "f c" entsteht aus "F.C." nach Punkt-Strip
    .replace(/\b(1|f|c|e|v|fc|sv|tsv|vfb|vfl|vfr|sc|tsg|tus|spvgg|spvg|spfr|sportfreunde|sf|fsv|sg|vsg|sgv|bsg|bsc|esv|bv|msv|ksv|dsc|djk|fv)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Vereinsname aus berater_clubs als Anzeigename: ohne U-Label/II, "1.FC Köln" → "1. FC Köln" */
function displayClubName(name: string): string {
  return stripAge(name)
    .replace(/\s+(II|III|U2\d)$/i, '')
    .replace(/^(\d)\.(?=[A-ZÄÖÜ])/, '$1. ')
    .trim();
}

/**
 * Einheitlicher Vereinsname für die Anzeige (Matti 2026-09-24: ein Verein = ein Name,
 * egal welche Mannschaft). fussball.de nennt die Teams je Altersklasse anders
 * ("RB Leipzig" / "RasenBallsport Leipzig U16"); wir zeigen den Namen aus
 * berater_clubs, "II" für zweite Mannschaften bleibt erhalten. Unbekannte Vereine
 * (nicht in berater_clubs) bleiben wie bereinigt.
 */
export function canonicalClubName(map: Map<string, string>, teamName: string): string {
  const cleaned = stripAge(teamName);
  if (!cleaned) return cleaned;
  // Zweite/dritte Mannschaft behalten ("FC Augsburg 2" / "VfL Wolfsburg II" → "… II")
  const sm = cleaned.match(/\s+(II|III|2|3)$/);
  const suffix = sm ? (sm[1] === 'III' || sm[1] === '3' ? ' III' : ' II') : '';
  const b = clubBase(cleaned);
  const pick = (key: string): string | undefined => {
    const disp = map.get(`canon:${key}`);
    if (!disp) return undefined;
    const storedName = map.get(`name:${key}`);
    return storedName && !clubNumbersCompatible(teamName, storedName) ? undefined : disp;
  };
  let disp = pick(b) || pick(`core:${clubCore(b)}`);
  if (!disp && /ae|oe|ue/.test(b)) {
    const u = b.replace(/ae/g, 'ä').replace(/oe/g, 'ö').replace(/ue/g, 'ü');
    disp = pick(u) || pick(`core:${clubCore(u)}`);
  }
  return disp ? `${disp}${suffix}` : cleaned;
}

/** Vereins-Aliase (fussball.de-Schreibweise → Kurzform wie bei TM) */
const CLUB_ALIASES: Array<[string, string]> = [['rasenballsport', 'rb']];

/**
 * Suchbegriff wie clubBase normalisieren, aber Aliase auch bei angefangenen
 * Wörtern anwenden: "rasenball" → "rb", "rasenb leip" → "rb leip"
 */
export function clubBaseQuery(q: string): string {
  const base = clubBase(q);
  return base
    .split(' ')
    .map((tok) => {
      if (tok.length < 3) return tok;
      const alias = CLUB_ALIASES.find(([full]) => full.startsWith(tok));
      return alias ? alias[1] : tok;
    })
    .join(' ');
}

/** "Heim - Gast" mit einheitlichen Vereinsnamen (Events ohne Gegner unverändert) */
export function canonicalSpiel(map: Map<string, string>, spiel: string): string {
  if (!spiel) return spiel;
  const parts = spiel.split(' - ');
  if (parts.length !== 2) return canonicalClubName(map, spiel);
  return `${canonicalClubName(map, parts[0])} - ${canonicalClubName(map, parts[1])}`;
}

/** Wappen-Lookup laden: normalisierte Vereins-Basis -> tm_club_id */
export async function loadClubLogoMap(): Promise<Map<string, string>> {
  const { data } = await supabase
    .from('berater_clubs')
    .select('club_name, tm_club_id')
    .not('tm_club_id', 'is', null)
    .limit(3000);
  const m = new Map<string, string>();
  for (const c of (data || []) as any[]) {
    const b = clubBase(c.club_name);
    if (!b) continue;
    if (!m.has(b)) { m.set(b, String(c.tm_club_id)); m.set(`name:${b}`, String(c.club_name)); }
    const core = clubCore(b);
    if (core && !m.has(`core:${core}`)) { m.set(`core:${core}`, String(c.tm_club_id)); m.set(`name:core:${core}`, String(c.club_name)); }
    // Einheitlicher Anzeigename je Verein: kürzeste Variante ohne U-Label/II
    // ("RB Leipzig" statt "RB Leipzig U19"; fussball.de "RasenBallsport Leipzig" → "RB Leipzig")
    const disp = displayClubName(c.club_name);
    for (const key of [`canon:${b}`, core ? `canon:core:${core}` : '']) {
      if (!key) continue;
      const cur = m.get(key);
      if (!cur || disp.length < cur.length) m.set(key, disp);
    }
  }
  return m;
}

// Nationalmannschaften: Verbandswappen von Transfermarkt (Jugend-Teams nutzen
// dasselbe Wappen wie die A-Nationalmannschaft). IDs via tmapi verifiziert.
const NATIONAL_TEAM_TM_IDS: Array<[RegExp, string]> = [
  [/\bluxemburg|luxembourg\b/, '3580'],
  [/\bdeutschland|dfb\b/, '3262'],
  [/\bniederlande|holland|nederland\b/, '3379'],
  [/\bfrankreich|france\b/, '3377'],
  [/\bbelgien|belgique|belgi[eë]\b/, '3382'],
  [/\bösterreich|oesterreich\b/, '3383'],
  [/\bschweiz|suisse\b/, '3384'],
  [/\bdänemark|daenemark|danmark\b/, '3436'],
  [/\bpolen|polska\b/, '3442'],
  [/\btschechien|tschechische republik|czech\b/, '3445'],
  [/\bengland\b/, '3299'],
  [/\bspanien|espana|españa\b/, '3375'],
  [/\bitalien|italia\b/, '3376'],
  [/\bportugal\b/, '3300'],
  // Gegner der DFB-Junioren (IDs per TM-Schnellsuche/tmapi verifiziert, 2026-09-02)
  [/\bgriechenland|greece\b/, '3378'],
  [/\btürkei|tuerkei|türkiye|turkey\b/, '3381'],
  [/\bukraine\b/, '3699'],
  [/\bvenezuela\b/, '3504'],
  [/\bisrael\b/, '5547'],
  [/\baserbaidschan|azerbaijan\b/, '8605'],
  [/\blitauen|lithuania\b/, '3851'],
  [/\bnordirland|northern ireland\b/, '5674'],
  [/\bfinnland|finland\b/, '3443'],
  [/\blettland|latvia\b/, '3555'],
  [/\bmalta\b/, '3587'],
  [/\bgeorgien|georgia\b/, '3669'],
  [/\bschweden|sweden\b/, '3557'],
  [/\bnorwegen|norway\b/, '3440'],
  [/\bschottland|scotland\b/, '3380'],
  [/\bwales\b/, '3864'],
  [/\birland|ireland\b/, '3509'],
  [/\bisland|iceland\b/, '3574'],
  [/\bkroatien|croatia\b/, '3556'],
  [/\bserbien|serbia\b/, '3438'],
  [/\bslowenien|slovenia\b/, '3588'],
  [/\bslowakei|slovakia\b/, '3503'],
  [/\bungarn|hungary\b/, '3468'],
  [/\brumänien|rumaenien|romania\b/, '3447'],
  [/\bbulgarien|bulgaria\b/, '3394'],
  [/\bbosnien|bosnia\b/, '3446'],
  [/\balbanien|albania\b/, '3561'],
  [/\bkosovo\b/, '53982'],
  [/\bnordmazedonien|mazedonien|macedonia\b/, '5148'],
  [/\bmontenegro\b/, '11953'],
  [/\bzypern|cyprus\b/, '3668'],
  [/\bestland|estonia\b/, '6133'],
  [/\bmoldau|moldawien|moldova\b/, '6090'],
  [/\bbelarus|weißrussland|weissrussland\b/, '3450'],
  [/\brussland|russia\b/, '3448'],
  [/\barmenien|armenia\b/, '6219'],
  [/\bkasachstan|kazakhstan\b/, '9110'],
  [/\bfäröer|faeroeer|faroe\b/, '9173'],
  [/\bgibraltar\b/, '37574'],
  [/\bandorra\b/, '10533'],
  [/\bsan marino\b/, '10521'],
  [/\bliechtenstein\b/, '5673'],
  [/\bmarokko|morocco\b/, '3575'],
  [/\bägypten|aegypten|egypt\b/, '3672'],
  [/\btunesien|tunisia\b/, '3670'],
  [/\bnigeria\b/, '3444'],
  [/\bghana\b/, '3441'],
  [/\bsenegal\b/, '3499'],
  [/\bkamerun|cameroon\b/, '3434'],
  [/\belfenbeinküste|ivory coast\b/, '3591'],
  [/\bjapan\b/, '3435'],
  [/\bsüdkorea|suedkorea|korea\b/, '3589'],
  [/\baustralien|australia\b/, '3433'],
  [/\busa|vereinigte staaten|united states\b/, '3505'],
  [/\bkanada|canada\b/, '3510'],
  [/\bmexiko|mexico\b/, '6303'],
  [/\bbrasilien|brazil\b/, '3439'],
  [/\bargentinien|argentina\b/, '3437'],
  [/\bkolumbien|colombia\b/, '3816'],
  [/\bchile\b/, '3700'],
  [/\buruguay\b/, '3449'],
  [/\bperu\b/, '3584'],
  [/\becuador\b/, '5750'],
  [/\bparaguay\b/, '3581'],
];

function nationalTeamId(base: string): string | null {
  // Nur bei klaren Nationalteam-Namen (kein Vereinsname wie "Racing FC Union Luxembourg")
  const looksLikeClub = /\b(fc|sv|as|cs|racing|union|city|sc)\b/.test(base);
  if (looksLikeClub) return null;
  for (const [re, id] of NATIONAL_TEAM_TM_IDS) {
    if (re.test(base)) return id;
  }
  return null;
}

/** Wappen-URL für einen Teamnamen (exakter Basis-Treffer, sonst Kern- bzw.
 *  Nationalmannschafts-Fallback) */
export function clubLogoUriFor(map: Map<string, string>, teamName: string): string | null {
  const b = clubBase(teamName);
  // Treffer nur, wenn die Gründungszahl nicht widerspricht (Babelsberg 74 ≠ Babelsberg 03)
  const pick = (key: string): string | undefined => {
    const id = map.get(key);
    if (!id) return undefined;
    const storedName = map.get(`name:${key}`);
    return storedName && !clubNumbersCompatible(teamName, storedName) ? undefined : id;
  };
  let clubId = pick(b) || pick(`core:${clubCore(b)}`);
  if (!clubId && /ae|oe|ue/.test(b)) {
    // ASCII-Schreibweise ("1. FC Koeln") gegen Umlaut-Variante ("1. FC Köln") prüfen
    const u = b.replace(/ae/g, 'ä').replace(/oe/g, 'ö').replace(/ue/g, 'ü');
    clubId = pick(u) || pick(`core:${clubCore(u)}`);
  }
  if (clubId) return `https://tmssl.akamaized.net/images/wappen/head/${clubId}.png`;
  // Nationalteams haben kein "head"-Wappen bei TM, aber "normquad"
  const ntId = nationalTeamId(b);
  return ntId ? `https://tmssl.akamaized.net/images/wappen/normquad/${ntId}.png` : null;
}

// ---------------------------------------------------------------------------
// On-Demand-Wappen: Vereine außerhalb unserer Ligen (Amateure usw.) einmalig
// über die TM-Schnellsuche auflösen; Ergebnis dauerhaft im localStorage cachen.
// ---------------------------------------------------------------------------
const CLUB_RESOLVE_CACHE_KEY = 'tm_club_resolve_v10'; // v10: Gründungszahl in der Suche, Teilstring-Treffer nur mit Zahl/2 Tokens

// fussball.de-Vereinsdaten je team-id (Edge Function fussballde-club), dauerhaft gecacht
const FDE_CLUB_CACHE_KEY = 'fde_club_v1';
interface FdeClubInfo { teamName: string | null; clubName: string | null; city: string | null; founded: string | null }
async function fetchFdeClubInfo(teamId: string): Promise<FdeClubInfo | null> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(FDE_CLUB_CACHE_KEY) : null;
    const cache: Record<string, FdeClubInfo> = raw ? JSON.parse(raw) : {};
    if (cache[teamId]) return cache[teamId];
    const { data } = await supabase.functions.invoke('fussballde-club', { body: { teamId } });
    if (!(data as any)?.success) return null;
    const info: FdeClubInfo = {
      teamName: (data as any).teamName || null,
      clubName: (data as any).clubName || null,
      city: (data as any).city || null,
      founded: (data as any).founded || null,
    };
    cache[teamId] = info;
    try { localStorage.setItem(FDE_CLUB_CACHE_KEY, JSON.stringify(cache)); } catch { /* egal */ }
    return info;
  } catch {
    return null;
  }
}

/** TM-Kürzel wie "V/W" (SC V/W Billstedt) gegen Anfangsbuchstaben der Namensteile ("Vorwärts-Wacker") */
function initialsMatch(tmBase: string, queryBase: string): boolean {
  const abbr = tmBase.match(/\b([a-zäöü](?:\/[a-zäöü])+)\b/);
  if (!abbr) return false;
  const letters = abbr[1].split('/');
  const words = clubCore(queryBase).split(/[\s-]+/).filter((w) => w.length >= 3);
  return letters.length >= 2 && letters.every((l, i) => words[i]?.startsWith(l));
}
let resolveCache: Record<string, string> | null = null; // clubBase -> tm_club_id | 'none'
const pendingResolve = new Map<string, Promise<string | null>>();
let resolveChain: Promise<unknown> = Promise.resolve();

function loadResolveCache(): Record<string, string> {
  if (!resolveCache) {
    try {
      resolveCache = JSON.parse((globalThis as any).localStorage?.getItem(CLUB_RESOLVE_CACHE_KEY) || '{}');
    } catch {
      resolveCache = {};
    }
  }
  return resolveCache!;
}
function saveResolveCache(): void {
  try {
    (globalThis as any).localStorage?.setItem(CLUB_RESOLVE_CACHE_KEY, JSON.stringify(resolveCache || {}));
  } catch { /* Cache ist optional */ }
}
const clubWappenUrl = (id: string) => `https://tmssl.akamaized.net/images/wappen/head/${id}.png`;

export function resolveClubLogoUri(teamName: string, teamId?: string | null): Promise<string | null> {
  const b = clubBase(teamName);
  if (!b) return Promise.resolve(null);
  // Cache-Schlüssel inkl. Gründungszahl, damit "Babelsberg 74" und "Babelsberg 03" getrennt bleiben
  const ck = [b, ...Array.from(clubNumbers(teamName)).sort()].join(' ');
  const cache = loadResolveCache();
  if (cache[ck]) return Promise.resolve(cache[ck] === 'none' ? null : clubWappenUrl(cache[ck]));
  const inFlight = pendingResolve.get(ck);
  if (inFlight) return inFlight;
  const task = resolveChain.then(async (): Promise<string | null> => {
    const c = loadResolveCache();
    if (c[ck]) return c[ck] === 'none' ? null : clubWappenUrl(c[ck]);
    try {
      // Plausibilität: gefundener Vereinsname muss zur Anfrage passen.
      // Auch ok: Kern-Tokens der einen Seite sind Teilmenge der anderen
      // ("SGV Freiberg" <-> "SGV Heilbronn-Freiberg")
      // `against`: Anfrage-Name (Standard: der Teamname; bei fussball.de-Fallback der volle Vereinsname)
      const plausible = (name: string | null | undefined, against: string = teamName, city: string | null = null): boolean => {
        const rb = clubBase(name || '');
        const qb = clubBase(against);
        if (!rb || !qb) return false;
        if (!clubNumbersCompatible(against, name || '')) return false;
        if (rb === qb || clubCore(rb) === clubCore(qb)) return true;
        if (initialsMatch(rb, qb)) return true;
        // Teilstring ("sv wacker" in "sv wacker burghausen") nur, wenn der kürzere Kern zwei
        // Namensteile hat oder BEIDE dieselbe Gründungszahl tragen (SV Wacker 09 ≠ Burghausen)
        if (rb.includes(qb) || qb.includes(rb)) {
          const shorterCore = clubCore(rb.length <= qb.length ? rb : qb).split(/[\s-]+/).filter(Boolean);
          if (shorterCore.length >= 2) return true;
          const na = clubNumbers(against); const nb = clubNumbers(name || '');
          return na.size > 0 && nb.size > 0;
        }
        const ta = clubCore(qb).split(/[\s-]+/).filter(Boolean);
        // Orts-Token des Vereins darf im TM-Namen vorkommen, ohne zu stören ("Wacker 09 Cottbus")
        const cityTokens = new Set(clubCore(clubBase(city || '')).split(/[\s-]+/).filter(Boolean));
        const tb = clubCore(rb).split(/[\s-]+/).filter((t) => t && !cityTokens.has(t));
        if (!ta.length || !tb.length) return false;
        const [short, long] = ta.length <= tb.length ? [ta, new Set(tb)] : [tb, new Set(ta)];
        if (!short.every((t) => long.has(t))) return false;
        // Nur EIN gemeinsames Wort ("Wacker") reicht nicht: dann müssen beide dieselbe Zahl tragen
        // (SV Wacker 09 ≠ SV Wacker Burghausen)
        if (short.length === 1) {
          const na = clubNumbers(against); const nb = clubNumbers(name || '');
          return na.size > 0 && nb.size > 0;
        }
        return true;
      };
      let throttled = false;
      const search = async (q: string): Promise<any> => {
        const { data } = await supabase.functions.invoke('transfermarkt-proxy', {
          body: { clubSearch: q },
        });
        if ((data as any)?.retryable) throttled = true;
        return (data as any)?.club || null;
      };
      // Suchkandidaten: bereinigter Name -> Vereinskern -> ohne letzten
      // Namensteil (Stadt-Suffixe wie "VSG Altglienicke Berlin")
      const candidates: string[] = [];
      // Gründungszahl ist bei TM ein starkes Merkmal ("SV Wacker 09" → Cottbus, nicht Burghausen)
      const nums = Array.from(clubNumbers(teamName)).sort();
      if (nums.length) candidates.push(`${b} ${nums.join(' ')}`);
      candidates.push(b);
      const core = clubCore(b);
      if (core && core.length >= 5 && core !== b) candidates.push(core);
      const parts = b.split(' ');
      if (parts.length >= 3) candidates.push(parts.slice(0, -1).join(' '));
      // Unbekanntes Kürzel vorne weglassen ("USI Lupo Martini" → "Lupo Martini")
      if (parts.length >= 3 && parts[0].length <= 4) candidates.push(parts.slice(1).join(' '));
      let club: any = null;
      let ok = false;
      for (const q of candidates) {
        const found = await search(q);
        if (found && plausible(found.club_name)) { club = found; ok = true; break; }
        await new Promise((r) => setTimeout(r, 900));
      }
      // Fallback: fussball.de kürzt Teamnamen ("Vorw. Wacker 3.C-Jun.") oder der Name ist
      // mehrdeutig ("SV Wacker 09") → Mannschafts-/Vereinsseite liefert vollen Namen + Ort
      if (!ok && teamId) {
        const info = await fetchFdeClubInfo(teamId);
        // Vereinsname zuerst (Teamname kann weiter abgekürzt sein: "Vorw. Wacker 3.C-Jun."), dann Teamname
        const names = Array.from(new Set([info?.clubName, info?.teamName].filter((n): n is string => !!n)));
        const cityB = info?.city ? clubBase(info.city) : '';
        const seen = new Set(candidates);
        outer: for (const full of names) {
          const fb = clubBase(full);
          const more = [cityB ? `${fb} ${cityB}` : '', fb, clubCore(fb)].filter((q) => q && q.length >= 4 && !seen.has(q));
          for (const q of more) {
            seen.add(q);
            const found = await search(q);
            if (found && plausible(found.club_name, full, info?.city || null)) { club = found; ok = true; break outer; }
            await new Promise((r) => setTimeout(r, 900));
          }
        }
      }
      if (ok) {
        c[ck] = String(club.tm_club_id);
        saveResolveCache();
      } else if (!throttled) {
        // Nur als "nicht gefunden" merken, wenn TM wirklich geantwortet hat
        c[ck] = 'none';
        saveResolveCache();
      }
      // TM nicht fluten: Pause zwischen Vereinen
      await new Promise((r) => setTimeout(r, 900));
      return ok ? clubWappenUrl(String(club.tm_club_id)) : null;
    } catch {
      return null;
    }
  });
  resolveChain = task.catch(() => {});
  pendingResolve.set(ck, task);
  task.finally(() => pendingResolve.delete(ck));
  return task;
}

/** Spielart aus dem Wettbewerbsnamen ableiten (fürs ART-Filter/Badge) */
export function areaArt(g: AreaGame): string {
  const w = g.wettbewerb || '';
  if (/freundschaft|testspiel|friendly/i.test(w)) return 'Freundschaftsspiel';
  if (/pokal/i.test(w)) return 'Pokalspiel';
  if (/hallen/i.test(w)) return 'Hallenturnier';
  if (/turnier|cup/i.test(w)) return 'Turnier';
  return 'Punktspiel';
}

// ---------------------------------------------------------------------------
// Unsere eigenen Spieler (KMH-App, Spielerübersicht). Zuordnung zu den Spielen
// der Übersicht ausschließlich über den beim Spieler hinterlegten Verein +
// Altersklasse (kein fussball.de-Link nötig).
// ---------------------------------------------------------------------------

export interface KmhPlayer {
  id: string;
  name: string;
  club: string;   // Verein laut KMH-Spielerübersicht ("Dynamo Dresden U19", "SC Paderborn 07 II")
  league: string; // Liga laut Spielerübersicht ("U16 Regionalliga", "Regionalliga Nordost")
  category: string; // "Fußball" | "Handball" | "Funktionär" …
}

/** Spieler der KMH-Spielerübersicht laden (gleicher Filter wie dort) */
export async function loadKmhPlayers(): Promise<KmhPlayer[]> {
  const { data, error } = await supabase
    .from('player_details')
    .select('id, first_name, last_name, club, league, category')
    .or('provision_only.is.null,provision_only.eq.false')
    .limit(1000);
  if (error) { console.error('player_details laden fehlgeschlagen:', error); return []; }
  return ((data || []) as any[]).map((p) => ({
    id: p.id,
    name: `${p.first_name || ''} ${p.last_name || ''}`.trim(),
    club: p.club || '',
    league: p.league || '',
    category: p.category || '',
  }));
}

/** Altersklasse aus Verein/Liga der Spielerübersicht ("U19", sonst "Herren"; U20+ = Herren) */
function kmhAge(club: string, league: string): string {
  for (const src of [club, league]) {
    const m = src.match(/\bU[\s-]?(\d{2})\b/i);
    if (m) return parseInt(m[1], 10) >= 20 ? 'Herren' : 'U' + m[1];
  }
  return 'Herren';
}
/** Zweite/dritte Mannschaft? ("II", "III", "U23", "U21", fussball.de auch "1. FC Nürnberg 2",
 *  "… 3", "… 1.Hr") — Profis und Reserve nicht vermischen */
function kmhIsSecond(club: string): boolean {
  const c = (club || '').replace(/\s*\([^)]*\)/g, '').trim();
  return /\b(II|III|U[\s-]?2[0-9])\b/i.test(c) || /\s[23]$/.test(c);
}
/** Schlüssel für den Vereins-Abgleich: Altersklasse | Reserve-Flag | Vereinsbasis */
export function kmhClubKey(teamName: string, age: string): string {
  const base = clubBase(teamName.replace(/\bJugend\b/gi, ''));
  return `${age}|${kmhIsSecond(teamName) ? 1 : 0}|${base}`;
}

/** kmhClubKey(Verein, Altersklasse) -> Spielernamen */
export type KmhClubIndex = Map<string, string[]>;

export function buildKmhClubIndex(players: KmhPlayer[]): KmhClubIndex {
  const byClub: KmhClubIndex = new Map();
  for (const p of players) {
    if (!p.name || !p.club || /vereinslos/i.test(p.club)) continue;
    // Nur Fußballer aus dem Männer-/Junioren-Bereich (Handball, Funktionäre, Frauen-Ligen
    // haben keine Spiele in dieser Übersicht und würden sonst falsch am Männer-Team hängen)
    if (p.category && !/fu(ß|ss)ball/i.test(p.category)) continue;
    if (/frauen|women|juniorinnen/i.test(`${p.club} ${p.league}`)) continue;
    const key = kmhClubKey(p.club, kmhAge(p.club, p.league));
    const cur = byClub.get(key) || [];
    if (!cur.includes(p.name)) cur.push(p.name);
    byClub.set(key, cur);
  }
  return byClub;
}
