import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { RETRO } from '../theme/retro';
import { splitPlayerName } from '../utils/playerName';

/**
 * Spielername wie in der Topscorer-Liste und der KMH-App: NACHNAME fett, Vorname dünn in Grau
 * (Matti 2026-11-15, gilt für alle Spielerlisten). Tabelle 13 px, Handy-Karte 14 px.
 */
export function PlayerName({ name, mobile = false, style }: { name: string; mobile?: boolean; style?: any }) {
  const { first, last } = splitPlayerName(name);
  return (
    <Text style={[s.last, mobile && s.lastMobile, { flexShrink: 1 }, style]} numberOfLines={1}>
      {last.toUpperCase()}
      {!!first && <Text style={[s.first, mobile && s.firstMobile]}> {first}</Text>}
    </Text>
  );
}

const s = StyleSheet.create({
  last: { fontSize: 13, fontWeight: '700', color: RETRO.text, lineHeight: 17 },
  lastMobile: { fontSize: 14, fontWeight: '600', lineHeight: 18 },
  first: { fontSize: 13, fontWeight: '400', color: RETRO.textMuted },
  firstMobile: { fontSize: 14 },
});
