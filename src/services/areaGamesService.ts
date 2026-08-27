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

/** Jahrgang aus Wettbewerb/Teamnamen ("U17"), sonst 'Herren' */
export function areaAge(g: AreaGame, leagueName: string): string {
  for (const src of [g.wettbewerb || '', g.home_name, g.away_name, leagueName]) {
    const m = src.match(/\bU[\s-]?(\d{2})\b/i);
    if (m) return 'U' + m[1];
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

/** "U19 SC Freiburg" -> "SC Freiburg" (Jahrgang steht in eigener Spalte) */
export function stripAge(name: string): string {
  return (name || '')
    .replace(/\s*U[\s-]?\d{2}\b/gi, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
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
