// beraterService.ts - Beraterstatus-Tracker Service
// Kommuniziert mit Supabase (direkte DB-Queries + Edge Function für Scans)

import { supabase } from '../config/supabase';

const SUPABASE_URL = 'https://ozggtruvnwozhwjbznsm.supabase.co';
const EDGE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/berater-scan`;

async function getAuthToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Nicht eingeloggt');
  return session.access_token;
}

// ============================================================================
// TYPES
// ============================================================================

export interface BeraterPlayer {
  id: string;
  club_id: string;
  player_name: string;
  tm_player_id: string;
  tm_profile_url: string;
  birth_date: string | null;
  position: string | null;
  current_agent_name: string | null;
  current_agent_company: string | null;
  agent_url: string | null;
  has_agent: boolean;
  agent_updated_at: string | null;
  agent_since: string | null;
  last_scanned_at: string | null;
  is_active: boolean;
  is_vereinslos: boolean;
  market_value: string | null;
  // Joined
  club_name?: string;
  league_id?: string;
  league_name?: string;
}

export interface BeraterChange {
  id: string;
  player_id: string;
  previous_agent_name: string | null;
  previous_agent_company: string | null;
  new_agent_name: string | null;
  new_agent_company: string | null;
  player_name: string;
  club_name: string | null;
  league_id: string | null;
  birth_date: string | null;
  tm_profile_url: string | null;
  detected_at: string;
}

export interface ScanState {
  current_cycle: number;
  next_club_index: number;
  total_clubs: number;
  cycle_started_at: string | null;
  last_scan_at: string | null;
  last_scanned_club: string | null;
  is_running: boolean;
  error_count: number;
}

export interface BeraterStats {
  totalPlayers: number;
  playersWithoutAgent: number;
  totalClubs: number;
  totalChanges: number;
  recentChanges: number;
  activeLeagues: number;
}

export interface WatchlistEntry {
  id: string;
  player_id: string;
  notes: string | null;
  rating: number | null;
  added_at: string;
  // Joined player data
  player?: BeraterPlayer;
}

export interface PlayerEvaluation {
  id: string;
  player_id: string;
  status: 'interessant' | 'nicht_interessant';
  rating: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type AgentFilter = 'all' | 'without_agent';
export type AgeFilter = string; // 'all' | 'herren' | 'younger' | '2007' | '2008' | '2009' | '2010'

// ============================================================================
// SPIELER LADEN
// ============================================================================

/**
 * Lädt alle Spieler mit optionalen Filtern.
 * Beraterzustand- und Liga-Filter auf DB-Ebene, Alter-Filter clientseitig.
 */
export async function loadAllPlayers(options?: {
  leagueIds?: string[];
  agentFilter?: AgentFilter;
  ageFilter?: AgeFilter | string[];
}): Promise<{ players: BeraterPlayer[]; total: number }> {
  const agentFilter = options?.agentFilter || 'all';
  const PAGE_SIZE = 1000;

  function buildQuery() {
    let query = supabase
      .from('berater_players')
      .select(`
        *,
        berater_clubs!inner (
          club_name,
          league_id,
          berater_leagues (name)
        )
      `, { count: 'exact' })
      .eq('is_active', true)
      .not('agent_updated_at', 'is', null);

    if (agentFilter === 'without_agent') {
      query = query.or('has_agent.eq.false,current_agent_name.eq.Familienangehörige');
    }

    if (options?.leagueIds && options.leagueIds.length > 0) {
      if (options.leagueIds.length === 1) {
        query = query.eq('berater_clubs.league_id', options.leagueIds[0]);
      } else {
        query = query.in('berater_clubs.league_id', options.leagueIds);
      }
    }

    return query.order('player_name', { ascending: true });
  }

  // Erste Seite laden (mit count)
  const { data: firstPage, error, count } = await buildQuery().range(0, PAGE_SIZE - 1);

  if (error) {
    console.error('Error loading players:', error);
    return { players: [], total: 0 };
  }

  const allData: any[] = [...(firstPage || [])];
  const totalCount = count || 0;

  // Restliche Seiten parallel laden
  if (totalCount > PAGE_SIZE) {
    const pages = Math.ceil(totalCount / PAGE_SIZE);
    const promises = [];
    for (let i = 1; i < pages; i++) {
      promises.push(
        buildQuery().range(i * PAGE_SIZE, (i + 1) * PAGE_SIZE - 1).then(r => r.data || [])
      );
    }
    const results = await Promise.all(promises);
    for (const page of results) {
      allData.push(...page);
    }
  }

  let players: BeraterPlayer[] = allData.map((p: any) => ({
    ...p,
    club_name: p.berater_clubs?.club_name,
    league_id: p.berater_clubs?.league_id,
    league_name: p.berater_clubs?.berater_leagues?.name,
  }));

  // Jahrgangs-Filter (clientseitig, da birth_date als Text DD.MM.YYYY gespeichert)
  const ageFilter = options?.ageFilter;
  const ageFilters = Array.isArray(ageFilter) ? ageFilter : (ageFilter && ageFilter !== 'all') ? [ageFilter] : [];

  if (ageFilters.length > 0) {
    const { years: youthYears, herrenCutoff } = getYouthYears();
    const youngestShownYear = youthYears[0];

    players = players.filter(p => {
      if (!p.birth_date) return false;
      const birthYear = extractBirthYear(p.birth_date);
      if (birthYear === null) return false;

      // Spieler passt wenn er zu EINEM der ausgewählten Filter passt
      return ageFilters.some(af => {
        if (af === 'herren') return birthYear <= herrenCutoff;
        if (af === 'younger') return birthYear > youngestShownYear;
        const yearNum = parseInt(af);
        if (!isNaN(yearNum)) return birthYear === yearNum;
        return false;
      });
    });
  }

  return { players, total: ageFilters.length > 0 ? players.length : totalCount };
}

/**
 * Berechnet die aktuellen Jugendjahrgänge basierend auf dem 1.7.-Stichtag.
 */
export function getYouthYears(): { years: number[]; herrenCutoff: number } {
  const now = new Date();
  const isAfterJuly = now.getMonth() >= 6; // Juli = 6 (0-indexed)

  // Ältester Jugendjahrgang (wird am 1.7. zu Herren)
  const oldestYouth = isAfterJuly
    ? now.getFullYear() - 18
    : now.getFullYear() - 19;

  // 4 Jugendjahrgänge anzeigen
  const years = [
    oldestYouth + 3,  // jüngste (z.B. 2010)
    oldestYouth + 2,  // z.B. 2009
    oldestYouth + 1,  // z.B. 2008
    oldestYouth,      // älteste Jugend (z.B. 2007)
  ];

  return { years, herrenCutoff: oldestYouth - 1 }; // Herren = z.B. ≤2006
}

function extractBirthYear(birthDate: string): number | null {
  const parts = birthDate.split('.');
  if (parts.length !== 3) return null;
  const year = parseInt(parts[2]);
  return isNaN(year) ? null : year;
}

/**
 * Lädt Beraterwechsel (Änderungs-Log), default letzte 4 Wochen
 */
export async function loadAgentChanges(options?: {
  leagueId?: string;
  sinceDays?: number;
  limit?: number;
  offset?: number;
}): Promise<{ changes: BeraterChange[]; total: number }> {
  const limit = options?.limit || 100;
  const offset = options?.offset || 0;
  const sinceDays = options?.sinceDays ?? 28;

  const sinceDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();

  let query = supabase
    .from('berater_changes')
    .select('*', { count: 'exact' })
    .gte('detected_at', sinceDate)
    .order('detected_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (options?.leagueId) {
    query = query.eq('league_id', options.leagueId);
  }

  const { data, error, count } = await query;

  if (error) {
    console.error('Error loading agent changes:', error);
    return { changes: [], total: 0 };
  }

  return { changes: data || [], total: count || 0 };
}

// ============================================================================
// SPIELER-HISTORIE
// ============================================================================

/**
 * Lädt die komplette Berater-Historie eines Spielers (alle Changes chronologisch)
 */
export async function loadPlayerHistory(playerId: string): Promise<BeraterChange[]> {
  const { data, error } = await supabase
    .from('berater_changes')
    .select('*')
    .eq('player_id', playerId)
    .order('detected_at', { ascending: false });

  if (error) {
    console.error('Error loading player history:', error);
    return [];
  }

  return data || [];
}

// ============================================================================
// WATCHLIST
// ============================================================================

/**
 * Lädt alle Watchlist-Einträge mit Spielerdaten
 */
export async function loadWatchlist(): Promise<WatchlistEntry[]> {
  const { data, error } = await supabase
    .from('berater_watchlist')
    .select(`
      *,
      berater_players (
        *,
        berater_clubs (
          club_name,
          league_id,
          berater_leagues (name)
        )
      )
    `)
    .order('added_at', { ascending: false });

  if (error) {
    console.error('Error loading watchlist:', error);
    return [];
  }

  return (data || []).map((w: any) => ({
    ...w,
    player: w.berater_players ? {
      ...w.berater_players,
      club_name: w.berater_players.berater_clubs?.club_name,
      league_id: w.berater_players.berater_clubs?.league_id,
      league_name: w.berater_players.berater_clubs?.berater_leagues?.name,
    } : undefined,
  }));
}

/**
 * Spieler zur Watchlist hinzufügen
 */
export async function addToWatchlist(playerId: string, notes?: string): Promise<boolean> {
  const { error } = await supabase
    .from('berater_watchlist')
    .upsert({ player_id: playerId, notes }, { onConflict: 'player_id' });

  if (error) {
    console.error('Error adding to watchlist:', error);
    return false;
  }
  return true;
}

/**
 * Spieler von Watchlist entfernen
 */
export async function removeFromWatchlist(playerId: string): Promise<boolean> {
  const { error } = await supabase
    .from('berater_watchlist')
    .delete()
    .eq('player_id', playerId);

  if (error) {
    console.error('Error removing from watchlist:', error);
    return false;
  }
  return true;
}

/**
 * Watchlist-Eintrag aktualisieren (Notizen und/oder Rating)
 */
export async function updateWatchlistEntry(playerId: string, updates: { notes?: string | null; rating?: number | null }): Promise<boolean> {
  const { error } = await supabase
    .from('berater_watchlist')
    .update(updates)
    .eq('player_id', playerId);

  if (error) {
    console.error('Error updating watchlist entry:', error);
    return false;
  }
  return true;
}

/**
 * Prüft ob ein Spieler auf der Watchlist ist
 */
export async function isOnWatchlist(playerId: string): Promise<boolean> {
  const { data } = await supabase
    .from('berater_watchlist')
    .select('id')
    .eq('player_id', playerId)
    .maybeSingle();

  return !!data;
}

// ============================================================================
// SCAN-STEUERUNG (Edge Function)
// ============================================================================

async function callEdgeFunction(action: string, params?: Record<string, any>) {
  const { data, error } = await supabase.functions.invoke('berater-scan', {
    body: { action, ...params },
  });

  if (error) {
    throw new Error(`Edge function error: ${error.message}`);
  }

  return data;
}

/**
 * Scan-Status + Statistiken laden
 */
export async function loadScanStatus(): Promise<{
  scanState: ScanState;
  stats: BeraterStats;
}> {
  // Direkt aus Supabase laden statt über Edge Function
  const { data: state } = await supabase
    .from('berater_scan_state')
    .select('*')
    .eq('id', 1)
    .single();

  const { count: totalPlayers } = await supabase
    .from('berater_players')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true);

  const { count: playersWithoutAgent } = await supabase
    .from('berater_players')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)
    .eq('has_agent', false);

  const { count: totalClubs } = await supabase
    .from('berater_clubs')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true);

  const { count: totalChanges } = await supabase
    .from('berater_changes')
    .select('*', { count: 'exact', head: true });

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { count: recentChanges } = await supabase
    .from('berater_changes')
    .select('*', { count: 'exact', head: true })
    .gte('detected_at', sevenDaysAgo);

  const { count: activeLeagues } = await supabase
    .from('berater_leagues')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true);

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
  };
}

/**
 * Vereine aus TM laden (bootstrap)
 */
export async function bootstrapClubs(): Promise<{
  clubsAdded: number;
  clubsDeactivated: number;
  leagues: number;
}> {
  return callEdgeFunction('bootstrap_clubs');
}

/**
 * Nächsten Verein scannen
 */
export async function scanNextBatch(): Promise<{
  scanned: boolean;
  clubName?: string;
  playersScanned?: number;
  changesDetected?: number;
  newPlayers?: number;
  cycleProgress?: string;
  cycleComplete?: boolean;
}> {
  return callEdgeFunction('scan_next_batch');
}

/**
 * Bestimmten Verein scannen
 */
export async function scanClub(clubId: string) {
  return callEdgeFunction('scan_club', { clubId });
}

// ============================================================================
// LIGEN
// ============================================================================

const COUNTRY_ORDER = ['DE', 'AT', 'NL'];

export async function loadLeagues(): Promise<Array<{ id: string; name: string; country: string; is_active: boolean; tier: number }>> {
  const { data, error } = await supabase
    .from('berater_leagues')
    .select('id, name, country, is_active, tier')
    .order('tier', { ascending: true });

  if (error) {
    console.error('Error loading leagues:', error);
    return [];
  }

  return (data || []).sort((a, b) => {
    const ca = COUNTRY_ORDER.indexOf(a.country);
    const cb = COUNTRY_ORDER.indexOf(b.country);
    return (ca === -1 ? 99 : ca) - (cb === -1 ? 99 : cb);
  });
}

// ============================================================================
// SPIELBEWERTUNGEN (aus Spiele-Screen)
// ============================================================================

export interface MatchEvaluation {
  id: string;
  match_id: string | null;
  match_name: string | null;
  match_date: string | null;
  age_group: string | null;
  first_name: string | null;
  last_name: string | null;
  jersey_number: number | null;
  current_club: string | null;
  positions: string | null;
  transfermarkt_url: string | null;
  agent_name: string | null;
  birth_date: string | null;
  overall_rating: number | null;
  notes: string | null;
  body_structure: any | null;
  speed_athleticism: any | null;
}

export async function loadMatchEvaluationsForPlayer(
  playerName: string,
  tmProfileUrl?: string | null,
  beraterPlayerId?: string | null
): Promise<MatchEvaluation[]> {
  // 0. Bevorzugt über die feste Verknüpfung berater_player_id (seit Migration
  //    2026-08-26 die zuverlässigste Identität, unabhängig von Namen/URLs)
  if (beraterPlayerId) {
    const { data } = await supabase
      .from('player_evaluations')
      .select('id, match_id, match_name, match_date, age_group, first_name, last_name, jersey_number, current_club, positions, transfermarkt_url, agent_name, birth_date, overall_rating, notes, body_structure, speed_athleticism')
      .eq('berater_player_id', beraterPlayerId)
      .order('match_date', { ascending: false });
    if (data && data.length > 0) return data;
  }

  // Spielername aufteilen für Suche
  const parts = playerName.trim().split(/\s+/);
  const lastName = parts[parts.length - 1];
  const firstName = parts.length > 1 ? parts.slice(0, -1).join(' ') : null;

  // Platzhalter-Name ohne TM-URL: Namenssuche wäre mehrdeutig ("k.A.")
  if (!tmProfileUrl && isPlaceholderName(lastName)) return [];

  let results: MatchEvaluation[] = [];

  // 1. Per TM-URL suchen (zuverlässigste Methode)
  if (tmProfileUrl) {
    const { data } = await supabase
      .from('player_evaluations')
      .select('id, match_id, match_name, match_date, age_group, first_name, last_name, jersey_number, current_club, positions, transfermarkt_url, agent_name, birth_date, overall_rating, notes, body_structure, speed_athleticism')
      .eq('transfermarkt_url', tmProfileUrl)
      .order('match_date', { ascending: false });
    if (data && data.length > 0) return data;
  }

  // 2. Per Name suchen
  if (lastName) {
    let query = supabase
      .from('player_evaluations')
      .select('id, match_id, match_name, match_date, age_group, first_name, last_name, jersey_number, current_club, positions, transfermarkt_url, agent_name, birth_date, overall_rating, notes, body_structure, speed_athleticism')
      .ilike('last_name', lastName);

    if (firstName) {
      query = query.ilike('first_name', firstName);
    }

    const { data } = await query.order('match_date', { ascending: false });
    if (data) results = data;
  }

  return results;
}

// ============================================================================
// SPIELER-STATISTIKEN / VORSCHLÄGE
// ============================================================================

export interface PlayerStat {
  id: string;
  player_id: string | null;
  tm_player_id: string;
  player_name: string;
  league_id: string;
  club_name: string | null;
  stat_type: 'goals' | 'assists';
  stat_value: number;
  games_played: number | null;
  rank_in_league: number | null;
  season: string | null;
  tm_profile_url: string | null;
  birth_date: string | null;
  position: string | null;
  updated_at: string;
  // Joined data
  league_name?: string;
  // Agent info (from berater_players)
  current_agent_name?: string | null;
  current_agent_company?: string | null;
  has_agent?: boolean;
  // Watchlist status
  is_on_watchlist?: boolean;
}

const RANKINGS_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/fetch-player-rankings`;

/**
 * Lädt vorgeschlagene Spieler (Top-Torschützen oder Vorlagengeber)
 * Filtert bereits auf Watchlist befindliche Spieler aus
 */
export async function loadSuggestedPlayers(
  statType: 'goals' | 'assists',
  options?: {
    leagueIds?: string[];
    limit?: number;
  }
): Promise<PlayerStat[]> {
  const limit = options?.limit || 100;

  let query = supabase
    .from('berater_player_stats')
    .select(`
      *,
      berater_leagues!inner(name),
      berater_players(current_agent_name, current_agent_company, has_agent, birth_date, berater_clubs(club_name))
    `)
    .eq('stat_type', statType)
    .order('stat_value', { ascending: false })
    .order('rank_in_league', { ascending: true })
    .limit(limit);

  if (options?.leagueIds && options.leagueIds.length > 0) {
    query = query.in('league_id', options.leagueIds);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error loading suggested players:', error);
    return [];
  }

  if (!data) return [];

  // Watchlist-Status hinzufügen
  const { data: watchlist } = await supabase
    .from('berater_watchlist')
    .select('player_id');

  const watchlistPlayerIds = new Set(
    (watchlist || []).map(w => w.player_id)
  );

  // Auch tm_player_ids von Watchlist-Spielern sammeln
  const { data: watchlistPlayers } = await supabase
    .from('berater_players')
    .select('tm_player_id')
    .in('id', Array.from(watchlistPlayerIds));

  const watchlistTmIds = new Set(
    (watchlistPlayers || []).map(p => p.tm_player_id)
  );

  const rawPlayers: PlayerStat[] = data.map(row => ({
    id: row.id,
    player_id: row.player_id,
    tm_player_id: row.tm_player_id,
    player_name: row.player_name,
    league_id: row.league_id,
    // Präferiere club_name aus berater_players -> berater_clubs (aktueller), dann aus stats
    club_name: row.berater_players?.berater_clubs?.club_name || row.club_name,
    stat_type: row.stat_type,
    stat_value: row.stat_value,
    games_played: row.games_played,
    rank_in_league: row.rank_in_league,
    season: row.season,
    tm_profile_url: row.tm_profile_url,
    // Präferiere birth_date aus berater_players (verifiziert), dann aus stats
    birth_date: row.berater_players?.birth_date || row.birth_date,
    position: row.position,
    updated_at: row.updated_at,
    league_name: row.berater_leagues?.name,
    current_agent_name: row.berater_players?.current_agent_name ?? null,
    current_agent_company: row.berater_players?.current_agent_company ?? null,
    has_agent: row.berater_players?.has_agent ?? false,
    is_on_watchlist: watchlistTmIds.has(row.tm_player_id) ||
                     (row.player_id && watchlistPlayerIds.has(row.player_id)),
  }));

  // Stats aggregieren für Spieler die in mehreren Ligen spielen (z.B. Vorrunde + Hauptrunde)
  const aggregatedMap = new Map<string, PlayerStat>();
  for (const player of rawPlayers) {
    const key = player.tm_player_id;
    if (aggregatedMap.has(key)) {
      const existing = aggregatedMap.get(key)!;
      existing.stat_value += player.stat_value;
      if (existing.games_played !== null && player.games_played !== null) {
        existing.games_played = existing.games_played + player.games_played;
      } else if (player.games_played !== null) {
        existing.games_played = player.games_played;
      }
    } else {
      aggregatedMap.set(key, { ...player });
    }
  }

  // Nach aggregiertem stat_value sortieren
  const players = Array.from(aggregatedMap.values())
    .sort((a, b) => b.stat_value - a.stat_value);

  return players;
}

/**
 * Lädt Statistiken für einen bestimmten Spieler
 */
export async function loadPlayerStats(tmPlayerId: string): Promise<PlayerStat[]> {
  const { data, error } = await supabase
    .from('berater_player_stats')
    .select(`
      *,
      berater_leagues!inner(name)
    `)
    .eq('tm_player_id', tmPlayerId)
    .order('stat_value', { ascending: false });

  if (error) {
    console.error('Error loading player stats:', error);
    return [];
  }

  return (data || []).map(row => ({
    ...row,
    league_name: row.berater_leagues?.name,
  }));
}

/**
 * Startet das Abrufen der Rankings von Transfermarkt (in Batches)
 * Ruft mehrere Batches nacheinander auf bis alle Ligen verarbeitet sind
 */
export async function refreshPlayerRankings(
  onProgress?: (current: number, total: number) => void
): Promise<{
  success: boolean;
  message: string;
  stats?: {
    leaguesProcessed: number;
    goalsEntries: number;
    assistsEntries: number;
  };
  errors?: string[];
}> {
  try {
    let batchIndex = 0;
    let hasMore = true;
    let totalLeaguesProcessed = 0;
    let totalGoals = 0;
    let totalAssists = 0;
    let totalLeagues = 0;
    const allErrors: string[] = [];

    while (hasMore) {
      console.log(`Fetching batch ${batchIndex}...`);

      const token = await getAuthToken();
      const response = await fetch(`${RANKINGS_FUNCTION_URL}?action=fetch_batch&batch=${batchIndex}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();

      totalLeaguesProcessed += result.stats?.leaguesProcessed || 0;
      totalGoals += result.stats?.goalsEntries || 0;
      totalAssists += result.stats?.assistsEntries || 0;
      totalLeagues = result.stats?.totalLeagues || totalLeagues;

      if (result.errors) {
        allErrors.push(...result.errors);
      }

      hasMore = result.batch?.hasMore || false;
      batchIndex = result.batch?.next ?? -1;

      // Progress callback
      if (onProgress && totalLeagues > 0) {
        onProgress(totalLeaguesProcessed, totalLeagues);
      }

      console.log(`Batch complete: ${totalLeaguesProcessed}/${totalLeagues} leagues, hasMore: ${hasMore}`);
    }

    return {
      success: true,
      message: `${totalLeaguesProcessed} Ligen verarbeitet`,
      stats: {
        leaguesProcessed: totalLeaguesProcessed,
        goalsEntries: totalGoals,
        assistsEntries: totalAssists,
      },
      errors: allErrors.length > 0 ? allErrors : undefined,
    };
  } catch (error) {
    console.error('Error refreshing rankings:', error);
    return {
      success: false,
      message: `Fehler: ${error}`,
    };
  }
}

/**
 * Lädt Statistik-Übersicht (Anzahl Einträge, letztes Update)
 */
export async function loadRankingsStats(): Promise<{
  goalsCount: number;
  assistsCount: number;
  lastUpdate: string | null;
}> {
  const { count: goalsCount } = await supabase
    .from('berater_player_stats')
    .select('*', { count: 'exact', head: true })
    .eq('stat_type', 'goals');

  const { count: assistsCount } = await supabase
    .from('berater_player_stats')
    .select('*', { count: 'exact', head: true })
    .eq('stat_type', 'assists');

  const { data: latestUpdate } = await supabase
    .from('berater_player_stats')
    .select('updated_at')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    goalsCount: goalsCount || 0,
    assistsCount: assistsCount || 0,
    lastUpdate: latestUpdate?.updated_at || null,
  };
}

/**
 * Fügt einen Spieler aus den Statistiken zur Watchlist hinzu
 * Erstellt den Spieler in berater_players falls noch nicht vorhanden
 */
export async function addStatPlayerToWatchlist(stat: PlayerStat, notes?: string): Promise<boolean> {
  try {
    let playerId = stat.player_id;

    // Wenn Spieler noch nicht in berater_players, zuerst anlegen
    if (!playerId) {
      const { data: newPlayer, error: insertError } = await supabase
        .from('berater_players')
        .insert({
          tm_player_id: stat.tm_player_id,
          player_name: stat.player_name,
          tm_profile_url: stat.tm_profile_url || '',
          birth_date: stat.birth_date,
          position: stat.position,
          is_active: true,
          has_agent: false,
        })
        .select('id')
        .single();

      if (insertError) {
        // Vielleicht existiert der Spieler schon (race condition)
        const { data: existing } = await supabase
          .from('berater_players')
          .select('id')
          .eq('tm_player_id', stat.tm_player_id)
          .maybeSingle();

        if (existing) {
          playerId = existing.id;
        } else {
          console.error('Error creating player:', insertError);
          return false;
        }
      } else {
        playerId = newPlayer.id;
      }

      // Auch berater_player_stats aktualisieren mit der neuen player_id
      await supabase
        .from('berater_player_stats')
        .update({ player_id: playerId })
        .eq('tm_player_id', stat.tm_player_id);
    }

    // Zur Watchlist hinzufügen
    return addToWatchlist(playerId!, notes);
  } catch (error) {
    console.error('Error adding stat player to watchlist:', error);
    return false;
  }
}

// ============================================================================
// SPIELER-BEWERTUNGEN (Evaluations)
// ============================================================================

/**
 * Speichert eine Spielerbewertung (Upsert: erstellt oder aktualisiert)
 */
export async function savePlayerEvaluation(
  playerId: string,
  status: 'interessant' | 'nicht_interessant',
  rating?: number | null,
  notes?: string | null
): Promise<boolean> {
  const { error } = await supabase
    .from('berater_player_evaluations')
    .upsert(
      {
        player_id: playerId,
        status,
        rating: rating ?? null,
        notes: notes ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'player_id' }
    );

  if (error) {
    console.error('Error saving evaluation:', error);
    return false;
  }
  return true;
}

/**
 * Lädt die Bewertung eines einzelnen Spielers
 */
export async function loadPlayerEvaluation(playerId: string): Promise<PlayerEvaluation | null> {
  const { data, error } = await supabase
    .from('berater_player_evaluations')
    .select('*')
    .eq('player_id', playerId)
    .maybeSingle();

  if (error) {
    console.error('Error loading evaluation:', error);
    return null;
  }
  return data;
}

/**
 * Lädt alle Bewertungen als Map<player_id, PlayerEvaluation> für Listen-Einfärbung
 */
export async function loadAllEvaluations(): Promise<Map<string, PlayerEvaluation>> {
  const { data, error } = await supabase
    .from('berater_player_evaluations')
    .select('*');

  if (error) {
    console.error('Error loading evaluations:', error);
    return new Map();
  }

  const map = new Map<string, PlayerEvaluation>();
  for (const ev of data || []) {
    map.set(ev.player_id, ev);
  }
  return map;
}

/**
 * Aktualisiert nur die Notizen einer bestehenden Bewertung
 */
export async function updateEvaluationNotes(playerId: string, notes: string | null): Promise<boolean> {
  const { error } = await supabase
    .from('berater_player_evaluations')
    .update({ notes, updated_at: new Date().toISOString() })
    .eq('player_id', playerId);

  if (error) {
    console.error('Error updating notes:', error);
    return false;
  }
  return true;
}

/**
 * Aktualisiert nur das Rating einer bestehenden Bewertung
 */
export async function updateEvaluationRating(playerId: string, rating: number | null): Promise<boolean> {
  const { error } = await supabase
    .from('berater_player_evaluations')
    .update({ rating, updated_at: new Date().toISOString() })
    .eq('player_id', playerId);

  if (error) {
    console.error('Error updating rating:', error);
    return false;
  }
  return true;
}

export async function deletePlayerEvaluation(playerId: string): Promise<boolean> {
  const { error } = await supabase
    .from('berater_player_evaluations')
    .delete()
    .eq('player_id', playerId);

  if (error) {
    console.error('Error deleting evaluation:', error);
    return false;
  }
  return true;
}

// ============================================================================
// LINEUP-INTEGRATION: Berater-Status für Aufstellungsspieler laden
// ============================================================================

interface LineupPlayerInput {
  id: string;
  name: string;
  vorname: string;
  transfermarkt_url?: string;
}

export interface BeraterStatusResult {
  status: 'interessant' | 'nicht_interessant' | 'watchlist';
  beraterPlayerId: string;
}

/**
 * Lädt Berater-Evaluierungen + Watchlist und matcht sie gegen Lineup-Spieler.
 * Matching: 1. Transfermarkt-URL, 2. Nachname
 */
export async function loadBeraterStatusForLineup(
  players: LineupPlayerInput[]
): Promise<Map<string, BeraterStatusResult>> {
  const result = new Map<string, BeraterStatusResult>();
  if (players.length === 0) return result;

  // Alle Evaluierungen mit Spielerdaten laden
  const { data: evals } = await supabase
    .from('berater_player_evaluations')
    .select('player_id, status, berater_players(player_name, tm_profile_url)');

  // Alle Watchlist-Einträge mit Spielerdaten laden
  const { data: watchlist } = await supabase
    .from('berater_watchlist')
    .select('player_id, berater_players(player_name, tm_profile_url)');

  // Berater-Spieler-Daten indexieren: tm_url → { beraterPlayerId, status }
  type StatusEntry = { beraterPlayerId: string; status: 'interessant' | 'nicht_interessant' | 'watchlist' };
  const byTmUrl = new Map<string, StatusEntry>();
  const byLastName = new Map<string, StatusEntry>();
  const byFullName = new Map<string, StatusEntry>();

  const indexPlayer = (bp: any, entry: StatusEntry, overwrite: boolean) => {
    if (bp.tm_profile_url) {
      if (overwrite || !byTmUrl.has(bp.tm_profile_url)) {
        byTmUrl.set(bp.tm_profile_url, entry);
      }
    }
    if (bp.player_name) {
      const normalized = bp.player_name.trim().toLowerCase();
      if (overwrite || !byFullName.has(normalized)) {
        byFullName.set(normalized, entry);
      }
      // Nachname extrahieren (player_name kann "Vorname Nachname" sein)
      const parts = normalized.split(/\s+/);
      const lastName = parts[parts.length - 1];
      if (overwrite || !byLastName.has(lastName)) {
        byLastName.set(lastName, entry);
      }
    }
  };

  // Evaluierungen indexieren (Priorität über Watchlist)
  for (const ev of evals || []) {
    const bp = (ev as any).berater_players;
    if (!bp) continue;
    indexPlayer(bp, { beraterPlayerId: ev.player_id, status: ev.status as 'interessant' | 'nicht_interessant' }, true);
  }

  // Watchlist indexieren (nur wenn kein Eval existiert)
  for (const w of watchlist || []) {
    const bp = (w as any).berater_players;
    if (!bp) continue;
    indexPlayer(bp, { beraterPlayerId: w.player_id, status: 'watchlist' as const }, false);
  }

  // Lineup-Spieler matchen
  for (const player of players) {
    // 1. Primär: Transfermarkt-URL
    if (player.transfermarkt_url) {
      const match = byTmUrl.get(player.transfermarkt_url);
      if (match) {
        result.set(player.id, match);
        continue;
      }
    }
    // Platzhalter-Namen ("k.A.") nie per Name matchen — sonst bekommen alle
    // unbekannten Spieler denselben Status/dieselbe Farbe
    if (isPlaceholderName(player.name)) continue;
    // 2. Vollständiger Name (Vorname + Nachname)
    if (player.vorname && player.name) {
      const fullName = `${player.vorname} ${player.name}`.toLowerCase();
      const match = byFullName.get(fullName);
      if (match) {
        result.set(player.id, match);
        continue;
      }
    }
    // 3. Fallback: Nachname
    if (player.name) {
      const match = byLastName.get(player.name.toLowerCase());
      if (match) {
        result.set(player.id, match);
      }
    }
  }

  return result;
}

// ============================================================================
// SPIELER-EBENE: Berichte je Spieler (Schritt 1)
// ============================================================================

/**
 * Platzhalter-Namen aus dem fussball.de-Scraper ("k.A.", leer, "unbekannt").
 * Dürfen NIE als Identität für Matching/Dedup dienen — sonst teilen sich alle
 * unbekannten Spieler eines Spiels dieselben Berichte, Notizen und Status.
 */
export function isPlaceholderName(name?: string | null): boolean {
  const s = (name || '').trim().toLowerCase().replace(/[.,\s]/g, '');
  return !s || s === 'ka' || s === 'unbekannt';
}

/**
 * Namen akzent-/schreibweisen-unabhängig normalisieren ("Ouédraogo" -> "ouedraogo").
 * Muss zur SQL-Funktion public.normalize_player_name passen (unaccent + lower + trim).
 */
export function normalizePlayerName(name?: string | null): string {
  return (name || '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/æ/g, 'ae')
    .replace(/œ/g, 'oe')
    .replace(/ø/g, 'o')
    .replace(/đ/g, 'd')
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Gescoutete Spieler (ohne Verein, ohne TM-Profil) mit später aufgetauchten
 * Transfermarkt-Spielern zusammenführen: gleicher normalisierter Name und kein
 * Geburtsdatums-Widerspruch -> Berichte, Watchlist und Status wandern zum
 * TM-Datensatz, der gescoutete Duplikat-Datensatz wird gelöscht.
 * Läuft still; gibt die Anzahl der Zusammenführungen zurück.
 */
export async function mergeObservedDuplicates(): Promise<number> {
  try {
    const { data: scouted, error } = await supabase
      .from('berater_players')
      .select('id, player_name, normalized_name, birth_date')
      .is('club_id', null)
      .is('tm_profile_url', null)
      .eq('is_active', true)
      .limit(500);
    if (error || !scouted?.length) return 0;

    let merged = 0;
    for (const s of scouted) {
      const norm = s.normalized_name || normalizePlayerName(s.player_name);
      if (!norm || isPlaceholderName(s.player_name)) continue;

      const { data: targets } = await supabase
        .from('berater_players')
        .select('id, birth_date, tm_profile_url, club_id')
        .eq('normalized_name', norm)
        .neq('id', s.id)
        .or('tm_profile_url.not.is.null,club_id.not.is.null')
        .limit(2);
      // Eindeutiges Ziel ohne Geburtsdatums-Widerspruch
      const candidates = (targets || []).filter(
        (t) => !(s.birth_date && t.birth_date && s.birth_date !== t.birth_date)
      );
      if (candidates.length !== 1) continue;
      const target = candidates[0];

      // 1) Berichte umhängen
      await supabase
        .from('player_evaluations')
        .update({ berater_player_id: target.id })
        .eq('berater_player_id', s.id);

      // 2) Watchlist + Berater-Status umhängen (hat das Ziel schon einen
      //    Eintrag, wird der der Quelle verworfen)
      for (const table of ['berater_watchlist', 'berater_player_evaluations']) {
        const { data: existing } = await supabase
          .from(table)
          .select('id')
          .eq('player_id', target.id)
          .maybeSingle();
        if (existing) {
          await supabase.from(table).delete().eq('player_id', s.id);
        } else {
          await supabase.from(table).update({ player_id: target.id }).eq('player_id', s.id);
        }
      }

      // 3) Duplikat löschen
      const { error: delError } = await supabase.from('berater_players').delete().eq('id', s.id);
      if (!delError) merged++;
    }
    return merged;
  } catch {
    // z.B. Spalte normalized_name existiert noch nicht (Migration offen) — still bleiben
    return 0;
  }
}

export interface ObservedPlayer {
  player: BeraterPlayer;
  reportCount: number;
  lastMatchDate: string | null; // wie in player_evaluations gespeichert
  lastMatchName: string | null;
  lastRating: number | null;
}

// "25.01.2026" / "2026-01-25" → Timestamp (für Sortierung); unbekannt → 0
function reportDateTs(dateStr: string | null | undefined): number {
  if (!dateStr) return 0;
  const s = dateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return new Date(s.slice(0, 10)).getTime();
  const m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (!m) return 0;
  let year = parseInt(m[3], 10);
  if (year < 100) year += 2000;
  return new Date(year, parseInt(m[2], 10) - 1, parseInt(m[1], 10)).getTime();
}

/**
 * Anzahl Berichte je Spieler (über alle Spiele) für eine Menge berater_player_ids.
 * Für das "schon X Berichte"-Badge in der Aufstellung.
 */
export async function loadReportCountsByPlayerIds(
  playerIds: string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const ids = [...new Set(playerIds.filter(Boolean))];
  if (!ids.length) return counts;
  try {
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error } = await supabase
        .from('player_evaluations')
        .select('berater_player_id')
        .in('berater_player_id', ids.slice(i, i + 100));
      if (error) throw error;
      for (const row of (data || []) as { berater_player_id: string | null }[]) {
        if (!row.berater_player_id) continue;
        counts.set(row.berater_player_id, (counts.get(row.berater_player_id) || 0) + 1);
      }
    }
  } catch (err) {
    console.warn('loadReportCountsByPlayerIds fehlgeschlagen:', err);
  }
  return counts;
}

/**
 * "Beobachtet": alle Spieler mit mindestens einem Bericht,
 * zuletzt gesehene zuerst. Grundlage ist die feste Verknüpfung
 * player_evaluations.berater_player_id (Migration 20260826090000).
 */
export async function loadObservedPlayers(): Promise<ObservedPlayer[]> {
  try {
    const { data: evals, error } = await supabase
      .from('player_evaluations')
      .select('berater_player_id, match_date, match_name, overall_rating')
      .not('berater_player_id', 'is', null);
    if (error) throw error;

    // Je Spieler: Anzahl + jüngster Bericht
    type Agg = { count: number; lastTs: number; lastDate: string | null; lastName: string | null; lastRating: number | null };
    const byPlayer = new Map<string, Agg>();
    for (const e of (evals || []) as any[]) {
      const id = e.berater_player_id as string;
      const ts = reportDateTs(e.match_date);
      const agg = byPlayer.get(id) || { count: 0, lastTs: -1, lastDate: null, lastName: null, lastRating: null };
      agg.count++;
      if (ts >= agg.lastTs) {
        agg.lastTs = ts;
        agg.lastDate = e.match_date || null;
        agg.lastName = e.match_name || null;
        agg.lastRating = e.overall_rating ?? null;
      }
      byPlayer.set(id, agg);
    }
    if (!byPlayer.size) return [];

    // Spieler-Datensätze inkl. Verein/Liga
    const ids = [...byPlayer.keys()];
    const players: any[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error: pErr } = await supabase
        .from('berater_players')
        .select(`*, berater_clubs (club_name, league_id, berater_leagues (name))`)
        .in('id', ids.slice(i, i + 100));
      if (pErr) throw pErr;
      players.push(...(data || []));
    }

    const result: ObservedPlayer[] = players.map((p: any) => {
      const agg = byPlayer.get(p.id)!;
      return {
        player: {
          ...p,
          club_name: p.berater_clubs?.club_name,
          league_id: p.berater_clubs?.league_id,
          league_name: p.berater_clubs?.berater_leagues?.name,
        },
        reportCount: agg.count,
        lastMatchDate: agg.lastDate,
        lastMatchName: agg.lastName,
        lastRating: agg.lastRating,
      };
    });
    result.sort((a, b) => (byPlayer.get(b.player.id)!.lastTs) - (byPlayer.get(a.player.id)!.lastTs));
    return result;
  } catch (err) {
    console.warn('loadObservedPlayers fehlgeschlagen:', err);
    return [];
  }
}

/**
 * Berichte-Anzahl je Aufstellungs-Spieler (über ALLE Spiele) — fürs Badge.
 * Matching wie üblich: 1. Transfermarkt-URL, 2. Nachname+Vorname.
 * Liefert Map<lineup_player_id, Anzahl>.
 */
export async function loadReportCountsForLineup(
  lineupPlayers: { id: string; name: string; vorname?: string; transfermarkt_url?: string | null }[]
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (!lineupPlayers.length) return result;
  try {
    const urls = [...new Set(lineupPlayers.map(p => p.transfermarkt_url).filter(Boolean))] as string[];
    // Platzhalter-Namen ("k.A.") nie per Name zählen — sonst bekommen alle
    // unbekannten Spieler denselben (falschen) Zähler
    const lastNames = [...new Set(lineupPlayers.map(p => p.name).filter(n => n && !isPlaceholderName(n)))];

    type EvalRow = { id: string; transfermarkt_url: string | null; last_name: string | null; first_name: string | null };
    const rowById = new Map<string, EvalRow>();
    for (let i = 0; i < urls.length; i += 100) {
      const { data, error } = await supabase
        .from('player_evaluations')
        .select('id, transfermarkt_url, last_name, first_name')
        .in('transfermarkt_url', urls.slice(i, i + 100));
      if (error) throw error;
      for (const r of (data || []) as EvalRow[]) rowById.set(r.id, r);
    }
    for (let i = 0; i < lastNames.length; i += 100) {
      const { data, error } = await supabase
        .from('player_evaluations')
        .select('id, transfermarkt_url, last_name, first_name')
        .in('last_name', lastNames.slice(i, i + 100));
      if (error) throw error;
      for (const r of (data || []) as EvalRow[]) rowById.set(r.id, r);
    }

    // URL-Treffer zählen bevorzugt; Namens-Zählung nur für Berichte ohne gematchte URL
    const urlSet = new Set(urls);
    const byUrl = new Map<string, number>();
    const byName = new Map<string, number>();
    for (const r of rowById.values()) {
      if (r.transfermarkt_url && urlSet.has(r.transfermarkt_url)) {
        byUrl.set(r.transfermarkt_url, (byUrl.get(r.transfermarkt_url) || 0) + 1);
      } else if (!isPlaceholderName(r.last_name)) {
        const key = `${(r.last_name || '').toLowerCase()}::${(r.first_name || '').toLowerCase()}`;
        byName.set(key, (byName.get(key) || 0) + 1);
      }
    }

    for (const p of lineupPlayers) {
      let count = 0;
      if (p.transfermarkt_url && byUrl.has(p.transfermarkt_url)) {
        count = byUrl.get(p.transfermarkt_url)!;
      } else if (!isPlaceholderName(p.name)) {
        const key = `${(p.name || '').toLowerCase()}::${(p.vorname || '').toLowerCase()}`;
        count = byName.get(key) || 0;
      }
      if (count > 0) result.set(p.id, count);
    }
  } catch (err) {
    console.warn('loadReportCountsForLineup fehlgeschlagen:', err);
  }
  return result;
}
