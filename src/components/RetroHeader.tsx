import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { RETRO, HARD_SHADOW, HARD_SHADOW_LG, MONO } from '../theme/retro';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../config/supabase';

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

/** "Do, 28.08.26" für die Kopfzeile */
function todayHeader(): string {
  const d = new Date();
  return `${WEEKDAYS[d.getDay()]}, ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getFullYear()).slice(-2)}`;
}

/**
 * Gelber Titelbalken wie im Dashboard: links optional ←, fetter Titel mit
 * MONO-Kurzbeschreibung auf der Grundlinie, rechts optionale Extras (z.B. Tabs)
 * plus Datum-Box und Initialen-Box (Klick = Abmelden).
 */
export function RetroHeader({
  title,
  subtitle,
  onBack,
  right,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: React.ReactNode;
}) {
  const { signOut } = useAuth();
  const [initials, setInitials] = useState('');

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const email = data?.user?.email || '';
      setInitials(email.slice(0, 2).toUpperCase());
    });
  }, []);

  return (
    <View style={[styles.bar, HARD_SHADOW_LG]}>
      {onBack && (
        <TouchableOpacity onPress={onBack} hitSlop={8} style={styles.backButton}>
          <Text style={styles.backArrow}>{'←'}</Text>
        </TouchableOpacity>
      )}
      <View style={styles.titleWrap}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {right}
      <View style={[styles.box, HARD_SHADOW]}>
        <Text style={styles.boxText}>{todayHeader()}</Text>
      </View>
      <TouchableOpacity style={[styles.box, HARD_SHADOW]} onPress={signOut} activeOpacity={0.7}>
        <Text style={styles.boxText}>{initials || '⎋'}</Text>
      </TouchableOpacity>
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
  backArrow: {
    fontSize: 22,
    fontWeight: '600',
    color: RETRO.text,
  },
  // Titel + MONO-Untertitel auf gemeinsamer Grundlinie (Retro-Regel)
  titleWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 12,
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
    backgroundColor: RETRO.white,
    borderRadius: 2,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  boxText: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: MONO,
    color: RETRO.text,
  },
});
