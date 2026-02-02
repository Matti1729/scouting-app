import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { DevelopmentStage, AgeGroup, AVG_HEIGHT_BY_AGE } from '../types';

interface DevelopmentStageSelectorProps {
  selectedStage: DevelopmentStage;
  onStageSelect: (stage: DevelopmentStage) => void;
  ageGroup?: AgeGroup;
  heightCm?: number;
}

const STAGES: { value: DevelopmentStage; label: string; description: string }[] = [
  {
    value: 'vor_wachstumsschub',
    label: 'Vor Wachstumsschub',
    description: 'U14, noch alles offen',
  },
  {
    value: 'im_wachstumsschub',
    label: 'Im Wachstumsschub',
    description: 'U15-U16, gerade im Schub',
  },
  {
    value: 'nach_wachstumsschub',
    label: 'Nach Wachstumsschub',
    description: 'U17+, Wachstum verlangsamt',
  },
  {
    value: 'ausgewachsen',
    label: 'Ausgewachsen',
    description: 'U19+, Endgröße erreicht',
  },
];

// Empfohlener Entwicklungsstand basierend auf Altersklasse
function getRecommendedStage(ageGroup?: AgeGroup): DevelopmentStage {
  if (!ageGroup) return 'im_wachstumsschub';
  switch (ageGroup) {
    case 'U14':
      return 'vor_wachstumsschub';
    case 'U15':
    case 'U16':
      return 'im_wachstumsschub';
    case 'U17':
      return 'nach_wachstumsschub';
    case 'U19':
    case 'Herren':
      return 'ausgewachsen';
    default:
      return 'im_wachstumsschub';
  }
}

export function DevelopmentStageSelector({
  selectedStage,
  onStageSelect,
  ageGroup,
  heightCm,
}: DevelopmentStageSelectorProps) {
  const { colors } = useTheme();
  const recommendedStage = getRecommendedStage(ageGroup);

  // Größenvergleich berechnen
  const heightDiff = ageGroup && heightCm ? heightCm - AVG_HEIGHT_BY_AGE[ageGroup] : null;

  return (
    <View style={styles.container}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>Entwicklungsstand</Text>

      {/* Größenvergleich anzeigen */}
      {heightDiff !== null && (
        <View style={[styles.heightCompare, { backgroundColor: colors.surfaceSecondary }]}>
          <Text style={[styles.heightCompareText, { color: colors.textSecondary }]}>
            Größe im Vergleich zum Ø {ageGroup}:{' '}
            <Text
              style={{
                color: heightDiff >= 0 ? colors.success : colors.warning,
                fontWeight: '600',
              }}
            >
              {heightDiff >= 0 ? '+' : ''}{heightDiff} cm
            </Text>
            {' '}(Ø: {AVG_HEIGHT_BY_AGE[ageGroup!]} cm)
          </Text>
        </View>
      )}

      {/* Stage Buttons */}
      <View style={styles.stagesContainer}>
        {STAGES.map((stage) => {
          const isSelected = selectedStage === stage.value;
          const isRecommended = stage.value === recommendedStage;

          return (
            <TouchableOpacity
              key={stage.value}
              style={[
                styles.stageButton,
                {
                  backgroundColor: isSelected ? colors.primary : colors.surfaceSecondary,
                  borderColor: isSelected ? colors.primary : colors.border,
                },
              ]}
              onPress={() => onStageSelect(stage.value)}
              activeOpacity={0.7}
            >
              <View style={styles.stageContent}>
                <Text
                  style={[
                    styles.stageLabel,
                    { color: isSelected ? colors.primaryText : colors.text },
                  ]}
                >
                  {stage.label}
                  {isRecommended && !isSelected && ' *'}
                </Text>
                <Text
                  style={[
                    styles.stageDescription,
                    {
                      color: isSelected
                        ? colors.primaryText
                        : colors.textSecondary,
                      opacity: isSelected ? 0.9 : 0.8,
                    },
                  ]}
                >
                  {stage.description}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {ageGroup && (
        <Text style={[styles.hint, { color: colors.textSecondary }]}>
          * Empfohlen für {ageGroup}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  heightCompare: {
    padding: 12,
    borderRadius: 8,
  },
  heightCompareText: {
    fontSize: 14,
  },
  stagesContainer: {
    gap: 8,
  },
  stageButton: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  stageContent: {
    gap: 2,
  },
  stageLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  stageDescription: {
    fontSize: 13,
  },
  hint: {
    fontSize: 12,
    fontStyle: 'italic',
  },
});
