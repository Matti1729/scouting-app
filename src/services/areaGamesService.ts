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
      .select('league_key, match_key, kickoff_date, kickoff_time, home_name, away_name, home_team_id, wettbewerb, game_url, lat, lng, venue, venue_address')
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
    .trim();
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
    if (!m.has(b)) m.set(b, String(c.tm_club_id));
    const core = clubCore(b);
    if (core && !m.has(`core:${core}`)) m.set(`core:${core}`, String(c.tm_club_id));
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
  const clubId = map.get(b) || map.get(`core:${clubCore(b)}`);
  if (clubId) return `https://tmssl.akamaized.net/images/wappen/head/${clubId}.png`;
  // Nationalteams haben kein "head"-Wappen bei TM, aber "normquad"
  const ntId = nationalTeamId(b);
  return ntId ? `https://tmssl.akamaized.net/images/wappen/normquad/${ntId}.png` : null;
}

// ---------------------------------------------------------------------------
// On-Demand-Wappen: Vereine außerhalb unserer Ligen (Amateure usw.) einmalig
// über die TM-Schnellsuche auflösen; Ergebnis dauerhaft im localStorage cachen.
// ---------------------------------------------------------------------------
const CLUB_RESOLVE_CACHE_KEY = 'tm_club_resolve_v6';
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

export function resolveClubLogoUri(teamName: string): Promise<string | null> {
  const b = clubBase(teamName);
  if (!b) return Promise.resolve(null);
  const cache = loadResolveCache();
  if (cache[b]) return Promise.resolve(cache[b] === 'none' ? null : clubWappenUrl(cache[b]));
  const inFlight = pendingResolve.get(b);
  if (inFlight) return inFlight;
  const task = resolveChain.then(async (): Promise<string | null> => {
    const c = loadResolveCache();
    if (c[b]) return c[b] === 'none' ? null : clubWappenUrl(c[b]);
    try {
      // Plausibilität: gefundener Vereinsname muss zur Anfrage passen.
      // Auch ok: Kern-Tokens der einen Seite sind Teilmenge der anderen
      // ("SGV Freiberg" <-> "SGV Heilbronn-Freiberg")
      const plausible = (name: string | null | undefined): boolean => {
        const rb = clubBase(name || '');
        if (!rb) return false;
        if (rb === b || rb.includes(b) || b.includes(rb) || clubCore(rb) === clubCore(b)) return true;
        const ta = clubCore(b).split(/[\s-]+/).filter(Boolean);
        const tb = clubCore(rb).split(/[\s-]+/).filter(Boolean);
        if (!ta.length || !tb.length) return false;
        const [short, long] = ta.length <= tb.length ? [ta, new Set(tb)] : [tb, new Set(ta)];
        return short.every((t) => long.has(t));
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
      const candidates: string[] = [b];
      const core = clubCore(b);
      if (core && core.length >= 5 && core !== b) candidates.push(core);
      const parts = b.split(' ');
      if (parts.length >= 3) candidates.push(parts.slice(0, -1).join(' '));
      let club: any = null;
      for (const q of candidates) {
        const found = await search(q);
        if (found && plausible(found.club_name)) { club = found; break; }
        await new Promise((r) => setTimeout(r, 900));
      }
      const ok = !!club && plausible(club.club_name);
      if (ok) {
        c[b] = String(club.tm_club_id);
        saveResolveCache();
      } else if (!throttled) {
        // Nur als "nicht gefunden" merken, wenn TM wirklich geantwortet hat
        c[b] = 'none';
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
  pendingResolve.set(b, task);
  task.finally(() => pendingResolve.delete(b));
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
