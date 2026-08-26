import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { MONO, HARD_SHADOW, RETRO_CHIP, RETRO_CHIP_TEXT } from '../../theme/retro';
import {
  RelativeHeight,
  Proportion,
  Pelvis,
  ShoulderLine,
  Musculature,
  BODY_STRUCTURE_LABELS,
} from '../../types';
import { ToggleButtonRow } from './ToggleButtonRow';

interface KoerperCardProps {
  relativeHeight: RelativeHeight | null;
  onRelativeHeightChange: (value: RelativeHeight | null) => void;
  proportion: Proportion | null;
  onProportionChange: (value: Proportion | null) => void;
  pelvis: Pelvis | null;
  onPelvisChange: (value: Pelvis | null) => void;
  shoulderLine: ShoulderLine | null;
  onShoulderLineChange: (value: ShoulderLine | null) => void;
  musculature: Musculature | null;
  onMusculatureChange: (value: Musculature | null) => void;
}

const GROESSE_OPTIONS: { value: RelativeHeight; label: string }[] = [
  { value: 'unterdurchschnittlich', label: BODY_STRUCTURE_LABELS.relativeHeight.unterdurchschnittlich },
  { value: 'durchschnittlich', label: BODY_STRUCTURE_LABELS.relativeHeight.durchschnittlich },
  { value: 'ueberdurchschnittlich', label: BODY_STRUCTURE_LABELS.relativeHeight.ueberdurchschnittlich },
];

const PROPORTION_OPTIONS: { value: Proportion; label: string }[] = [
  { value: 'langbeinig', label: BODY_STRUCTURE_LABELS.proportion.langbeinig },
  { value: 'ausgeglichen', label: BODY_STRUCTURE_LABELS.proportion.ausgeglichen },
  { value: 'kompakt', label: BODY_STRUCTURE_LABELS.proportion.kompakt },
];

const BECKEN_OPTIONS: { value: Pelvis; label: string }[] = [
  { value: 'schmal', label: BODY_STRUCTURE_LABELS.pelvis.schmal },
  { value: 'mittel', label: BODY_STRUCTURE_LABELS.pelvis.mittel },
  { value: 'breit', label: BODY_STRUCTURE_LABELS.pelvis.breit },
];

const SCHULTER_OPTIONS: { value: ShoulderLine; label: string }[] = [
  { value: 'schmal', label: BODY_STRUCTURE_LABELS.shoulderLine.schmal },
  { value: 'mittel', label: BODY_STRUCTURE_LABELS.shoulderLine.mittel },
  { value: 'breit', label: BODY_STRUCTURE_LABELS.shoulderLine.breit },
];

const MUSKULATUR_OPTIONS: { value: Musculature; label: string }[] = [
  { value: 'wenig_aufbau', label: BODY_STRUCTURE_LABELS.musculature.wenig_aufbau },
  { value: 'altersgerecht', label: BODY_STRUCTURE_LABELS.musculature.altersgerecht },
  { value: 'kraeftig', label: BODY_STRUCTURE_LABELS.musculature.kraeftig },
];

export function KoerperCard({
  relativeHeight,
  onRelativeHeightChange,
  proportion,
  onProportionChange,
  pelvis,
  onPelvisChange,
  shoulderLine,
  onShoulderLineChange,
  musculature,
  onMusculatureChange,
}: KoerperCardProps) {
  const { colors } = useTheme();

  return (
    <View style={[styles.card, HARD_SHADOW, { backgroundColor: colors.surface }]}>
      <View style={RETRO_CHIP}>
        <Text style={RETRO_CHIP_TEXT}>KÖRPER</Text>
      </View>

      <View style={styles.section}>
        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Größe relativ</Text>
        <ToggleButtonRow options={GROESSE_OPTIONS} value={relativeHeight} onChange={onRelativeHeightChange} />
      </View>

      <View style={styles.section}>
        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Proportion</Text>
        <ToggleButtonRow options={PROPORTION_OPTIONS} value={proportion} onChange={onProportionChange} />
      </View>

      <View style={styles.section}>
        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Becken</Text>
        <ToggleButtonRow options={BECKEN_OPTIONS} value={pelvis} onChange={onPelvisChange} />
      </View>

      <View style={styles.section}>
        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Schulterlinie</Text>
        <ToggleButtonRow options={SCHULTER_OPTIONS} value={shoulderLine} onChange={onShoulderLineChange} />
      </View>

      <View style={styles.section}>
        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Muskulatur</Text>
        <ToggleButtonRow options={MUSKULATUR_OPTIONS} value={musculature} onChange={onMusculatureChange} />
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: 2, // Anstoss-Optik: eckig, randlos mit Schatten
    padding: 16,
    gap: 16,
  },
  section: {
    gap: 6,
  },
  fieldLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 2,
    textTransform: 'uppercase',
    fontFamily: MONO,
  },
});
