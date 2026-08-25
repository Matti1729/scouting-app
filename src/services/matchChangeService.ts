// matchChangeService.ts - Abgleich der Scouting-Spiele gegen den täglichen
// fussball.de-Sync (area_games, KMH-Seite). Erkennt nachträgliche Änderungen
// an übernommenen Spielen: Datum/Zeit verlegt, Spielort geändert, oder Spiel
// nicht mehr im Spielplan (evtl. abgesetzt).
//
// Grenzen: funktioniert nur für Spiele mit fussball.de-URL, deren Liga vom
// Umgebungs-Sync abgedeckt ist. "Nicht mehr gelistet" ist ein weiches Signal —
// area_games hält je Team nur die nächsten ~10 Spiele, sehr weit entfernte
// Termine sind dort noch nicht drin. Deshalb melden wir das nur für Spiele
// in den nächsten 14 Tagen, deren match_key vorher auffindbar gewesen sein muss.

import { supabase } from '../config/supabase';
import { extractMatchId } from './fussballDeService';
import { DbMatch, updateMatch } from './matchService';

export interface MatchChangeInfo {
  matchKey: string;
  // Neue Werte aus dem Sync (nur gesetzt, wenn abweichend)
  newDate?: string;      // ISO YYYY-MM-DD
  newTime?: string;      // HH:MM
  newVenue?: string;     // Anzeigename des Platzes
  newVenueAddress?: string;
  // Spiel (in den nächsten 14 Tagen) nicht mehr im Sync gefunden
  missing?: boolean;
}

// "12.09.2026" / "12.09.26" / "2026-09-12" → "2026-09-12"
function toIso(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const s = dateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (!m) return null;
  let year = m[3];
  if (year.length === 2) year = `20${year}`;
  return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

// "15:00:00" / "15:00" / "15.00" → "15:00"
function toHM(timeStr: string | null | undefined): string | null {
  if (!timeStr) return null;
  const m = timeStr.trim().match(/^(\d{1,2})[:.](\d{2})/);
  if (!m) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

// Lockerer Orts-Vergleich: gleicher Ort, wenn einer den anderen enthält
// (Scouting-"location" ist oft Freitext wie "Sportpark XY, Musterstr. 1").
function sameVenue(location: string | null, venue: string | null, address: string | null): boolean {
  if (!location) return false;
  const norm = (x: string) => x.toLowerCase().replace(/\s+/g, ' ').trim();
  const loc = norm(location);
  for (const cand of [venue, address]) {
    if (!cand) continue;
    const c = norm(cand);
    if (loc.includes(c) || c.includes(loc)) return true;
  }
  return false;
}

/**
 * Prüft aktive (nicht archivierte, zukünftige) Spiele mit fussball.de-URL
 * gegen area_games und liefert je Match-ID die erkannten Abweichungen.
 */
export async function checkMatchChanges(
  matches: DbMatch[]
): Promise<Map<string, MatchChangeInfo>> {
  const changes = new Map<string, MatchChangeInfo>();
  try {
    const today = new Date().toISOString().slice(0, 10);
    const soon = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);

    // Kandidaten: zukünftig, nicht archiviert, mit auswertbarer fussball.de-URL
    const candidates: { match: DbMatch; key: string; iso: string }[] = [];
    for (const m of matches) {
      if (m.is_archived || !m.fussball_de_url) continue;
      const iso = toIso(m.match_date);
      if (!iso || iso < today) continue;
      const key = extractMatchId(m.fussball_de_url);
      if (!key) continue;
      candidates.push({ match: m, key, iso });
    }
    if (!candidates.length) return changes;

    const keys = [...new Set(candidates.map(c => c.key))];
    const areaByKey = new Map<string, any>();
    for (let i = 0; i < keys.length; i += 100) {
      const { data, error } = await supabase
        .from('area_games')
        .select('match_key, kickoff_date, kickoff_time, venue, venue_address')
        .in('match_key', keys.slice(i, i + 100));
      if (error) throw error;
      for (const row of data || []) areaByKey.set(row.match_key, row);
    }

    for (const { match, key, iso } of candidates) {
      const area = areaByKey.get(key);
      if (!area) {
        // Weiches Signal: nur für zeitnahe Spiele melden (sonst schlicht
        // außerhalb des ~10-Spiele-Horizonts des Syncs).
        if (iso <= soon) changes.set(match.id, { matchKey: key, missing: true });
        continue;
      }
      const info: MatchChangeInfo = { matchKey: key };
      if (area.kickoff_date && area.kickoff_date !== iso) info.newDate = area.kickoff_date;
      const areaTime = toHM(area.kickoff_time);
      const matchTime = toHM(match.match_time);
      if (areaTime && matchTime && areaTime !== matchTime) info.newTime = areaTime;
      if (area.venue_address && !sameVenue(match.location, area.venue, area.venue_address)) {
        info.newVenue = area.venue || area.venue_address;
        info.newVenueAddress = area.venue_address;
      }
      if (info.newDate || info.newTime || info.newVenue) changes.set(match.id, info);
    }
  } catch (err) {
    // Abgleich ist Komfort — Fehler nie in den Screen durchschlagen lassen
    console.warn('matchChangeService: Abgleich fehlgeschlagen', err);
  }
  return changes;
}

/**
 * Übernimmt die erkannten Änderungen in das Scouting-Spiel (DB).
 * Gibt die aktualisierten Felder zurück (für lokales State-Update).
 */
export async function applyMatchChange(
  matchId: string,
  info: MatchChangeInfo
): Promise<{ success: boolean; updates?: { match_date?: string; match_time?: string; location?: string }; error?: string }> {
  const updates: { match_date?: string; match_time?: string; location?: string } = {};
  if (info.newDate) updates.match_date = info.newDate;
  if (info.newTime) updates.match_time = info.newTime;
  if (info.newVenueAddress) {
    // Venue-Name enthält die Adresse oft schon — dann nicht doppelt anhängen
    updates.location = info.newVenue && !info.newVenue.includes(info.newVenueAddress)
      ? `${info.newVenue}, ${info.newVenueAddress}`
      : (info.newVenue || info.newVenueAddress);
  }
  if (!Object.keys(updates).length) return { success: true, updates: {} };
  const res = await updateMatch(matchId, updates);
  if (!res.success) return { success: false, error: res.error };
  return { success: true, updates };
}
