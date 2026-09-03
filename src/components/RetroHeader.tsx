import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, useWindowDimensions, Platform } from 'react-native';
import { RETRO, HARD_SHADOW, HARD_SHADOW_LG, MONO } from '../theme/retro';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../config/supabase';

/**
 * Gelber Titelbalken wie im Dashboard: links optional ←, Titel MITTIG über
 * dem ganzen Balken (mit MONO-Kurzbeschreibung auf der Grundlinie, mobil ohne),
 * rechts optionale Extras (z.B. Tabs) plus Initialen-Box (Klick = Abmelden).
 * Keine Datum-Box mehr (Retro-Regel seit 03.09.2026).
 */
export function RetroHeader({
  title,
  subtitle,
  onBack,
  right,
  tabs,
  activeTab,
  onTabChange,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: React.ReactNode;
  /** Mobile Tab-Zeile unter dem Titel (Text-Tabs mit Unterstrich, volle Breite).
   *  Desktop rendert diese Tabs NICHT — dort gehören sie als Boxen in `right`. */
  tabs?: { key: string; label: string }[];
  activeTab?: string;
  onTabChange?: (key: string) => void;
}) {
  const { signOut } = useAuth();
  const { width } = useWindowDimensions();
  const isMobile = width < 768;
  // Breite der linken (←) und rechten Gruppe (Extras + Initialen), damit der
  // Titel im freien Bereich zentriert wird und nichts überlappt. Desktop:
  // symmetrisch (echte Mitte), mobil: nur so viel Rand wie nötig.
  const [leftW, setLeftW] = useState(0);
  const [rightW, setRightW] = useState(0);
  const pad = isMobile
    ? { paddingLeft: leftW + 20, paddingRight: rightW + 20 }
    : { paddingLeft: Math.max(leftW, rightW) + 20, paddingRight: Math.max(leftW, rightW) + 20 };
  const [initials, setInitials] = useState('');

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const email = data?.user?.email || '';
      setInitials(email.slice(0, 2).toUpperCase());
    });
  }, []);

  const bar = (
    <View style={[styles.bar, !(isMobile && tabs) && HARD_SHADOW_LG]}>
      <View onLayout={(e) => setLeftW(e.nativeEvent.layout.width)}>
        {onBack && (
          <TouchableOpacity onPress={onBack} hitSlop={8} style={styles.backButton}>
            <Text style={styles.backArrow}>{'←'}</Text>
          </TouchableOpacity>
        )}
      </View>
      {/* Titel mittig im freien Bereich; Ebene fängt keine Klicks ab */}
      <View style={[styles.titleLayer, pad]} pointerEvents="none">
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {subtitle && !isMobile ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      <View style={{ flex: 1 }} />
      <View style={styles.rightGroup} onLayout={(e) => setRightW(e.nativeEvent.layout.width)}>
        {right}
        <TouchableOpacity style={[styles.box, HARD_SHADOW]} onPress={signOut} activeOpacity={0.7}>
          <Text style={styles.boxText}>{initials || '⎋'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  if (!(isMobile && tabs)) return bar;

  // Mobil: Tabs als Fortsetzung des gelben Balkens, je ein Drittel der Breite
  return (
    <View style={HARD_SHADOW_LG}>
      {bar}
      <View style={styles.tabRow}>
        {tabs.map((t) => {
          const active = t.key === activeTab;
          return (
            <TouchableOpacity
              key={t.key}
              style={[styles.tab, active && styles.tabActive, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null]}
              onPress={() => onTabChange?.(t.key)}
              activeOpacity={0.7}
            >
              <Text style={[styles.tabText, active && styles.tabTextActive]} numberOfLines={1}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: RETRO.yellow,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  backButton: {
    marginRight: -4,
  },
  rightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backArrow: {
    fontSize: 20,
    fontWeight: '600',
    color: RETRO.text,
  },
  // Titel + MONO-Untertitel auf gemeinsamer Grundlinie, mittig im Balken
  titleLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 12,
    paddingTop: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: RETRO.text,
    flexShrink: 1,
  },
  subtitle: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1,
    fontFamily: MONO,
    color: RETRO.textMuted,
    flexShrink: 1,
  },
  box: {
    // Standard-Maß für ALLE Boxen/Buttons im gelben Titelbalken:
    // paddingVertical 5, paddingHorizontal 10, minHeight 25, fontSize 12 MONO 700
    backgroundColor: RETRO.white,
    borderRadius: 2,
    paddingHorizontal: 10,
    paddingVertical: 5,
    minHeight: 25,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxText: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: MONO,
    color: RETRO.text,
  },
  // Mobile Tab-Zeile (Standard für Screens mit Tabs: Übersicht Spiele, Watchlist)
  tabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingBottom: 10,
    paddingTop: 2,
    backgroundColor: RETRO.yellow,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 2,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: RETRO.text,
  },
  tabText: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: MONO,
    letterSpacing: 0.5,
    color: 'rgba(20,20,30,0.55)',
  },
  tabTextActive: {
    color: RETRO.text,
  },
});
