// Wer ist angemeldet? AuthContext setzt das, Services lesen es ohne React.
import { supabase } from '../config/supabase';

let userId: string | null = null;
let scout = false;
let names: Promise<Map<string, string>> | null = null;

export function setCurrentUser(id: string | null, isScout: boolean): void {
  userId = id;
  scout = isScout;
  names = null;
}

export const currentUserId = (): string | null => userId;
export const isScoutUser = (): boolean => scout;

/** Vornamen der Berater und Scouts (nur für Berater; Scouts sehen keine fremden Namen) */
export function loadAdvisorNames(): Promise<Map<string, string>> {
  if (scout) return Promise.resolve(new Map());
  if (!names) {
    names = Promise.resolve(supabase.from('advisors').select('id, first_name')).then(({ data }) =>
      new Map(((data || []) as { id: string; first_name: string | null }[]).map((a) => [a.id, a.first_name || 'Scout']))
    );
  }
  return names;
}

/** Mehrere Personen können denselben Spieler im selben DFB-Termin bewerten:
 *  zuerst den eigenen Bericht nehmen, dann den alten ohne Autor, dann den eines Scouts. */
export function pickOwnReport<T extends { created_by?: string | null }>(rows: T[] | null | undefined): T | null {
  const list = rows || [];
  return list.find((r) => r.created_by === userId) || list.find((r) => !r.created_by) || list[0] || null;
}
