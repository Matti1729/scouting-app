import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

/**
 * Kleines grünes W direkt hinter dem Namen: Spieler steht auf der Watchlist (Matti 2026-11-15, Variante A).
 * Gilt für alle Spielerlisten (Topscorer, Suchergebnisse, Aufstellungen). Seit 2026-11-15 etwas größer, damit es auffällt.
 */
export function WatchlistBadge() {
  return (
    <View style={s.dot} accessibilityLabel="Auf der Watchlist">
      <Text style={s.w}>W</Text>
    </View>
  );
}

const s = StyleSheet.create({
  dot: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#2e7d32', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  w: { color: '#ffffff', fontSize: 11, lineHeight: 13, fontWeight: '800' },
});
