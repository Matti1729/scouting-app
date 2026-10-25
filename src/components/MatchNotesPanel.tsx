// MatchNotesPanel: Spielnotizen im Spiel-Modal (Matti 2026-10-25). Ein Textfeld, in das Matti per
// iPhone-Diktat einspricht ("Heim 13, groß, schlaksig …"); "Auswerten" ordnet per KI den Spielern der
// Aufstellung zu, die Entwürfe werden einzeln oder alle auf einmal in die Berichte übernommen.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { RETRO, MONO, HARD_SHADOW } from '../theme/retro';
import { showAlert } from '../utils/alert';
import {
  NoteDraft, loadMatchNotes, saveMatchNotes, writeLocalNotes, parseMatchNotes, applyNoteDraft, draftLines,
} from '../services/matchNotesService';

type Props = {
  match: { id: string; spiel: string; datum: string; mannschaft?: string | null };
  homeName: string;
  awayName: string;
  isMobile: boolean;
  /** nach dem Übernehmen: Spiel-Modal aktualisieren (bewertete Spieler markieren) */
  onApplied?: () => void;
};

export function MatchNotesPanel({ match, homeName, awayName, isMobile, onApplied }: Props) {
  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(true);
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<NoteDraft[] | null>(null);
  const [unmatched, setUnmatched] = useState<NoteDraft[]>([]);
  const [applied, setApplied] = useState<Set<number>>(new Set());
  const saveTimer = useRef<any>(null);
  const pending = useRef<string | null>(null); // noch nicht gespeicherter Text

  // Offenen Stand sofort speichern (Fenster zu, App in den Hintergrund, Seite verlassen)
  const flush = () => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    if (pending.current == null) return;
    const t = pending.current;
    pending.current = null;
    saveMatchNotes(match.id, t).then((ok) => setSaved(ok));
  };

  useEffect(() => {
    let off = false;
    loadMatchNotes(match.id).then((t) => { if (!off) { setText(t); setLoaded(true); } });
    const onHide = () => { if (typeof document === 'undefined' || document.visibilityState === 'hidden') flush(); };
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', onHide);
      document.addEventListener('visibilitychange', onHide);
    }
    return () => {
      off = true;
      flush();
      if (typeof window !== 'undefined') {
        window.removeEventListener('pagehide', onHide);
        document.removeEventListener('visibilitychange', onHide);
      }
    };
  }, [match.id]);

  // Jede Änderung sofort im Gerät sichern, kurz danach in der Datenbank speichern
  const onChange = (t: string) => {
    setText(t);
    setSaved(false);
    pending.current = t;
    writeLocalNotes(match.id, t, false);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, 800);
  };

  const evaluate = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      if (!saved) { pending.current = null; await saveMatchNotes(match.id, text); }
      setSaved(true);
      const r = await parseMatchNotes(match.id, text);
      setDrafts(r.drafts);
      setUnmatched(r.unmatched);
      setApplied(new Set());
    } catch (e: any) {
      showAlert('Auswertung fehlgeschlagen', e.message);
    } finally {
      setBusy(false);
    }
  };

  const apply = async (idxs: number[]) => {
    if (!drafts) return;
    setBusy(true);
    const done = new Set(applied);
    try {
      for (const i of idxs) {
        if (done.has(i)) continue;
        await applyNoteDraft(drafts[i], match);
        done.add(i);
      }
    } catch (e: any) {
      showAlert('Fehler', e.message);
    } finally {
      setApplied(done);
      setBusy(false);
      onApplied?.();
    }
  };

  const sideName = (s: string | null) => (s === 'home' ? homeName : s === 'away' ? awayName : 'Seite offen');
  const label = (txt: string) => (
    <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', letterSpacing: 1, color: RETRO.textMuted }}>{txt}</Text>
  );

  // ---- Entwürfe nach "Auswerten" ----
  if (drafts) {
    const open = drafts.map((_, i) => i).filter((i) => !applied.has(i));
    return (
      <View style={{ flex: 1, minHeight: 0, gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ flex: 1, fontSize: 12, color: RETRO.textMuted }}>
            {drafts.length} Spieler zugeordnet{unmatched.length ? ` · ${unmatched.length} offen` : ''}. Prüfen und übernehmen.
          </Text>
          <TouchableOpacity onPress={() => setDrafts(null)} hitSlop={8}>
            <Text style={{ fontSize: 12, fontWeight: '600', color: RETRO.text, textDecorationLine: 'underline' }}>Zurück zu den Notizen</Text>
          </TouchableOpacity>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 8, paddingBottom: 8, paddingRight: 4 }}>
          {drafts.map((d, i) => {
            const done = applied.has(i);
            return (
              <View key={`d${i}`} style={[HARD_SHADOW, { backgroundColor: RETRO.white, borderWidth: 1, borderColor: RETRO.rowBorder, padding: 10, gap: 4, opacity: done ? 0.55 : 1 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: '700', backgroundColor: RETRO.yellow, paddingHorizontal: 5, paddingVertical: 1 }}>{d.number ?? '?'}</Text>
                  <Text style={{ flex: 1, fontSize: 14, fontWeight: '700', color: RETRO.text }} numberOfLines={1}>{[d.first_name, d.last_name].filter(Boolean).join(' ')}</Text>
                  <Text style={{ fontSize: 10, color: RETRO.textMuted }} numberOfLines={1}>{sideName(d.side)}</Text>
                </View>
                {draftLines(d).map((l) => (
                  <Text key={l.label} style={{ fontSize: 12, lineHeight: 18, color: RETRO.text }}>
                    <Text style={{ color: RETRO.textMuted }}>{l.label} </Text>{l.value}
                  </Text>
                ))}
                <TouchableOpacity
                  disabled={done || busy}
                  onPress={() => apply([i])}
                  style={{ marginTop: 4, height: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: done ? RETRO.white : RETRO.text, borderWidth: 1, borderColor: RETRO.text }}
                >
                  <Text style={{ fontSize: 12, fontWeight: '600', color: done ? RETRO.text : '#fff' }}>{done ? 'Übernommen ✓' : 'Übernehmen'}</Text>
                </TouchableOpacity>
              </View>
            );
          })}
          {unmatched.map((d, i) => (
            <View key={`u${i}`} style={{ backgroundColor: '#fef3c7', borderWidth: 1, borderColor: '#f59e0b', padding: 10, gap: 4 }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#92400e' }}>
                {d.side ? `${sideName(d.side)} ` : ''}{d.number ?? '?'}: {d.reason === 'mehrdeutig' ? 'Seite unklar (Nummer bei beiden Teams)' : 'nicht in der Aufstellung'}
              </Text>
              <Text style={{ fontSize: 12, color: '#92400e' }}>„{d.source_text}“</Text>
              <Text style={{ fontSize: 11, color: '#92400e' }}>Ergänze in den Notizen „Heim“ oder „Gast“ bzw. lade die Aufstellung, dann erneut auswerten.</Text>
            </View>
          ))}
        </ScrollView>
        {open.length > 0 && (
          <TouchableOpacity
            disabled={busy}
            onPress={() => apply(open)}
            style={[HARD_SHADOW, { height: 46, alignItems: 'center', justifyContent: 'center', backgroundColor: RETRO.yellow, borderWidth: 1, borderColor: RETRO.text }]}
          >
            {busy ? <ActivityIndicator color={RETRO.text} /> : <Text style={{ fontSize: 14, fontWeight: '700', color: RETRO.text }}>{open.length === 1 ? '1 übernehmen' : `Alle ${open.length} übernehmen`}</Text>}
          </TouchableOpacity>
        )}
      </View>
    );
  }

  // ---- Notizfeld ----
  return (
    <View style={{ flex: 1, minHeight: 0, gap: 8 }}>
      <View style={[HARD_SHADOW, { flex: 1, minHeight: isMobile ? 260 : 320, backgroundColor: RETRO.white, borderWidth: 1, borderColor: RETRO.rowBorder }]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4 }}>
          {label('SPIELNOTIZEN')}
          <Text style={{ fontSize: 10, color: RETRO.textMuted }}>{!loaded ? 'lädt …' : saved ? 'gespeichert' : 'speichert …'}</Text>
        </View>
        <TextInput
          value={text}
          onChangeText={onChange}
          multiline
          editable={loaded}
          placeholder={'Heim 13, groß und schlaksig, technisch Probleme bei der Ballannahme …\n\nGast 7, sehr schnell über links, starker linker Fuß …'}
          placeholderTextColor="#9a9aa2"
          style={{ flex: 1, paddingHorizontal: 12, paddingBottom: 10, fontSize: 14, lineHeight: 21, color: RETRO.text, textAlignVertical: 'top', outlineStyle: 'none' } as any}
        />
        <View style={{ borderTopWidth: 1, borderTopColor: RETRO.rowBorder, backgroundColor: '#f7f5f0', paddingHorizontal: 12, paddingVertical: 8 }}>
          <Text style={{ fontSize: 11, lineHeight: 15, color: RETRO.textMuted }}>
            Tipp aufs Mikrofon der Tastatur und einfach sprechen: Heim/Gast + Nummer, dann was du siehst.
          </Text>
        </View>
      </View>
      <TouchableOpacity
        disabled={busy || !text.trim()}
        onPress={evaluate}
        style={[HARD_SHADOW, { height: 46, alignItems: 'center', justifyContent: 'center', backgroundColor: RETRO.yellow, borderWidth: 1, borderColor: RETRO.text, opacity: text.trim() ? 1 : 0.5 }]}
      >
        {busy ? <ActivityIndicator color={RETRO.text} /> : <Text style={{ fontSize: 14, fontWeight: '700', color: RETRO.text }}>Auswerten</Text>}
      </TouchableOpacity>
    </View>
  );
}
