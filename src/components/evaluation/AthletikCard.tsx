import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import {
  SpeedRating,
  Flexibility,
  Coordination,
  Intensity,
  SPEED_RATING_LABELS,
  FLEXIBILITY_LABELS,
  COORDINATION_LABELS,
  INTENSITY_LABELS,
} from '../../types';
import { ToggleButtonRow } from './ToggleButtonRow';

interface AthletikCardProps {
  antritt: SpeedRating | null;
  onAntrittChange: (value: SpeedRating | null) => void;
  endspeed: SpeedRating | null;
  onEndspeedChange: (value: SpeedRating | null) => void;
  beweglichkeit: Flexibility | null;
  onBeweglichkeitChange: (value: Flexibility | null) => void;
  koordination: Coordination | null;
  onKoordinationChange: (value: Coordination | null) => void;
  intensitaet: Intensity | null;
  onIntensitaetChange: (value: Intensity | null) => void;
}

const SPEED_OPTIONS: { value: SpeedRating; label: string }[] = [
  { value: 'top', label: SPEED_RATING_LABELS.top },
  { value: 'gut', label: SPEED_RATING_LABELS.gut },
  { value: 'durchschnitt', label: SPEED_RATING_LABELS.durchschnitt },
  { value: 'schwach', label: SPEED_RATING_LABELS.schwach },
];

const BEWEGLICHKEIT_OPTIONS: { value: Flexibility; label: string }[] = [
  { value: 'sehr_beweglich', label: FLEXIBILITY_LABELS.sehr_beweglich },
  { value: 'beweglich', label: FLEXIBILITY_LABELS.beweglich },
  { value: 'durchschnittlich', label: FLEXIBILITY_LABELS.durchschnittlich },
  { value: 'steif', label: FLEXIBILITY_LABELS.steif },
];

const KOORDINATION_OPTIONS: { value: Coordination; label: string }[] = [
  { value: 'sauber', label: COORDINATION_LABELS.sauber },
  { value: 'normal', label: COORDINATION_LABELS.normal },
  { value: 'wacklig', label: COORDINATION_LABELS.wacklig },
];

const INTENSITAET_OPTIONS: { value: Intensity; label: string }[] = [
  { value: 'hoch', label: INTENSITY_LABELS.hoch },
  { value: 'mittel', label: INTENSITY_LABELS.mittel },
  { value: 'niedrig', label: INTENSITY_LABELS.niedrig },
];

export function AthletikCard({
  antritt,
  onAntrittChange,
  endspeed,
  onEndspeedChange,
  beweglichkeit,
  onBeweglichkeitChange,
  koordination,
  onKoordinationChange,
  intensitaet,
  onIntensitaetChange,
}: AthletikCardProps) {
  const { colors } = useTheme();

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.titleRow}>
        <Ionicons name="flash-outline" size={18} color={colors.textSecondary} />
        <Text style={[styles.title, { color: colors.text }]}>Athletik</Text>
      </View>

      <View style={styles.section}>
        <Text style={[styles.fieldLabel, { color: colors.text }]}>Antritt (0-20m)</Text>
        <ToggleButtonRow options={SPEED_OPTIONS} value={antritt} onChange={onAntrittChange} />
      </View>

      <View style={styles.section}>
        <Text style={[styles.fieldLabel, { color: colors.text }]}>Endspeed (20m+)</Text>
        <ToggleButtonRow options={SPEED_OPTIONS} value={endspeed} onChange={onEndspeedChange} />
      </View>

      <View style={styles.section}>
        <Text style={[styles.fieldLabel, { color: colors.text }]}>Beweglichkeit</Text>
        <ToggleButtonRow options={BEWEGLICHKEIT_OPTIONS} value={beweglichkeit} onChange={onBeweglichkeitChange} />
      </View>

      <View style={styles.section}>
        <Text style={[styles.fieldLabel, { color: colors.text }]}>Koordination</Text>
        <ToggleButtonRow options={KOORDINATION_OPTIONS} value={koordination} onChange={onKoordinationChange} />
      </View>

      <View style={styles.section}>
        <Text style={[styles.fieldLabel, { color: colors.text }]}>Intensität</Text>
        <ToggleButtonRow options={INTENSITAET_OPTIONS} value={intensitaet} onChange={onIntensitaetChange} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 16,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
  },
  section: {
    gap: 6,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
});
