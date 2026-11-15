import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

/**
 * Kleines grünes W direkt hinter dem Namen: Spieler steht auf der Watchlist (Matti 2026-11-15, Variante A).
 * Gilt für alle Spielerlisten (Topscorer, Suchergebnisse, Aufstellungen).
 */
export function WatchlistBadge() {
  return (
    <View style={s.dot} accessibilityLabel="Auf der Watchlist">
      <Text style={s.w}>W</Text>
    </View>
  );
}

const s = StyleSheet.create({
  dot: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#2e7d32', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  w: { color: '#ffffff', fontSize: 8.5, lineHeight: 10, fontWeight: '800' },
});
