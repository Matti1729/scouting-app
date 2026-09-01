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
    // NLZ-Zusätze und Klammer-Anhänge ("LZ", "NLZ", "(BuLig/NLZ-Runde)") raus
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\b(N?LZ)\b/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Teamname auf die Vereins-Basis normalisieren ("1. FC Köln U15" -> "1 fc köln")
 *  für den Wappen-Lookup über berater_clubs (Jahreszahlen/II/U-Labels egal) */
export function clubBase(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\bu[\s-]?\d{1,2}\b/g, '')
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
    .replace(/\b(1|fc|sv|tsv|vfb|vfl|sc|tsg|spvgg|fsv|sg|bv|msv|ksv|dsc|djk|fv)\b/g, ' ')
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
  [/\btschechien|czech\b/, '3445'],
  [/\bengland\b/, '3299'],
  [/\bspanien|espana|españa\b/, '3375'],
  [/\bitalien|italia\b/, '3376'],
  [/\bportugal\b/, '3300'],
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
const CLUB_RESOLVE_CACHE_KEY = 'tm_club_resolve_v2';
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
      const { data } = await supabase.functions.invoke('transfermarkt-proxy', {
        body: { clubSearch: stripAge(teamName) },
      });
      const club = (data as any)?.club;
      // Plausibilität: gefundener Vereinsname muss zur Anfrage passen
      const rb = clubBase(club?.club_name || '');
      const ok = !!club && !!rb && (rb === b || rb.includes(b) || b.includes(rb) || clubCore(rb) === clubCore(b));
      c[b] = ok ? String(club.tm_club_id) : 'none';
      saveResolveCache();
      // TM nicht fluten: kleine Pause zwischen Suchen
      await new Promise((r) => setTimeout(r, 400));
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
