import React, { memo, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import {
  SpeedAthleticismData,
  SpeedRating,
  MovementEconomy,
  Intensity,
  Flexibility,
  Coordination,
  SPEED_RATING_LABELS,
  MOVEMENT_ECONOMY_LABELS,
  INTENSITY_LABELS,
  FLEXIBILITY_LABELS,
  COORDINATION_LABELS,
} from '../types';

interface SpeedAthleticismSelectorProps {
  data: SpeedAthleticismData;
  onChange: (data: SpeedAthleticismData) => void;
}

// Generische Chip-Row Komponente mit Toggle (abwählbar)
interface ChipRowProps<T extends string> {
  label: string;
  hint?: string;
  options: T[];
  labels: Record<T, string>;
  selectedValue: T | null;
  onSelect: (value: T | null) => void;
}

function ChipRow<T extends string>({
  label,
  hint,
  options,
  labels,
  selectedValue,
  onSelect,
}: ChipRowProps<T>) {
  const { colors } = useTheme();

  const handlePress = (option: T) => {
    // Toggle: wenn bereits ausgewählt, abwählen (null setzen)
    if (selectedValue === option) {
      onSelect(null);
    } else {
      onSelect(option);
    }
  };

  return (
    <View style={styles.attributeRow}>
      <View style={styles.labelContainer}>
        <Text style={[styles.attributeLabel, { color: colors.text }]}>
          {label}
        </Text>
        {hint && (
          <Text style={[styles.hintText, { color: colors.textSecondary }]}>
            {hint}
          </Text>
        )}
      </View>
      <View style={styles.chipsContainer}>
        {options.map((option) => (
          <TouchableOpacity
            key={option}
            style={[
              styles.chip,
              {
                backgroundColor: selectedValue === option ? colors.primary : colors.surfaceSecondary,
                borderColor: selectedValue === option ? colors.primary : colors.border,
              },
            ]}
            onPress={() => handlePress(option)}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.chipText,
                { color: selectedValue === option ? colors.primaryText : colors.text },
              ]}
            >
              {labels[option]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const SPEED_OPTIONS: SpeedRating[] = ['top', 'gut', 'durchschnitt', 'schwach'];
const ECONOMY_OPTIONS: MovementEconomy[] = ['leichtfuessig', 'neutral', 'schwerfaellig'];
const INTENSITY_OPTIONS: Intensity[] = ['hoch', 'mittel', 'niedrig'];
const FLEXIBILITY_OPTIONS: Flexibility[] = ['sehr_beweglich', 'beweglich', 'durchschnittlich', 'steif'];
const COORDINATION_OPTIONS: Coordination[] = ['sauber', 'normal', 'wacklig'];

export const SpeedAthleticismSelector = memo<SpeedAthleticismSelectorProps>(
  function SpeedAthleticismSelector({ data, onChange }) {
    const handleAntrittChange = useCallback(
      (antritt: SpeedRating | null) => {
        onChange({ ...data, antritt });
      },
      [data, onChange]
    );

    const handleEndspeedChange = useCallback(
      (endspeed: SpeedRating | null) => {
        onChange({ ...data, endspeed });
      },
      [data, onChange]
    );

    const handleBewegungsoekonomieChange = useCallback(
      (bewegungsoekonomie: MovementEconomy | null) => {
        onChange({ ...data, bewegungsoekonomie });
      },
      [data, onChange]
    );

    const handleIntensitaetChange = useCallback(
      (intensitaet: Intensity | null) => {
        onChange({ ...data, intensitaet });
      },
      [data, onChange]
    );

    const handleBeweglichkeitChange = useCallback(
      (beweglichkeit: Flexibility | null) => {
        onChange({ ...data, beweglichkeit });
      },
      [data, onChange]
    );

    const handleKoordinationChange = useCallback(
      (koordination: Coordination | null) => {
        onChange({ ...data, koordination });
      },
      [data, onChange]
    );

    return (
      <View style={styles.container}>
        {/* Antritt (0-20m) */}
        <ChipRow
          label="Antritt (0-20m)"
          hint="Explosivität, Beschleunigung"
          options={SPEED_OPTIONS}
          labels={SPEED_RATING_LABELS}
          selectedValue={data.antritt}
          onSelect={handleAntrittChange}
        />

        {/* Endspeed (20m+) */}
        <ChipRow
          label="Endspeed (20m+)"
          hint="Maximale Sprintgeschwindigkeit"
          options={SPEED_OPTIONS}
          labels={SPEED_RATING_LABELS}
          selectedValue={data.endspeed}
          onSelect={handleEndspeedChange}
        />

        {/* Bewegungsökonomie */}
        <ChipRow
          label="Bewegungsökonomie"
          hint="Laufstil - flüssig oder schwerfällig"
          options={ECONOMY_OPTIONS}
          labels={MOVEMENT_ECONOMY_LABELS}
          selectedValue={data.bewegungsoekonomie}
          onSelect={handleBewegungsoekonomieChange}
        />

        {/* Beweglichkeit */}
        <ChipRow
          label="Beweglichkeit"
          hint="Gelenkigkeit, Drehungen"
          options={FLEXIBILITY_OPTIONS}
          labels={FLEXIBILITY_LABELS}
          selectedValue={data.beweglichkeit}
          onSelect={handleBeweglichkeitChange}
        />

        {/* Koordination */}
        <ChipRow
          label="Koordination"
          hint="Körperbeherrschung, Gleichgewicht"
          options={COORDINATION_OPTIONS}
          labels={COORDINATION_LABELS}
          selectedValue={data.koordination}
          onSelect={handleKoordinationChange}
        />

        {/* Intensität */}
        <ChipRow
          label="Intensität"
          hint="Laufbereitschaft, intensive Läufe"
          options={INTENSITY_OPTIONS}
          labels={INTENSITY_LABELS}
          selectedValue={data.intensitaet}
          onSelect={handleIntensitaetChange}
        />
      </View>
    );
  }
);

SpeedAthleticismSelector.displayName = 'SpeedAthleticismSelector';

// Helper-Funktion zum Erstellen leerer Daten
export function createEmptySpeedAthleticismData(): SpeedAthleticismData {
  return {
    antritt: null,
    endspeed: null,
    bewegungsoekonomie: null,
    intensitaet: null,
    beweglichkeit: null,
    koordination: null,
  };
}

const styles = StyleSheet.create({
  container: {
    gap: 16,
  },
  attributeRow: {
    gap: 6,
  },
  labelContainer: {
    gap: 2,
  },
  attributeLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  hintText: {
    fontSize: 12,
    fontStyle: 'italic',
  },
  chipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '500',
  },
});

export default SpeedAthleticismSelector;
