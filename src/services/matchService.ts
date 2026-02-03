// matchService.ts - Supabase CRUD für Spiele und Aufstellungen

import { supabase } from '../config/supabase';

// ============================================
// TYPEN
// ============================================

export interface DbMatch {
  id: string;
  created_at: string;
  updated_at: string;
  home_team: string;
  away_team: string;
  match_date: string | null;
  match_date_end: string | null;
  match_time: string | null;
  age_group: string | null;
  match_type: string | null;
  location: string | null;
  result: string | null;
  fussball_de_url: string | null;
  is_archived: boolean;
}

export interface DbLineup {
  id: string;
  created_at: string;
  match_id: string;
  team: 'home' | 'away';
  is_starter: boolean;
  nummer: string | null;
  vorname: string | null;
  name: string;
  position: string | null;
  jahrgang: string | null;
  fussball_de_url: string | null;
  transfermarkt_url: string | null;
  agent_name: string | null;
  agent_company: string | null;
  has_agent: boolean;
  birth_date: string | null;
  is_goalkeeper: boolean;
}

// Input-Typen (ohne auto-generierte Felder)
export interface MatchInput {
  home_team: string;
  away_team: string;
  match_date?: string;
  match_date_end?: string;
  match_time?: string;
  age_group?: string;
  match_type?: string;
  location?: string;
  result?: string;
  fussball_de_url?: string;
  is_archived?: boolean;
}

export interface LineupInput {
  match_id: string;
  team: 'home' | 'away';
  is_starter: boolean;
  nummer?: string;
  vorname?: string;
  name: string;
  position?: string;
  jahrgang?: string;
  fussball_de_url?: string;
  transfermarkt_url?: string;
  agent_name?: string;
  agent_company?: string;
  has_agent?: boolean;
  birth_date?: string;
  is_goalkeeper?: boolean;
}

// ============================================
// SPIELE (MATCHES)
// ============================================

/**
 * Alle Spiele laden
 */
export async function loadMatches(): Promise<{ success: boolean; data?: DbMatch[]; error?: string }> {
  try {
    const { data, error } = await supabase
      .from('scouting_matches')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error loading matches:', error);
      return { success: false, error: error.message };
    }

    return { success: true, data: data || [] };
  } catch (err) {
    console.error('Error loading matches:', err);
    return { success: false, error: 'Fehler beim Laden der Spiele' };
  }
}

/**
 * Neues Spiel erstellen
 */
export async function createMatch(match: MatchInput): Promise<{ success: boolean; data?: DbMatch; error?: string }> {
  try {
    const { data, error } = await supabase
      .from('scouting_matches')
      .insert(match)
      .select()
      .single();

    if (error) {
      console.error('Error creating match:', error);
      return { success: false, error: error.message };
    }

    return { success: true, data };
  } catch (err) {
    console.error('Error creating match:', err);
    return { success: false, error: 'Fehler beim Erstellen des Spiels' };
  }
}

/**
 * Spiel aktualisieren
 */
export async function updateMatch(
  id: string,
  updates: Partial<MatchInput>
): Promise<{ success: boolean; data?: DbMatch; error?: string }> {
  try {
    const { data, error } = await supabase
      .from('scouting_matches')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating match:', error);
      return { success: false, error: error.message };
    }

    return { success: true, data };
  } catch (err) {
    console.error('Error updating match:', err);
    return { success: false, error: 'Fehler beim Aktualisieren des Spiels' };
  }
}

/**
 * Spiel löschen (inkl. Aufstellungen durch CASCADE)
 */
export async function deleteMatch(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('scouting_matches')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting match:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    console.error('Error deleting match:', err);
    return { success: false, error: 'Fehler beim Löschen des Spiels' };
  }
}

// ============================================
// AUFSTELLUNGEN (LINEUPS)
// ============================================

/**
 * Aufstellung für ein Spiel laden
 */
export async function loadLineups(matchId: string): Promise<{ success: boolean; data?: DbLineup[]; error?: string }> {
  try {
    const { data, error } = await supabase
      .from('scouting_lineups')
      .select('*')
      .eq('match_id', matchId)
      .order('team')
      .order('is_starter', { ascending: false })
      .order('nummer');

    if (error) {
      console.error('Error loading lineups:', error);
      return { success: false, error: error.message };
    }

    return { success: true, data: data || [] };
  } catch (err) {
    console.error('Error loading lineups:', err);
    return { success: false, error: 'Fehler beim Laden der Aufstellung' };
  }
}

/**
 * Spieler zur Aufstellung hinzufügen
 */
export async function addPlayerToLineup(player: LineupInput): Promise<{ success: boolean; data?: DbLineup; error?: string }> {
  try {
    const { data, error } = await supabase
      .from('scouting_lineups')
      .insert(player)
      .select()
      .single();

    if (error) {
      console.error('Error adding player:', error);
      return { success: false, error: error.message };
    }

    return { success: true, data };
  } catch (err) {
    console.error('Error adding player:', err);
    return { success: false, error: 'Fehler beim Hinzufügen des Spielers' };
  }
}

/**
 * Mehrere Spieler zur Aufstellung hinzufügen (Bulk-Insert)
 */
export async function addPlayersToLineup(players: LineupInput[]): Promise<{ success: boolean; data?: DbLineup[]; error?: string }> {
  if (players.length === 0) {
    return { success: true, data: [] };
  }

  try {
    const { data, error } = await supabase
      .from('scouting_lineups')
      .insert(players)
      .select();

    if (error) {
      console.error('Error adding players:', error);
      return { success: false, error: error.message };
    }

    return { success: true, data: data || [] };
  } catch (err) {
    console.error('Error adding players:', err);
    return { success: false, error: 'Fehler beim Hinzufügen der Spieler' };
  }
}

/**
 * Spieler aktualisieren (z.B. Transfermarkt-Info)
 */
export async function updatePlayer(
  id: string,
  updates: Partial<LineupInput>
): Promise<{ success: boolean; data?: DbLineup; error?: string }> {
  try {
    const { data, error } = await supabase
      .from('scouting_lineups')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating player:', error);
      return { success: false, error: error.message };
    }

    return { success: true, data };
  } catch (err) {
    console.error('Error updating player:', err);
    return { success: false, error: 'Fehler beim Aktualisieren des Spielers' };
  }
}

/**
 * Spieler aus Aufstellung entfernen
 */
export async function removePlayerFromLineup(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('scouting_lineups')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error removing player:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    console.error('Error removing player:', err);
    return { success: false, error: 'Fehler beim Entfernen des Spielers' };
  }
}

/**
 * Alle Spieler eines Spiels löschen (für Re-Import)
 */
export async function clearLineup(matchId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('scouting_lineups')
      .delete()
      .eq('match_id', matchId);

    if (error) {
      console.error('Error clearing lineup:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    console.error('Error clearing lineup:', err);
    return { success: false, error: 'Fehler beim Löschen der Aufstellung' };
  }
}

/**
 * Aufstellung ersetzen (löschen + neu einfügen)
 */
export async function replaceLineup(
  matchId: string,
  players: Omit<LineupInput, 'match_id'>[]
): Promise<{ success: boolean; data?: DbLineup[]; error?: string }> {
  try {
    // Erst alte Aufstellung löschen
    const clearResult = await clearLineup(matchId);
    if (!clearResult.success) {
      return { success: false, error: clearResult.error };
    }

    // Dann neue einfügen
    if (players.length === 0) {
      return { success: true, data: [] };
    }

    const playersWithMatchId = players.map(p => ({ ...p, match_id: matchId }));
    return await addPlayersToLineup(playersWithMatchId);
  } catch (err) {
    console.error('Error replacing lineup:', err);
    return { success: false, error: 'Fehler beim Ersetzen der Aufstellung' };
  }
}
