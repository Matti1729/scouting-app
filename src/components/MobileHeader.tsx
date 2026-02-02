import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';

interface MobileHeaderProps {
  title: string;
  onMenuPress: () => void;
  onProfilePress?: () => void;
  profileInitials?: string;
  showBackButton?: boolean;
  onBackPress?: () => void;
}

export function MobileHeader({
  title,
  onMenuPress,
  onProfilePress,
  profileInitials,
  showBackButton,
  onBackPress,
}: MobileHeaderProps) {
  const { colors } = useTheme();

  return (
    <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
      {showBackButton ? (
        <TouchableOpacity
          style={[styles.menuButton, { backgroundColor: colors.surfaceSecondary }]}
          onPress={onBackPress}
        >
          <Text style={[styles.menuIcon, { color: colors.text }]}>←</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={[styles.menuButton, { backgroundColor: colors.surfaceSecondary }]}
          onPress={onMenuPress}
        >
          <Text style={[styles.menuIcon, { color: colors.text }]}>☰</Text>
        </TouchableOpacity>
      )}

      <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>{title}</Text>

      {onProfilePress ? (
        <TouchableOpacity
          style={[styles.profileButton, { backgroundColor: colors.primary }]}
          onPress={onProfilePress}
        >
          <Text style={[styles.profileInitials, { color: colors.primaryText }]}>
            {profileInitials || '?'}
          </Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.placeholder} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
  },
  menuButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuIcon: {
    fontSize: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    flex: 1,
    textAlign: 'center',
    marginHorizontal: 12,
  },
  profileButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileInitials: {
    fontSize: 14,
    fontWeight: '600',
  },
  placeholder: {
    width: 40,
  },
});
