import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';

interface ToggleOption<T extends string> {
  value: T;
  label: string;
}

interface ToggleButtonRowProps<T extends string> {
  options: ToggleOption<T>[];
  value: T | null;
  onChange: (value: T | null) => void;
}

export function ToggleButtonRow<T extends string>({
  options,
  value,
  onChange,
}: ToggleButtonRowProps<T>) {
  const { colors } = useTheme();

  return (
    <View style={styles.row}>
      {options.map((opt) => {
        const isSelected = value === opt.value;
        return (
          <TouchableOpacity
            key={opt.value}
            style={[
              styles.button,
              {
                backgroundColor: isSelected ? colors.primary : colors.surfaceSecondary,
                borderColor: isSelected ? colors.primary : colors.border,
              },
            ]}
            onPress={() => onChange(isSelected ? null : opt.value)}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.buttonText,
                {
                  color: isSelected ? colors.primaryText : colors.text,
                  fontWeight: isSelected ? '600' : '500',
                },
              ]}
              numberOfLines={1}
            >
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 6,
  },
  button: {
    flex: 1,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
  },
  buttonText: {
    fontSize: 10,
  },
});
