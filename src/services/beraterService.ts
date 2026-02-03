// beraterService.ts - Beraterstatus-Tracker Service
// Kommuniziert mit Supabase (direkte DB-Queries + Edge Function für Scans)

import { supabase } from '../config/supabase';

const SUPABASE_URL = 'https://ozggtruvnwozhwjbznsm.supabase.co';
const EDGE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/berater-scan`;
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96Z2d0cnV2bndvemh3amJ6bnNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5NDI5ODYsImV4cCI6MjA4MjUxODk4Nn0.QCaSqAQPrIl-DXKiT82wbWAJ23KbeOTpRvq8YI46hCY';

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
  added_at: string;
  // Joined player data
  player?: BeraterPlayer;
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
  const response = await fetch(EDGE_FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ action, ...params }),
  });

  if (!response.ok) {
    throw new Error(`Edge function error: ${response.status}`);
  }

  return response.json();
}

/**
 * Scan-Status + Statistiken laden
 */
export async function loadScanStatus(): Promise<{
  scanState: ScanState;
  stats: BeraterStats;
}> {
  const result = await callEdgeFunction('get_status');
  return { scanState: result.scanState, stats: result.stats };
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

export async function loadLeagues(): Promise<Array<{ id: string; name: string; is_active: boolean }>> {
  const { data, error } = await supabase
    .from('berater_leagues')
    .select('id, name, is_active')
    .order('tier', { ascending: true });

  if (error) {
    console.error('Error loading leagues:', error);
    return [];
  }

  return data || [];
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
    includeOnWatchlist?: boolean;
  }
): Promise<PlayerStat[]> {
  const limit = options?.limit || 100;

  let query = supabase
    .from('berater_player_stats')
    .select(`
      *,
      berater_leagues!inner(name)
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

  const players: PlayerStat[] = data.map(row => ({
    id: row.id,
    player_id: row.player_id,
    tm_player_id: row.tm_player_id,
    player_name: row.player_name,
    league_id: row.league_id,
    club_name: row.club_name,
    stat_type: row.stat_type,
    stat_value: row.stat_value,
    games_played: row.games_played,
    rank_in_league: row.rank_in_league,
    season: row.season,
    tm_profile_url: row.tm_profile_url,
    birth_date: row.birth_date,
    position: row.position,
    updated_at: row.updated_at,
    league_name: row.berater_leagues?.name,
    is_on_watchlist: watchlistTmIds.has(row.tm_player_id) ||
                     (row.player_id && watchlistPlayerIds.has(row.player_id)),
  }));

  // Standardmäßig bereits auf Watchlist befindliche ausfiltern
  if (!options?.includeOnWatchlist) {
    return players.filter(p => !p.is_on_watchlist);
  }

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
 * Startet das Abrufen der Rankings von Transfermarkt
 */
export async function refreshPlayerRankings(): Promise<{
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
    const response = await fetch(`${RANKINGS_FUNCTION_URL}?action=fetch_all`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
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
