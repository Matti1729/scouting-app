import React, { memo, useCallback, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import {
  BodyStructureData,
  RelativeHeight,
  Proportion,
  Pelvis,
  ShoulderLine,
  Musculature,
  MovementPattern,
  BODY_STRUCTURE_LABELS,
} from '../types';
import { calculateBodyStructurePrognosis, isBodyStructureComplete } from '../utils/bodyStructureCalculation';

interface BodyStructureSelectorProps {
  data: BodyStructureData;
  onChange: (data: BodyStructureData) => void;
  playerAge: number | null; // Alter aus Spielerdaten (Geburtsdatum/Jahrgang)
}

// Chip-Komponente für einzelne Auswahl
interface ChipProps<T> {
  value: T;
  label: string;
  isSelected: boolean;
  onPress: (value: T) => void;
}

function Chip<T>({ value, label, isSelected, onPress }: ChipProps<T>) {
  const { colors } = useTheme();

  const handlePress = useCallback(() => {
    onPress(value);
  }, [value, onPress]);

  return (
    <TouchableOpacity
      style={[
        styles.chip,
        {
          backgroundColor: isSelected ? colors.primary : colors.surfaceSecondary,
          borderColor: isSelected ? colors.primary : colors.border,
        },
      ]}
      onPress={handlePress}
      activeOpacity={0.7}
    >
      <Text
        style={[
          styles.chipText,
          { color: isSelected ? colors.primaryText : colors.text },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// Zeile mit Label und Chips
interface AttributeRowProps<T> {
  label: string;
  options: { value: T; label: string }[];
  selectedValue: T | null;
  onSelect: (value: T) => void;
}

function AttributeRow<T>({
  label,
  options,
  selectedValue,
  onSelect,
}: AttributeRowProps<T>) {
  const { colors } = useTheme();

  return (
    <View style={styles.attributeRow}>
      <Text style={[styles.attributeLabel, { color: colors.textSecondary }]}>
        {label}
      </Text>
      <View style={styles.chipsContainer}>
        {options.map((option, index) => (
          <Chip
            key={index}
            value={option.value}
            label={option.label}
            isSelected={selectedValue === option.value}
            onPress={onSelect}
          />
        ))}
      </View>
    </View>
  );
}

export const BodyStructureSelector = memo<BodyStructureSelectorProps>(
  function BodyStructureSelector({ data, onChange, playerAge }) {
    const { colors } = useTheme();

    // Größe-Optionen
    const heightOptions = useMemo(
      () =>
        (['unterdurchschnittlich', 'durchschnittlich', 'ueberdurchschnittlich'] as RelativeHeight[]).map(
          (v) => ({
            value: v,
            label: BODY_STRUCTURE_LABELS.relativeHeight[v],
          })
        ),
      []
    );

    // Proportion-Optionen
    const proportionOptions = useMemo(
      () =>
        (['langbeinig', 'ausgeglichen', 'kompakt'] as Proportion[]).map((v) => ({
          value: v,
          label: BODY_STRUCTURE_LABELS.proportion[v],
        })),
      []
    );

    // Becken-Optionen
    const pelvisOptions = useMemo(
      () =>
        (['schmal', 'mittel', 'breit'] as Pelvis[]).map((v) => ({
          value: v,
          label: BODY_STRUCTURE_LABELS.pelvis[v],
        })),
      []
    );

    // Schulterlinie-Optionen
    const shoulderOptions = useMemo(
      () =>
        (['schmal', 'mittel', 'breit'] as ShoulderLine[]).map((v) => ({
          value: v,
          label: BODY_STRUCTURE_LABELS.shoulderLine[v],
        })),
      []
    );

    // Muskulatur-Optionen
    const musculatureOptions = useMemo(
      () =>
        (['wenig_aufbau', 'altersgerecht', 'kraeftig'] as Musculature[]).map((v) => ({
          value: v,
          label: BODY_STRUCTURE_LABELS.musculature[v],
        })),
      []
    );

    // Bewegungsbild-Optionen
    const movementOptions = useMemo(
      () =>
        (['leichtfuessig', 'neutral', 'schwerfaellig'] as MovementPattern[]).map((v) => ({
          value: v,
          label: BODY_STRUCTURE_LABELS.movementPattern[v],
        })),
      []
    );

    // Handler für jedes Attribut
    const handleHeightChange = useCallback(
      (relativeHeight: RelativeHeight) => {
        onChange({ ...data, relativeHeight });
      },
      [data, onChange]
    );

    const handleProportionChange = useCallback(
      (proportion: Proportion) => {
        onChange({ ...data, proportion });
      },
      [data, onChange]
    );

    const handlePelvisChange = useCallback(
      (pelvis: Pelvis) => {
        onChange({ ...data, pelvis });
      },
      [data, onChange]
    );

    const handleShoulderChange = useCallback(
      (shoulderLine: ShoulderLine) => {
        onChange({ ...data, shoulderLine });
      },
      [data, onChange]
    );

    const handleMusculatureChange = useCallback(
      (musculature: Musculature) => {
        onChange({ ...data, musculature });
      },
      [data, onChange]
    );

    const handleMovementChange = useCallback(
      (movementPattern: MovementPattern) => {
        onChange({ ...data, movementPattern });
      },
      [data, onChange]
    );

    // Prognose berechnen (mit playerAge)
    const prognosis = useMemo(
      () => calculateBodyStructurePrognosis(data, playerAge),
      [data, playerAge]
    );

    // Hinweis-Text bestimmen
    const getHintText = () => {
      const fieldsComplete = isBodyStructureComplete(data);
      if (!fieldsComplete && playerAge === null) {
        return 'Alle Felder ausfüllen für Prognose (Alter aus Geburtsdatum)';
      }
      if (!fieldsComplete) {
        return 'Alle Felder ausfüllen für Prognose';
      }
      if (playerAge === null) {
        return 'Geburtsdatum fehlt für Altersberechnung';
      }
      return null;
    };

    const hintText = getHintText();

    return (
      <View style={styles.container}>
        {/* Größe relativ */}
        <AttributeRow
          label="Größe relativ"
          options={heightOptions}
          selectedValue={data.relativeHeight}
          onSelect={handleHeightChange}
        />

        {/* Proportion */}
        <AttributeRow
          label="Proportion"
          options={proportionOptions}
          selectedValue={data.proportion}
          onSelect={handleProportionChange}
        />

        {/* Becken */}
        <AttributeRow
          label="Becken"
          options={pelvisOptions}
          selectedValue={data.pelvis}
          onSelect={handlePelvisChange}
        />

        {/* Schulterlinie */}
        <AttributeRow
          label="Schulterlinie"
          options={shoulderOptions}
          selectedValue={data.shoulderLine}
          onSelect={handleShoulderChange}
        />

        {/* Muskulatur */}
        <AttributeRow
          label="Muskulatur"
          options={musculatureOptions}
          selectedValue={data.musculature}
          onSelect={handleMusculatureChange}
        />

        {/* Bewegungsbild */}
        <AttributeRow
          label="Bewegungsbild"
          options={movementOptions}
          selectedValue={data.movementPattern}
          onSelect={handleMovementChange}
        />

        {/* Prognose-Box (nur wenn alle Felder ausgefüllt + Alter vorhanden) */}
        {prognosis && (
          <View
            style={[
              styles.prognosisBox,
              {
                backgroundColor: colors.surfaceSecondary,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={styles.prognosisRow}>
              <View style={styles.prognosisItem}>
                <Text style={[styles.prognosisLabel, { color: colors.textSecondary }]}>
                  Tendenz
                </Text>
                <Text
                  style={[
                    styles.prognosisValue,
                    {
                      color:
                        prognosis.tendency === 'im_aufbau'
                          ? colors.primary
                          : prognosis.tendency === 'koerperlich_weit'
                          ? '#e67e22'
                          : colors.text,
                    },
                  ]}
                >
                  {BODY_STRUCTURE_LABELS.tendency[prognosis.tendency].toUpperCase()}
                </Text>
              </View>

              <View style={styles.prognosisItem}>
                <Text style={[styles.prognosisLabel, { color: colors.textSecondary }]}>
                  Upside
                </Text>
                <Text
                  style={[
                    styles.prognosisValue,
                    {
                      color:
                        prognosis.upside === 'HIGH'
                          ? '#27ae60'
                          : prognosis.upside === 'LOW'
                          ? '#c0392b'
                          : '#f39c12',
                    },
                  ]}
                >
                  {prognosis.upside}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Hinweis wenn nicht komplett */}
        {hintText && (
          <Text style={[styles.incompleteHint, { color: colors.textSecondary }]}>
            {hintText}
          </Text>
        )}
      </View>
    );
  }
);

BodyStructureSelector.displayName = 'BodyStructureSelector';

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  attributeRow: {
    gap: 6,
  },
  attributeLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  chipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
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
  prognosisBox: {
    marginTop: 8,
    padding: 16,
    borderRadius: 10,
    borderWidth: 1,
  },
  prognosisRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  prognosisItem: {
    alignItems: 'center',
    gap: 4,
  },
  prognosisLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  prognosisValue: {
    fontSize: 16,
    fontWeight: '700',
  },
  incompleteHint: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
    fontStyle: 'italic',
  },
});

export default BodyStructureSelector;
