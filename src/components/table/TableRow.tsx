import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';

interface TableRowProps {
  columnOrder: string[];
  getColumnWidth: (key: string) => number;
  renderCell: (key: string, width: number) => React.ReactNode;
  style?: any;
  onPress?: () => void;
  activeOpacity?: number;
}

export function TableRow({
  columnOrder,
  getColumnWidth,
  renderCell,
  style,
  onPress,
  activeOpacity = 0.7,
}: TableRowProps) {
  const cells = columnOrder.map((key) => {
    const width = getColumnWidth(key);
    return (
      <View key={key} style={[styles.cell, { width }]}>
        {renderCell(key, width)}
      </View>
    );
  });

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={activeOpacity} style={[styles.row, style]}>
        {cells}
      </TouchableOpacity>
    );
  }

  return (
    <View style={[styles.row, style]}>
      {cells}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cell: {
    paddingHorizontal: 6,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
});
