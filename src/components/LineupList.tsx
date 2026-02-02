import React, { useCallback, useMemo, memo } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ListRenderItemInfo,
} from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { PlayerRow, Player } from './PlayerRow';

// Hilfsfunktion: Spieler nach Trikotnummer sortieren
const sortByNumber = (players: Player[]): Player[] => {
  return [...players].sort((a, b) => {
    const numA = parseInt(a.nummer, 10) || 999;
    const numB = parseInt(b.nummer, 10) || 999;
    return numA - numB;
  });
};

export interface LineupListProps {
  players: Player[];
  subs: Player[];
  onPlayerPress?: (player: Player) => void;
  onFieldChange?: (playerId: string, field: keyof Player, value: string) => void;
  isEditMode: boolean;
  teamName?: string;  // Optional - if not provided, no title is rendered
  emptyMessage?: string;
}

const ITEM_HEIGHT = 38;

export const LineupList = memo<LineupListProps>(({
  players,
  subs,
  onPlayerPress,
  onFieldChange,
  isEditMode,
  teamName,
  emptyMessage = 'Keine Spieler vorhanden',
}) => {
  const { colors } = useTheme();

  // Memoize sorted players to prevent re-sorting on every render
  const sortedPlayers = useMemo(() => sortByNumber(players), [players]);
  const sortedSubs = useMemo(() => sortByNumber(subs), [subs]);

  // Combine players and subs with a section header
  const combinedData = useMemo(() => {
    const data: Array<Player | { type: 'header'; title: string } | { type: 'empty'; message: string }> = [];

    if (sortedPlayers.length === 0 && sortedSubs.length === 0) {
      data.push({ type: 'empty', message: emptyMessage });
    } else {
      // Add players
      data.push(...sortedPlayers);

      // Add subs header and subs if there are any
      if (sortedSubs.length > 0) {
        data.push({ type: 'header', title: 'Auswechselspieler' });
        data.push(...sortedSubs);
      }
    }

    return data;
  }, [sortedPlayers, sortedSubs, emptyMessage]);

  // Memoized render function
  const renderItem = useCallback(({ item }: ListRenderItemInfo<typeof combinedData[0]>) => {
    if ('type' in item) {
      if (item.type === 'header') {
        return (
          <Text style={[styles.subsTitle, { color: colors.textSecondary }]}>
            {item.title}
          </Text>
        );
      }
      if (item.type === 'empty') {
        return (
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            {item.message}
          </Text>
        );
      }
    }

    // It's a Player
    const player = item as Player;
    return (
      <PlayerRow
        player={player}
        onPress={onPlayerPress}
        onFieldChange={onFieldChange}
        isEditMode={isEditMode}
        showPosition={sortedSubs.some(s => s.id === player.id)}
      />
    );
  }, [colors.textSecondary, onPlayerPress, onFieldChange, isEditMode, sortedSubs]);

  // Key extractor
  const keyExtractor = useCallback((item: typeof combinedData[0]) => {
    if ('type' in item) {
      return item.type === 'header' ? 'header-subs' : 'empty-message';
    }
    return item.id;
  }, []);

  // getItemLayout for performance optimization
  const getItemLayout = useCallback((_: any, index: number) => ({
    length: ITEM_HEIGHT,
    offset: ITEM_HEIGHT * index,
    index,
  }), []);

  return (
    <View style={styles.container}>
      {teamName && (
        <Text style={[styles.teamTitle, { color: colors.text }]}>
          {teamName}
        </Text>
      )}
      <FlatList
        data={combinedData}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        getItemLayout={getItemLayout}
        removeClippedSubviews={true}
        initialNumToRender={12}
        maxToRenderPerBatch={8}
        windowSize={5}
        showsVerticalScrollIndicator={false}
        style={styles.list}
      />
    </View>
  );
});

LineupList.displayName = 'LineupList';

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  teamTitle: {
    fontSize: 16,
    fontWeight: '600',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  list: {
    flex: 1,
  },
  subsTitle: {
    fontSize: 11,
    fontWeight: '600',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 20,
    paddingHorizontal: 12,
  },
});

export default LineupList;
