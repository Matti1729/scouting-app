import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  RefreshControl,
  useWindowDimensions,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { loadWatchlist, WatchlistEntry, BeraterPlayer } from '../../services/beraterService';

export function WatchlistScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const isMobile = width < 768;

  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    const data = await loadWatchlist();
    setWatchlist(data);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [fetchData])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  // Helpers (same as BeraterstatusScreen)
  const formatNameLastFirst = (fullName: string): string => {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length <= 1) return fullName;
    const lastName = parts[parts.length - 1];
    const firstName = parts.slice(0, -1).join(' ');
    return `${lastName}, ${firstName}`;
  };

  const getAgentLabel = (player: BeraterPlayer): { text: string; color: string } => {
    if (!player.current_agent_name || player.current_agent_name === 'kein Beratereintrag') {
      return { text: 'kein Beratereintrag', color: colors.success };
    }
    if (player.current_agent_name === 'Familienangehörige') {
      return { text: 'Familienangehörige', color: colors.warning };
    }
    return { text: player.current_agent_name, color: colors.textSecondary };
  };

  const calculateAge = (birthDate: string | null): string | null => {
    if (!birthDate) return null;
    const parts = birthDate.split('.');
    if (parts.length !== 3) return null;
    const birth = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
    const now = new Date();
    let age = now.getFullYear() - birth.getFullYear();
    if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) {
      age--;
    }
    if (age < 10 || age > 50) return null;
    return `${age} J.`;
  };

  const handlePlayerPress = (player: BeraterPlayer) => {
    if (player.tm_profile_url) {
      Linking.openURL(player.tm_profile_url);
    }
  };

  // Mobile card (same layout as BeraterstatusScreen)
  const renderMobileCard = ({ item }: { item: WatchlistEntry }) => {
    if (!item.player) return null;
    const player = item.player;
    const agentLabel = getAgentLabel(player);
    const age = calculateAge(player.birth_date);

    return (
      <TouchableOpacity
        style={[styles.mobileCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => handlePlayerPress(player)}
        activeOpacity={0.7}
      >
        <View style={styles.mobileCardHeader}>
          <View style={styles.mobileCardNameRow}>
            <Text style={[styles.mobileCardName, { color: colors.text }]} numberOfLines={1}>
              {formatNameLastFirst(player.player_name)}
            </Text>
            {age ? <Text style={[styles.mobileCardAge, { color: colors.textSecondary }]}>{age}</Text> : null}
          </View>
          {player.market_value ? (
            <Text style={[styles.mobileCardMV, { color: colors.text }]}>{player.market_value}</Text>
          ) : null}
        </View>
        <View style={styles.mobileCardRow2}>
          <Text style={[styles.mobileCardClubInline, { color: colors.textSecondary, fontStyle: player.is_vereinslos ? 'italic' : 'normal' }]} numberOfLines={1}>
            {player.is_vereinslos ? `zuletzt: ${player.club_name || ''}` : (player.club_name || '')}
          </Text>
          <View style={[styles.mobileCardAgentBadge, { backgroundColor: agentLabel.color + '10', borderColor: agentLabel.color + '30' }]}>
            <Text style={[styles.mobileCardAgentText, { color: agentLabel.color }]} numberOfLines={1}>
              {agentLabel.text}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  // Desktop row (same layout as BeraterstatusScreen)
  const renderDesktopRow = ({ item }: { item: WatchlistEntry }) => {
    if (!item.player) return null;
    const player = item.player;
    const agentLabel = getAgentLabel(player);
    const age = calculateAge(player.birth_date);

    return (
      <TouchableOpacity
        style={[styles.playerRow, { borderBottomColor: colors.border }]}
        onPress={() => handlePlayerPress(player)}
        activeOpacity={0.7}
      >
        <View style={styles.playerRowColumns}>
          <View style={styles.playerColNameWrap}>
            <Text style={[styles.playerColName, { color: colors.text }]} numberOfLines={1}>
              {formatNameLastFirst(player.player_name)}
            </Text>
            {age ? <Text style={[styles.playerColAge, { color: colors.textSecondary }]}>{age}</Text> : null}
          </View>
          <Text style={[styles.playerColMV, { color: colors.textSecondary }]} numberOfLines={1}>
            {player.market_value || '-'}
          </Text>
          <Text style={[styles.playerColClub, { color: colors.textSecondary, fontStyle: player.is_vereinslos ? 'italic' : 'normal' }]} numberOfLines={1}>
            {player.is_vereinslos ? `zuletzt: ${player.club_name || ''}` : (player.club_name || '')}
          </Text>
          <Text style={[styles.playerColAgent, { color: agentLabel.color }]} numberOfLines={1}>
            {agentLabel.text}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderEmpty = () => (
    <View style={styles.emptyState}>
      <Text style={styles.emptyIcon}>⭐</Text>
      <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Watchlist ist leer</Text>
      <Text style={[styles.emptyHint, { color: colors.textSecondary }]}>
        Füge Spieler im Beraterstatus-Tracker zur Watchlist hinzu
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={[styles.backArrow, { color: colors.text }]}>{'\u2190'}</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Watchlist</Text>
        <Text style={[styles.headerCount, { color: colors.textSecondary }]}>{watchlist.length}</Text>
      </View>

      {/* List */}
      {isMobile ? (
        <FlatList
          data={watchlist}
          renderItem={renderMobileCard}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={!loading ? renderEmpty : null}
          contentContainerStyle={[
            styles.mobileListContent,
            watchlist.length === 0 && !loading ? styles.emptyContainer : undefined,
          ]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
        />
      ) : (
        <View style={[styles.listCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <FlatList
            data={watchlist}
            renderItem={renderDesktopRow}
            keyExtractor={(item) => item.id}
            ListEmptyComponent={!loading ? renderEmpty : null}
            contentContainerStyle={
              watchlist.length === 0 && !loading ? styles.emptyContainer : undefined
            }
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
            }
          />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
  },
  backButton: {
    marginRight: 12,
    padding: 4,
  },
  backArrow: {
    fontSize: 24,
    fontWeight: '600',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    flex: 1,
  },
  headerCount: {
    fontSize: 16,
    fontWeight: '500',
  },

  // Mobile list
  mobileListContent: {
    padding: 12,
  },

  // Desktop list card
  listCard: {
    flex: 1,
    margin: 12,
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },

  // Mobile card (same as BeraterstatusScreen)
  mobileCard: {
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
  },
  mobileCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  mobileCardNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    marginRight: 8,
  },
  mobileCardName: {
    fontSize: 14,
    fontWeight: '600',
    flexShrink: 1,
  },
  mobileCardAge: {
    fontSize: 12,
  },
  mobileCardMV: {
    fontSize: 12,
    fontWeight: '500',
  },
  mobileCardRow2: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  mobileCardClubInline: {
    fontSize: 12,
    flex: 1,
    flexShrink: 1,
  },
  mobileCardAgentBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    flexShrink: 0,
  },
  mobileCardAgentText: {
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
  },

  // Desktop row (same as BeraterstatusScreen)
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderBottomWidth: 1,
    minHeight: 38,
  },
  playerRowColumns: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  playerColNameWrap: {
    flex: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  playerColName: {
    fontSize: 12,
    fontWeight: '500',
    flexShrink: 1,
  },
  playerColAge: {
    fontSize: 11,
  },
  playerColMV: {
    flex: 1,
    fontSize: 11,
  },
  playerColClub: {
    flex: 1.5,
    fontSize: 11,
  },
  playerColAgent: {
    flex: 2,
    fontSize: 11,
  },

  // Empty state
  emptyContainer: {
    flex: 1,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 4,
  },
  emptyHint: {
    fontSize: 13,
    textAlign: 'center',
    maxWidth: 250,
  },
});
