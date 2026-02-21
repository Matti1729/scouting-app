import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { RootStackParamList } from '../../navigation/types';
import { loadScanStatus, BeraterStats, ScanState, loadWatchlist, WatchlistEntry, removeFromWatchlist } from '../../services/beraterService';
import { supabase } from '../../config/supabase';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

interface BeraterDashboardData {
  stats: BeraterStats | null;
  scanState: ScanState | null;
}

export function DashboardScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { colors, isDark, toggleTheme } = useTheme();
  const { signOut } = useAuth();
  const { width } = useWindowDimensions();
  const isWide = width > 900;

  const [upcomingMatches, setUpcomingMatches] = useState(0);
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);
  const [beraterData, setBeraterData] = useState<BeraterDashboardData>({ stats: null, scanState: null });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    // Lade Spiele-Count aus Supabase
    try {
      const { count } = await supabase
        .from('scouting_matches')
        .select('*', { count: 'exact', head: true })
        .eq('is_archived', false);
      setUpcomingMatches(count || 0);
    } catch (e) {
      console.error('Error loading matches:', e);
    }

    // Lade Watchlist aus Supabase
    try {
      const result = await loadWatchlist();
      setWatchlist(result);
    } catch (e) {
      console.error('Error loading watchlist:', e);
    }

    // Lade Beraterstatus-Tracker Daten von Supabase
    try {
      const result = await loadScanStatus();
      setBeraterData({ stats: result.stats, scanState: result.scanState });
    } catch (e) {
      console.error('Error loading berater status:', e);
    }
  };

  const handleRemoveFromWatchlist = async (playerId: string) => {
    const success = await removeFromWatchlist(playerId);
    if (success) {
      setWatchlist(prev => prev.filter(w => w.player_id !== playerId));
    }
  };

  const getAgentLabel = (player: WatchlistEntry['player']) => {
    if (!player) return { text: '-', color: colors.textSecondary };
    if (!player.current_agent_name || player.current_agent_name === 'kein Beratereintrag') {
      return { text: 'kein Beratereintrag', color: colors.success };
    }
    if (player.current_agent_name === 'Familienangehörige') {
      return { text: 'Familienangehörige', color: colors.warning };
    }
    return { text: player.current_agent_name, color: colors.textSecondary };
  };

  const calculateAge = (birthDate: string | null): string | null => {
    if (!birthDate) return 'k.A.';
    const parts = birthDate.split('.');
    if (parts.length !== 3) return 'k.A.';
    const birth = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
    const now = new Date();
    let age = now.getFullYear() - birth.getFullYear();
    if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) {
      age--;
    }
    if (age < 10 || age > 50) return 'k.A.';
    return `${age} J.`;
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <View style={styles.headerLeft}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Scouting Dashboard</Text>
          <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
            Spieler & Spiele im Blick
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity
            style={[styles.themeToggle, { backgroundColor: colors.surfaceSecondary }]}
            onPress={toggleTheme}
          >
            <Text style={styles.themeIcon}>{isDark ? '☀️' : '🌙'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.themeToggle, { backgroundColor: colors.error + '20' }]}
            onPress={signOut}
          >
            <Text style={styles.themeIcon}>🚪</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        <View style={[styles.cardsContainer, isWide && styles.cardsContainerWide]}>
          {/* Spiele Karte */}
          <TouchableOpacity
            style={[
              styles.card,
              isWide && styles.cardWide,
              { backgroundColor: colors.cardBackground, borderColor: colors.cardBorder },
            ]}
            onPress={() => navigation.navigate('MatchList')}
          >
            <View style={styles.cardHeader}>
              <View style={[styles.cardIconContainer, { backgroundColor: colors.primary + '20' }]}>
                <Text style={styles.cardIcon}>⚽</Text>
              </View>
              <Text style={[styles.cardTitle, { color: colors.text }]}>Spiele</Text>
            </View>
            <View style={styles.cardStats}>
              <Text style={[styles.cardStatNumber, { color: colors.primary }]}>{upcomingMatches}</Text>
              <Text style={[styles.cardStatLabel, { color: colors.textSecondary }]}>Anstehende Spiele</Text>
            </View>
            <View style={[styles.cardDivider, { backgroundColor: colors.border }]} />
            <Text style={[styles.cardAction, { color: colors.primary }]}>
              Alle Spiele anzeigen →
            </Text>
          </TouchableOpacity>

          {/* Beraterstatus-Tracker Karte */}
          <TouchableOpacity
            style={[
              styles.card,
              isWide && styles.cardWide,
              { backgroundColor: colors.cardBackground, borderColor: colors.cardBorder },
            ]}
            onPress={() => navigation.navigate('Beraterstatus')}
          >
            <View style={styles.cardHeader}>
              <View style={[styles.cardIconContainer, { backgroundColor: colors.warning + '20' }]}>
                <Text style={styles.cardIcon}>📋</Text>
              </View>
              <Text style={[styles.cardTitle, { color: colors.text }]}>Beraterstatus</Text>
            </View>
            {beraterData.stats ? (
              <View style={styles.cardStats}>
                <Text style={[styles.cardStatNumber, { color: colors.warning }]}>
                  {beraterData.stats.playersWithoutAgent}
                </Text>
                <Text style={[styles.cardStatLabel, { color: colors.textSecondary }]}>
                  Spieler ohne Berater
                </Text>
                {beraterData.stats.recentChanges > 0 && (
                  <Text style={[styles.cardStatLabel, { color: colors.textSecondary, marginTop: 4 }]}>
                    {beraterData.stats.recentChanges} Wechsel in den letzten 7 Tagen
                  </Text>
                )}
              </View>
            ) : (
              <View style={styles.cardStats}>
                <Text style={[styles.cardStatLabel, { color: colors.textSecondary }]}>
                  Lade Daten...
                </Text>
              </View>
            )}
            <View style={[styles.cardDivider, { backgroundColor: colors.border }]} />
            <Text style={[styles.cardAction, { color: colors.primary }]}>
              Alle anzeigen →
            </Text>
          </TouchableOpacity>

          {/* Watchlist Karte */}
          <TouchableOpacity
            style={[
              styles.card,
              isWide && styles.cardWide,
              { backgroundColor: colors.cardBackground, borderColor: colors.cardBorder },
            ]}
            onPress={() => navigation.navigate('Beraterstatus')}
          >
            <View style={styles.cardHeader}>
              <View style={[styles.cardIconContainer, { backgroundColor: colors.accent + '20' }]}>
                <Text style={styles.cardIcon}>⭐</Text>
              </View>
              <Text style={[styles.cardTitle, { color: colors.text }]}>Watchlist</Text>
            </View>
            <View style={styles.cardStats}>
              <Text style={[styles.cardStatNumber, { color: colors.accent }]}>{watchlist.length}</Text>
              <Text style={[styles.cardStatLabel, { color: colors.textSecondary }]}>Spieler auf der Watchlist</Text>
            </View>
            <View style={[styles.cardDivider, { backgroundColor: colors.border }]} />
            <Text style={[styles.cardAction, { color: colors.primary }]}>
              Watchlist anzeigen →
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
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
    justifyContent: 'space-between',
    padding: 20,
    borderBottomWidth: 1,
  },
  headerLeft: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
  },
  headerSubtitle: {
    fontSize: 14,
    marginTop: 4,
  },
  themeToggle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  themeIcon: {
    fontSize: 20,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
  },
  cardsContainer: {
    gap: 20,
  },
  cardsContainerWide: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    minHeight: 160,
  },
  cardWide: {
    flex: 1,
    minWidth: 300,
    maxWidth: 500,
  },
  cardLarge: {
    minHeight: 280,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  cardHeaderRight: {
    marginLeft: 'auto',
  },
  cardIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  cardIcon: {
    fontSize: 22,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  cardStats: {
    marginBottom: 16,
  },
  cardStatNumber: {
    fontSize: 36,
    fontWeight: '700',
  },
  cardStatLabel: {
    fontSize: 14,
    marginTop: 4,
  },
  cardDivider: {
    height: 1,
    marginVertical: 16,
  },
  cardAction: {
    fontSize: 14,
    fontWeight: '600',
  },
  watchlistCount: {
    fontSize: 14,
    fontWeight: '600',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 24,
  },
  emptyIcon: {
    fontSize: 40,
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
    maxWidth: 200,
  },
  playerList: {
    flex: 1,
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  playerInfo: {
    flex: 1,
  },
  playerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  playerName: {
    fontSize: 15,
    fontWeight: '600',
    flexShrink: 1,
  },
  playerAge: {
    fontSize: 13,
  },
  playerDetails: {
    fontSize: 13,
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  showMoreButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  showMoreText: {
    fontSize: 14,
    fontWeight: '500',
  },
});
