// Scout-Übersicht für die Berater: wer arbeitet mit der App, was hat er eingetragen.
import { supabase } from '../config/supabase';
import { currentUserId } from './currentUser';

export type ScoutEventKind = 'bericht' | 'spiel' | 'dabei' | 'watchlist';

export interface ScoutEvent {
  key: string;
  kind: ScoutEventKind;
  at: string;
  title: string;
  detail: string | null;
  rating: number | null;
  playerId: string | null;
}

export interface ScoutSummary {
  id: string;
  name: string;
  reports: number;
  matches: number;
  watchlist: number;
  lastAt: string | null;
  events: ScoutEvent[];
}

const BERATER_ROLES = '(admin,advisor,berater)';

async function loadScouts(): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase
    .from('advisors')
    .select('id, first_name, last_name')
    .eq('access_scouting', true)
    .not('role', 'in', BERATER_ROLES);
  if (error) throw error;
  return ((data || []) as { id: string; first_name: string | null; last_name: string | null }[]).map((a) => ({
    id: a.id,
    name: [a.first_name, a.last_name].filter(Boolean).join(' ') || 'Scout',
  }));
}

export async function loadScoutOverview(): Promise<ScoutSummary[]> {
  try {
    const scouts = await loadScouts();
    if (!scouts.length) return [];
    const ids = scouts.map((s) => s.id);
    const [reports, matches, attendance, watch] = await Promise.all([
      supabase
        .from('player_evaluations')
        .select('id, created_by, created_at, first_name, last_name, match_name, overall_rating, berater_player_id')
        .in('created_by', ids),
      supabase
        .from('scouting_matches')
        .select('id, created_by, created_at, home_team, away_team, match_date')
        .in('created_by', ids),
      supabase
        .from('scouting_match_attendance')
        .select('match_id, user_id, created_at, scouting_matches (home_team, away_team, match_date)')
        .in('user_id', ids),
      supabase
        .from('scout_watchlist')
        .select('id, owner_id, added_at, player_id, berater_players (player_name)')
        .in('owner_id', ids),
    ]);
    const firstError = reports.error || matches.error || attendance.error || watch.error;
    if (firstError) throw firstError;

    const byScout = new Map<string, ScoutSummary>(
      scouts.map((s) => [s.id, { ...s, reports: 0, matches: 0, watchlist: 0, lastAt: null, events: [] }])
    );
    const pairing = (m: any) => [m?.home_team, m?.away_team].filter(Boolean).join(' - ') || 'Spiel';

    for (const r of (reports.data || []) as any[]) {
      const s = byScout.get(r.created_by);
      if (!s) continue;
      s.reports++;
      s.events.push({
        key: `b${r.id}`, kind: 'bericht', at: r.created_at,
        title: [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Spieler',
        detail: r.match_name || null,
        rating: r.overall_rating > 0 ? r.overall_rating : null,
        playerId: r.berater_player_id || null,
      });
    }
    for (const m of (matches.data || []) as any[]) {
      const s = byScout.get(m.created_by);
      if (!s) continue;
      s.matches++;
      s.events.push({ key: `s${m.id}`, kind: 'spiel', at: m.created_at, title: pairing(m), detail: m.match_date || null, rating: null, playerId: null });
    }
    for (const a of (attendance.data || []) as any[]) {
      const s = byScout.get(a.user_id);
      if (!s) continue;
      s.matches++;
      s.events.push({
        key: `d${a.match_id}${a.user_id}`, kind: 'dabei', at: a.created_at,
        title: pairing(a.scouting_matches), detail: a.scouting_matches?.match_date || null, rating: null, playerId: null,
      });
    }
    for (const w of (watch.data || []) as any[]) {
      const s = byScout.get(w.owner_id);
      if (!s) continue;
      s.watchlist++;
      s.events.push({
        key: `w${w.id}`, kind: 'watchlist', at: w.added_at,
        title: w.berater_players?.player_name || 'Spieler', detail: null, rating: null, playerId: w.player_id,
      });
    }

    const result = [...byScout.values()];
    for (const s of result) {
      s.events.sort((a, b) => b.at.localeCompare(a.at));
      s.lastAt = s.events[0]?.at || null;
    }
    // Zuletzt Aktive oben, Scouts ohne Einträge unten
    return result.sort((a, b) => (b.lastAt || '').localeCompare(a.lastAt || '') || a.name.localeCompare(b.name, 'de'));
  } catch (err) {
    console.warn('loadScoutOverview fehlgeschlagen:', err);
    return [];
  }
}

/** Neue Scout-Berichte seit dem letzten Blick (für die Glocke) */
export async function loadNewScoutReports(): Promise<{ count: number; names: string[] }> {
  try {
    const scouts = await loadScouts();
    if (!scouts.length) return { count: 0, names: [] };
    const { data: seen, error: seenError } = await supabase
      .from('scout_activity_seen')
      .select('seen_at')
      .eq('user_id', currentUserId() || '')
      .maybeSingle();
    if (seenError) throw seenError;
    let query = supabase.from('player_evaluations').select('created_by').in('created_by', scouts.map((s) => s.id));
    if (seen?.seen_at) query = query.gt('created_at', seen.seen_at);
    const { data, error } = await query;
    if (error) throw error;
    const rows = (data || []) as { created_by: string }[];
    const ids = new Set(rows.map((r) => r.created_by));
    return { count: rows.length, names: scouts.filter((s) => ids.has(s.id)).map((s) => s.name.split(' ')[0]) };
  } catch (err) {
    console.warn('loadNewScoutReports fehlgeschlagen:', err);
    return { count: 0, names: [] };
  }
}

export async function markScoutActivitySeen(): Promise<void> {
  const userId = currentUserId();
  if (!userId) return;
  const { error } = await supabase
    .from('scout_activity_seen')
    .upsert({ user_id: userId, seen_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) console.warn('markScoutActivitySeen fehlgeschlagen:', error);
}
