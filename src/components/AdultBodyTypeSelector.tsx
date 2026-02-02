import React, { memo, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { AdultBodyType, ADULT_BODY_TYPE_LABELS } from '../types';

interface AdultBodyTypeSelectorProps {
  heightM: string;
  onHeightChange: (height: string) => void;
  bodyType: AdultBodyType | null;
  onBodyTypeChange: (type: AdultBodyType) => void;
}

const BODY_TYPE_OPTIONS: AdultBodyType[] = ['schmaechtig', 'normal', 'athletisch', 'robust'];

export const AdultBodyTypeSelector = memo<AdultBodyTypeSelectorProps>(
  function AdultBodyTypeSelector({ heightM, onHeightChange, bodyType, onBodyTypeChange }) {
    const { colors } = useTheme();

    const handleBodyTypePress = useCallback(
      (type: AdultBodyType) => {
        onBodyTypeChange(type);
      },
      [onBodyTypeChange]
    );

    return (
      <View style={styles.container}>
        {/* Größe */}
        <View style={styles.inputGroup}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>
            Größe (m)
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.inputBackground,
                borderColor: colors.inputBorder,
                color: colors.text,
              },
            ]}
            value={heightM}
            onChangeText={onHeightChange}
            placeholder="z.B. 1.85"
            placeholderTextColor={colors.textSecondary}
            keyboardType="decimal-pad"
          />
        </View>

        {/* Körpertyp */}
        <View style={styles.inputGroup}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>
            Körpertyp
          </Text>
          <View style={styles.chipsContainer}>
            {BODY_TYPE_OPTIONS.map((type) => (
              <TouchableOpacity
                key={type}
                style={[
                  styles.chip,
                  {
                    backgroundColor: bodyType === type ? colors.primary : colors.surfaceSecondary,
                    borderColor: bodyType === type ? colors.primary : colors.border,
                  },
                ]}
                onPress={() => handleBodyTypePress(type)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.chipText,
                    { color: bodyType === type ? colors.primaryText : colors.text },
                  ]}
                >
                  {ADULT_BODY_TYPE_LABELS[type]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>
    );
  }
);

AdultBodyTypeSelector.displayName = 'AdultBodyTypeSelector';

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  inputGroup: {
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  chipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '500',
  },
});

export default AdultBodyTypeSelector;
