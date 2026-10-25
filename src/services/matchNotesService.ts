// matchNotesService.ts - Spielnotizen (Diktat) speichern, auswerten und als Bericht übernehmen
// (Matti 2026-10-25). Auswertung: Edge Function parse-match-notes.
import { supabase } from '../config/supabase';

export interface NoteDraft {
  side: 'home' | 'away' | null;
  number: number | null;
  lineup_player_id: string | null;
  first_name: string | null;
  last_name: string | null;
  positions: string[];
  preferred_foot: 'rechts' | 'links' | 'beide' | null;
  body: Record<string, string | null>;
  athletics: Record<string, string | null>;
  note: string;
  source_text: string;
  reason?: string;
}

// Sicherungskopie im Gerät: wird die App geschlossen, bevor das Speichern ankommt (oder ohne Netz im
// Stadion), geht nichts verloren; beim nächsten Öffnen gewinnt die neuere Fassung und wird nachgespeichert.
const localKey = (id: string) => `match_notes_${id}`;
type LocalNotes = { text: string; at: string; synced: boolean };
function readLocal(id: string): LocalNotes | null {
  try { const r = globalThis.localStorage?.getItem(localKey(id)); return r ? JSON.parse(r) : null; } catch { return null; }
}
export function writeLocalNotes(id: string, text: string, synced: boolean): void {
  try { globalThis.localStorage?.setItem(localKey(id), JSON.stringify({ text, at: new Date().toISOString(), synced })); } catch { /* optional */ }
}

export async function loadMatchNotes(matchId: string): Promise<string> {
  const { data } = await supabase.from('scouting_matches').select('scouting_notes, scouting_notes_updated_at').eq('id', matchId).maybeSingle();
  const dbText = (data as any)?.scouting_notes || '';
  const dbAt = (data as any)?.scouting_notes_updated_at || '';
  const local = readLocal(matchId);
  // Nicht hochgeladene, neuere Fassung im Gerät: die nehmen und gleich speichern
  if (local && !local.synced && local.text !== dbText && (!dbAt || local.at > dbAt)) {
    void saveMatchNotes(matchId, local.text);
    return local.text;
  }
  return dbText;
}

export async function saveMatchNotes(matchId: string, text: string): Promise<boolean> {
  const { error } = await supabase.from('scouting_matches').update({ scouting_notes: text, scouting_notes_updated_at: new Date().toISOString() }).eq('id', matchId);
  writeLocalNotes(matchId, text, !error);
  return !error;
}

export async function parseMatchNotes(matchId: string, text: string): Promise<{ drafts: NoteDraft[]; unmatched: NoteDraft[] }> {
  const { data, error } = await supabase.functions.invoke('parse-match-notes', { body: { matchId, text } });
  if (error || !(data as any)?.success) throw new Error((data as any)?.error || error?.message || 'Auswertung fehlgeschlagen');
  return { drafts: (data as any).drafts || [], unmatched: (data as any).unmatched || [] };
}

const clean = (o: Record<string, any>) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v != null && v !== ''));

/**
 * Entwurf in den Bericht des Spielers zu diesem Spiel übernehmen: neuer Bericht oder Ergänzung.
 * Bestehende Angaben bleiben, leere Felder werden gefüllt, die Notiz wird angehängt.
 */
export async function applyNoteDraft(
  d: NoteDraft,
  match: { id: string; spiel: string; datum: string; mannschaft?: string | null },
): Promise<void> {
  if (!d.lineup_player_id) throw new Error('Spieler nicht zugeordnet');
  const { data: ex } = await supabase.from('player_evaluations').select('*')
    .eq('match_id', match.id).eq('lineup_player_id', d.lineup_player_id).maybeSingle();
  const body = clean(d.body);
  const ath = clean(d.athletics);
  const note = d.note?.trim() || '';
  if (ex) {
    const e: any = ex;
    const patch: Record<string, any> = {};
    if (!e.positions && d.positions.length) patch.positions = d.positions.join(', ');
    if (!e.preferred_foot && d.preferred_foot) patch.preferred_foot = d.preferred_foot;
    const mergedBody = { ...body, ...clean(e.body_structure || {}) };
    if (Object.keys(body).length) patch.body_structure = { ...(e.body_structure || {}), ...mergedBody };
    const mergedAth = { ...ath, ...clean(e.speed_athleticism || {}) };
    if (Object.keys(ath).length) patch.speed_athleticism = { ...(e.speed_athleticism || {}), ...mergedAth };
    if (note && !(e.notes || '').includes(note)) patch.notes = e.notes ? `${e.notes}\n${note}` : note;
    if (Object.keys(patch).length) {
      const { error } = await supabase.from('player_evaluations').update(patch).eq('id', e.id);
      if (error) throw new Error(error.message);
    }
    return;
  }
  const { error } = await supabase.from('player_evaluations').insert({
    match_id: match.id,
    lineup_player_id: d.lineup_player_id,
    match_name: match.spiel || null,
    match_date: match.datum || null,
    age_group: match.mannschaft || null,
    first_name: d.first_name || null,
    last_name: d.last_name || 'k.A.',
    jersey_number: d.number ?? null,
    positions: d.positions.join(', ') || null,
    preferred_foot: d.preferred_foot,
    body_structure: body,
    speed_athleticism: ath,
    notes: note || null,
  });
  if (error) throw new Error(error.message);
}

// Anzeige-Texte für die Entwurfskarten
const LABEL: Record<string, string> = {
  spaetentwickler: 'Spätentwickler', fruehentwickler: 'Frühentwickler', altersgerecht: 'altersgerecht',
  unterdurchschnittlich: 'klein', durchschnittlich: 'mittelgroß', ueberdurchschnittlich: 'groß',
  langbeinig: 'langbeinig', ausgeglichen: 'ausgeglichen', kompakt: 'kompakt',
  schmal: 'schmal', mittel: 'mittel', breit: 'breit', wenig_aufbau: 'wenig Muskulatur', kraeftig: 'kräftig',
  top: 'top', gut: 'gut', durchschnitt: 'durchschnitt', schwach: 'schwach',
  sauber: 'sauber', normal: 'normal', steif: 'steif', wacklig: 'wacklig', stabil: 'stabil', durchsetzungsstark: 'durchsetzungsstark',
  hoch: 'hoch', niedrig: 'niedrig',
};
const ATH_NAME: Record<string, string> = { antritt: 'Antritt', endspeed: 'Endspeed', koordination: 'Bewegung', robustheit: 'Robustheit', intensitaet: 'Intensität' };

export function draftLines(d: NoteDraft): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  if (d.positions.length) out.push({ label: 'Position', value: d.positions.join(', ') });
  if (d.preferred_foot) out.push({ label: 'Fuß', value: d.preferred_foot });
  const body = Object.values(clean(d.body)).map((v) => LABEL[v as string] || v);
  if (body.length) out.push({ label: 'Körper', value: body.join(', ') });
  const ath = Object.entries(clean(d.athletics)).map(([k, v]) => `${ATH_NAME[k] || k} ${LABEL[v as string] || v}`);
  if (ath.length) out.push({ label: 'Athletik', value: ath.join(', ') });
  if (d.note) out.push({ label: 'Notiz', value: d.note });
  return out;
}
