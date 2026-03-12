import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';

interface RatingBarProps {
  value: number;
  onChange: (value: number) => void;
}

const BARS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export function RatingBar({ value, onChange }: RatingBarProps) {
  const { colors } = useTheme();

  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>RATING</Text>
      <View style={styles.row}>
        <Text style={[styles.valueText, { color: colors.primary }]}>
          {value || '-'}/10
        </Text>
        <View style={styles.barsContainer}>
          {BARS.map((num) => (
            <TouchableOpacity
              key={num}
              onPress={() => onChange(num === value ? 0 : num)}
              style={styles.barTouchable}
              activeOpacity={0.7}
            >
              <View
                style={[
                  styles.bar,
                  {
                    backgroundColor: num <= value ? colors.primary : colors.border,
                  },
                ]}
              />
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  valueText: {
    fontSize: 22,
    fontWeight: '700',
  },
  barsContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
  },
  bar: {
    width: 4,
    height: 22,
    borderRadius: 2,
  },
  barTouchable: {
    padding: 2,
  },
});
