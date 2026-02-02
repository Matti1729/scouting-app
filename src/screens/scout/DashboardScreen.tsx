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
import { RootStackParamList } from '../../navigation/types';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadScanStatus, BeraterStats, ScanState } from '../../services/beraterService';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

interface InterestingPlayer {
  id: string;
  name: string;
  team: string;
  position: string;
  birthYear: string;
  addedAt: string;
  notes?: string;
  status: 'neu' | 'beobachten' | 'kontaktiert' | 'abgelehnt';
}

interface AgentStatus {
  id: string;
  playerName: string;
  agentName: string;
  status: 'offen' | 'in_kontakt' | 'verhandlung' | 'abgeschlossen';
  lastContact?: string;
  notes?: string;
}

interface BeraterDashboardData {
  stats: BeraterStats | null;
  scanState: ScanState | null;
}

export function DashboardScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { colors, isDark, toggleTheme } = useTheme();
  const { width } = useWindowDimensions();
  const isWide = width > 900;

  const [upcomingMatches, setUpcomingMatches] = useState(0);
  const [interestingPlayers, setInterestingPlayers] = useState<InterestingPlayer[]>([]);
  const [agentStatuses, setAgentStatuses] = useState<AgentStatus[]>([]);
  const [beraterData, setBeraterData] = useState<BeraterDashboardData>({ stats: null, scanState: null });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    // Lade Spiele-Count
    try {
      const matchesData = await AsyncStorage.getItem('scouting_matches');
      if (matchesData) {
        const matches = JSON.parse(matchesData);
        const upcoming = matches.filter((m: any) => !m.isArchived).length;
        setUpcomingMatches(upcoming);
      }
    } catch (e) {
      console.error('Error loading matches:', e);
    }

    // Lade interessante Spieler
    try {
      const playersData = await AsyncStorage.getItem('interesting_players');
      if (playersData) {
        setInterestingPlayers(JSON.parse(playersData));
      }
    } catch (e) {
      console.error('Error loading players:', e);
    }

    // Lade Beraterstatus
    try {
      const statusData = await AsyncStorage.getItem('agent_statuses');
      if (statusData) {
        setAgentStatuses(JSON.parse(statusData));
      }
    } catch (e) {
      console.error('Error loading agent statuses:', e);
    }

    // Lade Beraterstatus-Tracker Daten von Supabase
    try {
      const result = await loadScanStatus();
      setBeraterData({ stats: result.stats, scanState: result.scanState });
    } catch (e) {
      console.error('Error loading berater status:', e);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'neu': return colors.accent;
      case 'beobachten': return colors.warning;
      case 'kontaktiert': return colors.primary;
      case 'abgelehnt': return colors.error;
      case 'offen': return colors.textSecondary;
      case 'in_kontakt': return colors.warning;
      case 'verhandlung': return colors.accent;
      case 'abgeschlossen': return colors.success;
      default: return colors.textSecondary;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'neu': return 'Neu';
      case 'beobachten': return 'Beobachten';
      case 'kontaktiert': return 'Kontaktiert';
      case 'abgelehnt': return 'Abgelehnt';
      case 'offen': return 'Offen';
      case 'in_kontakt': return 'In Kontakt';
      case 'verhandlung': return 'Verhandlung';
      case 'abgeschlossen': return 'Abgeschlossen';
      default: return status;
    }
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
        <TouchableOpacity
          style={[styles.themeToggle, { backgroundColor: colors.surfaceSecondary }]}
          onPress={toggleTheme}
        >
          <Text style={styles.themeIcon}>{isDark ? '☀️' : '🌙'}</Text>
        </TouchableOpacity>
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

          {/* Interessante Spieler Karte */}
          <View
            style={[
              styles.card,
              styles.cardLarge,
              isWide && styles.cardWide,
              { backgroundColor: colors.cardBackground, borderColor: colors.cardBorder },
            ]}
          >
            <View style={styles.cardHeader}>
              <View style={[styles.cardIconContainer, { backgroundColor: colors.accent + '20' }]}>
                <Text style={styles.cardIcon}>⭐</Text>
              </View>
              <Text style={[styles.cardTitle, { color: colors.text }]}>Interessante Spieler</Text>
              <View style={styles.cardHeaderRight}>
                <TouchableOpacity
                  style={[styles.addButton, { backgroundColor: colors.primary }]}
                  onPress={() => {
                    // TODO: Modal zum Hinzufügen öffnen
                  }}
                >
                  <Text style={[styles.addButtonText, { color: colors.primaryText }]}>+</Text>
                </TouchableOpacity>
              </View>
            </View>

            {interestingPlayers.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={[styles.emptyIcon]}>👀</Text>
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                  Noch keine Spieler markiert
                </Text>
                <Text style={[styles.emptyHint, { color: colors.textSecondary }]}>
                  Markiere interessante Spieler während der Spielbeobachtung
                </Text>
              </View>
            ) : (
              <View style={styles.playerList}>
                {interestingPlayers.slice(0, 5).map((player) => (
                  <View
                    key={player.id}
                    style={[styles.playerRow, { borderBottomColor: colors.border }]}
                  >
                    <View style={styles.playerInfo}>
                      <Text style={[styles.playerName, { color: colors.text }]}>{player.name}</Text>
                      <Text style={[styles.playerDetails, { color: colors.textSecondary }]}>
                        {player.team} · {player.position} · {player.birthYear}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.statusBadge,
                        { backgroundColor: getStatusColor(player.status) + '20' },
                      ]}
                    >
                      <Text style={[styles.statusText, { color: getStatusColor(player.status) }]}>
                        {getStatusLabel(player.status)}
                      </Text>
                    </View>
                  </View>
                ))}
                {interestingPlayers.length > 5 && (
                  <TouchableOpacity style={styles.showMoreButton}>
                    <Text style={[styles.showMoreText, { color: colors.primary }]}>
                      +{interestingPlayers.length - 5} weitere anzeigen
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>

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
  addButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addButtonText: {
    fontSize: 20,
    fontWeight: '600',
    marginTop: -2,
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
  playerName: {
    fontSize: 15,
    fontWeight: '600',
  },
  playerDetails: {
    fontSize: 13,
    marginTop: 2,
  },
  statusList: {
    flex: 1,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  statusInfo: {
    flex: 1,
  },
  statusPlayerName: {
    fontSize: 15,
    fontWeight: '600',
  },
  statusAgentName: {
    fontSize: 13,
    marginTop: 2,
  },
  statusDate: {
    fontSize: 12,
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
