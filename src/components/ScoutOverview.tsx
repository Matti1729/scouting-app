import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RETRO, MONO, HARD_SHADOW } from '../theme/retro';
import { ScoutEvent, ScoutEventKind, ScoutSummary } from '../services/scoutActivityService';

const KIND_LABEL: Record<ScoutEventKind, string> = {
  bericht: 'BERICHT',
  spiel: 'SPIEL',
  dabei: 'DABEI',
  watchlist: 'WATCHLIST',
};

const formatAt = (at: string | null): string =>
  at ? new Date(at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '–';

const matchDay = (d: string | null): string | null =>
  d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10).split('-').reverse().join('.') : d;

function EventRow({ event, onOpenPlayer }: { event: ScoutEvent; onOpenPlayer: (id: string) => void }) {
  const detail = event.kind === 'spiel' || event.kind === 'dabei' ? matchDay(event.detail) : event.detail;
  const content = (
    <>
      <Text style={styles.eventDate}>{formatAt(event.at)}</Text>
      <Text style={styles.eventKind}>{KIND_LABEL[event.kind]}</Text>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.eventTitle} numberOfLines={1}>{event.title}</Text>
        {detail ? <Text style={styles.eventDetail} numberOfLines={1}>{detail}</Text> : null}
      </View>
      {event.rating != null && <Text style={styles.eventRating}>{event.rating}</Text>}
      {event.playerId ? <Ionicons name="chevron-forward" size={13} color={RETRO.shadowDark} /> : null}
    </>
  );
  if (!event.playerId) return <View style={styles.eventRow}>{content}</View>;
  return (
    <TouchableOpacity style={styles.eventRow} onPress={() => onOpenPlayer(event.playerId!)} activeOpacity={0.7}>
      {content}
    </TouchableOpacity>
  );
}

// Scout-Übersicht: je Scout Zahlen + letzte Aktivität, aufgeklappt alles chronologisch
export function ScoutOverview({ scouts, loading, onOpenPlayer }: {
  scouts: ScoutSummary[];
  loading: boolean;
  onOpenPlayer: (playerId: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (!scouts.length) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>{loading ? 'Wird geladen ...' : 'Noch keine Scouts angelegt'}</Text>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, gap: 10 }}>
      {scouts.map((s) => {
        const open = openId === s.id;
        return (
          <View key={s.id} style={[styles.card, HARD_SHADOW]}>
            <TouchableOpacity style={styles.cardHead} onPress={() => setOpenId(open ? null : s.id)} activeOpacity={0.7}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.name} numberOfLines={1}>{s.name}</Text>
                <Text style={styles.last}>{s.lastAt ? `Zuletzt aktiv ${formatAt(s.lastAt)}` : 'Noch nichts eingetragen'}</Text>
              </View>
              <View style={styles.counts}>
                <View style={styles.count}><Text style={styles.countValue}>{s.reports}</Text><Text style={styles.countLabel}>Berichte</Text></View>
                <View style={styles.count}><Text style={styles.countValue}>{s.matches}</Text><Text style={styles.countLabel}>Spiele</Text></View>
                <View style={styles.count}><Text style={styles.countValue}>{s.watchlist}</Text><Text style={styles.countLabel}>Watchlist</Text></View>
              </View>
              <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={15} color={RETRO.shadowDark} />
            </TouchableOpacity>
            {open && (
              <View style={styles.events}>
                {s.events.length === 0
                  ? <Text style={styles.emptyText}>Noch keine Einträge</Text>
                  : s.events.map((e) => <EventRow key={e.key} event={e} onOpenPlayer={onOpenPlayer} />)}
              </View>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: RETRO.white, borderRadius: 2 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 12 },
  name: { fontSize: 14, fontWeight: '700', color: RETRO.text },
  last: { fontSize: 11, color: RETRO.textMuted, marginTop: 2 },
  counts: { flexDirection: 'row', gap: 12 },
  count: { alignItems: 'center', minWidth: 44 },
  countValue: { fontSize: 14, fontWeight: '700', color: RETRO.text },
  countLabel: { fontSize: 9, color: RETRO.textMuted },
  events: { borderTopWidth: 1, borderTopColor: RETRO.rowBorder, paddingHorizontal: 12, paddingVertical: 4 },
  eventRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#ece9e2' },
  eventDate: { fontSize: 11, fontFamily: MONO, color: RETRO.textMuted, width: 72 },
  eventKind: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5, fontFamily: MONO, color: RETRO.textMuted, width: 62 },
  eventTitle: { fontSize: 13, fontWeight: '600', color: RETRO.text, lineHeight: 17 },
  eventDetail: { fontSize: 11, color: RETRO.textMuted, lineHeight: 15 },
  eventRating: { fontSize: 13, fontWeight: '700', color: RETRO.text },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  emptyText: { fontSize: 13, color: RETRO.textMuted, paddingVertical: 8 },
});
