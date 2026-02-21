import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  RefreshControl,
  useWindowDimensions,
  Linking,
  Modal,
  ScrollView,
  ActivityIndicator,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import {
  loadWatchlist,
  WatchlistEntry,
  BeraterPlayer,
  BeraterChange,
  removeFromWatchlist,
  loadPlayerHistory,
} from '../../services/beraterService';

export function WatchlistScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const isMobile = width < 768;

  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Sort
  type SortKey = 'name' | 'mv' | 'club' | 'agent' | 'added';
  const [sortKey, setSortKey] = useState<SortKey>('added');
  const [sortAsc, setSortAsc] = useState(false); // newest first by default

  // Detail modal
  const [selectedPlayer, setSelectedPlayer] = useState<BeraterPlayer | null>(null);
  const [playerHistory, setPlayerHistory] = useState<BeraterChange[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

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

  // Helpers
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

  const formatDateDE = (dateStr: string | null): string | null => {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  };

  const formatDurationBetween = (fromDate: string, toDate: string): string => {
    const from = new Date(fromDate);
    const to = new Date(toDate);
    const diffMs = to.getTime() - from.getTime();
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffDays < 1) return '< 1 Tag';
    if (diffDays < 7) return `${diffDays} ${diffDays === 1 ? 'Tag' : 'Tage'}`;
    if (diffDays < 30) {
      const weeks = Math.floor(diffDays / 7);
      return `${weeks} ${weeks === 1 ? 'Woche' : 'Wochen'}`;
    }
    if (diffDays < 365) {
      const months = Math.floor(diffDays / 30);
      return `${months} ${months === 1 ? 'Monat' : 'Monate'}`;
    }
    const years = Math.floor(diffDays / 365);
    const remainingMonths = Math.floor((diffDays % 365) / 30);
    if (remainingMonths > 0) {
      return `${years} J. ${remainingMonths} Mon.`;
    }
    return `${years} ${years === 1 ? 'Jahr' : 'Jahre'}`;
  };

  const parseMvNumber = (mv: string): number => {
    if (!mv) return 0;
    const clean = mv.replace(/[^\d.,]/g, ' ').trim();
    const num = parseFloat(clean.replace(',', '.'));
    if (isNaN(num)) return 0;
    if (mv.includes('Mrd')) return num * 1000000000;
    if (mv.includes('Mio')) return num * 1000000;
    if (mv.includes('Tsd')) return num * 1000;
    return num;
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(key === 'name' || key === 'club' || key === 'agent'); // alphabetisch aufsteigend, Datum/MW absteigend
    }
  };

  const sortedWatchlist = useMemo(() => {
    return [...watchlist].sort((a, b) => {
      const dir = sortAsc ? 1 : -1;
      const pA = a.player;
      const pB = b.player;
      if (!pA || !pB) return 0;

      switch (sortKey) {
        case 'name':
          return dir * formatNameLastFirst(pA.player_name).localeCompare(formatNameLastFirst(pB.player_name));
        case 'mv':
          return dir * (parseMvNumber(pA.market_value || '') - parseMvNumber(pB.market_value || ''));
        case 'club':
          return dir * (pA.club_name || '').localeCompare(pB.club_name || '');
        case 'agent':
          return dir * (pA.current_agent_name || '').localeCompare(pB.current_agent_name || '');
        case 'added':
          return dir * (new Date(a.added_at).getTime() - new Date(b.added_at).getTime());
        default:
          return 0;
      }
    });
  }, [watchlist, sortKey, sortAsc]);

  const sortIndicator = (key: SortKey) => sortKey === key ? (sortAsc ? ' \u25B2' : ' \u25BC') : '';

  // Modal handlers
  const openPlayerDetail = async (player: BeraterPlayer) => {
    setSelectedPlayer(player);
    setPlayerHistory([]);
    setHistoryLoading(true);

    const history = await loadPlayerHistory(player.id);
    setPlayerHistory(history);
    setHistoryLoading(false);
  };

  const handleRemoveFromWatchlist = async () => {
    if (!selectedPlayer) return;
    const success = await removeFromWatchlist(selectedPlayer.id);
    if (success) {
      setWatchlist(prev => prev.filter(w => w.player_id !== selectedPlayer.id));
      setSelectedPlayer(null);
    }
  };

  const handleOpenProfile = () => {
    if (selectedPlayer?.tm_profile_url) {
      Linking.openURL(selectedPlayer.tm_profile_url);
    } else if (selectedPlayer?.player_name) {
      const query = encodeURIComponent(selectedPlayer.player_name);
      Linking.openURL(`https://www.transfermarkt.de/schnellsuche/ergebnis/schnellsuche?query=${query}`);
    }
  };

  // Mobile card
  const renderMobileCard = ({ item }: { item: WatchlistEntry }) => {
    if (!item.player) return null;
    const player = item.player;
    const agentLabel = getAgentLabel(player);
    const age = calculateAge(player.birth_date);
    const addedDate = formatDateDE(item.added_at);

    return (
      <TouchableOpacity
        style={[styles.mobileCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => openPlayerDetail(player)}
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
        {addedDate && (
          <Text style={[styles.mobileCardAdded, { color: colors.textSecondary }]}>
            Hinzugefügt am {addedDate}
          </Text>
        )}
      </TouchableOpacity>
    );
  };

  // Desktop row
  const renderDesktopRow = ({ item }: { item: WatchlistEntry }) => {
    if (!item.player) return null;
    const player = item.player;
    const agentLabel = getAgentLabel(player);
    const age = calculateAge(player.birth_date);
    const addedDate = formatDateDE(item.added_at);

    return (
      <TouchableOpacity
        style={[styles.playerRow, { borderBottomColor: colors.border }]}
        onPress={() => openPlayerDetail(player)}
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
          <Text style={[styles.playerColAdded, { color: colors.textSecondary }]} numberOfLines={1}>
            {addedDate || '-'}
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

  // Detail modal (identical to BeraterstatusScreen)
  const renderDetailSheet = () => {
    if (!selectedPlayer) return null;
    const agentLabel = getAgentLabel(selectedPlayer);
    const age = calculateAge(selectedPlayer.birth_date);
    const sinceDate = formatDateDE(selectedPlayer.agent_since);

    return (
      <Modal
        visible={!!selectedPlayer}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedPlayer(null)}
      >
        <TouchableOpacity
          style={[styles.modalOverlay, !isMobile && styles.modalOverlayDesktop]}
          activeOpacity={1}
          onPress={() => setSelectedPlayer(null)}
        >
          <TouchableOpacity
            activeOpacity={1}
            style={[styles.detailSheet, { backgroundColor: colors.surface }, !isMobile && styles.detailSheetDesktop]}
            onPress={() => {}}
          >
            <TouchableOpacity
              style={[styles.closeButton, { borderColor: colors.border }]}
              onPress={() => setSelectedPlayer(null)}
              activeOpacity={0.7}
            >
              <Text style={[styles.closeButtonText, { color: colors.textSecondary }]}>✕</Text>
            </TouchableOpacity>

            <ScrollView bounces={false} showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }}>
              <View style={styles.detailTopRow}>
                <View style={{ flex: 1, marginRight: 12 }}>
                  <Text style={[styles.detailName, { color: colors.text }]}>
                    {selectedPlayer.player_name}{'  '}
                    <Text style={[styles.detailNameMeta, { color: colors.textSecondary }]}>
                      {[selectedPlayer.birth_date, age ? `(${age})` : null].filter(Boolean).join(' ')}
                    </Text>
                  </Text>
                  <Text style={[styles.detailSub, { color: colors.textSecondary }]}>
                    {[selectedPlayer.club_name, selectedPlayer.league_name].filter(Boolean).join(' · ')}
                  </Text>
                  {selectedPlayer.market_value ? (
                    <Text style={[styles.detailSub, { color: colors.text, fontSize: 18, fontWeight: '600' }]}>
                      {selectedPlayer.market_value}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.detailButtonsCol}>
                  <TouchableOpacity onPress={handleOpenProfile} activeOpacity={0.7}>
                    <Image
                      source={require('../../../assets/transfermarkt-logo.png')}
                      style={styles.tmLogo}
                      resizeMode="contain"
                    />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.watchlistMini,
                      {
                        backgroundColor: colors.error + '15',
                        borderColor: colors.error,
                      },
                    ]}
                    onPress={handleRemoveFromWatchlist}
                  >
                    <Text style={[styles.watchlistMiniText, { color: colors.error }]}>
                      Von Watchlist entfernen
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Beraterstatus Timeline */}
              <View style={[styles.detailSection, { borderColor: colors.border }]}>
                <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Beraterstatus</Text>

                {historyLoading ? (
                  <ActivityIndicator size="small" color={colors.primary} style={{ marginTop: 8 }} />
                ) : (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.hTimeline}>
                    <View style={[styles.hTimelineCard, styles.hTimelineCardCurrent, { backgroundColor: agentLabel.color + '15', borderColor: agentLabel.color }]}>
                      <Text style={[styles.hTimelineAgent, { color: agentLabel.color }]} numberOfLines={2}>
                        {agentLabel.text}
                      </Text>
                      {selectedPlayer.current_agent_company && selectedPlayer.current_agent_company !== selectedPlayer.current_agent_name && (
                        <Text style={[styles.hTimelineCompany, { color: colors.textSecondary }]} numberOfLines={1}>
                          {selectedPlayer.current_agent_company}
                        </Text>
                      )}
                      <Text style={[styles.hTimelineDuration, { color: colors.textSecondary }]}>
                        {sinceDate ? `seit ${sinceDate}` : 'aktuell'}
                      </Text>
                    </View>

                    {playerHistory.map((change, index) => {
                      const agentName = change.previous_agent_name || 'kein Berater';
                      const phaseEndDate = change.detected_at;
                      const phaseStartDate = playerHistory[index + 1]?.detected_at || null;
                      const phaseDuration = phaseStartDate
                        ? formatDurationBetween(phaseStartDate, phaseEndDate)
                        : null;

                      return (
                        <View key={change.id} style={[styles.hTimelineCard, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
                          <Text style={[styles.hTimelineAgent, { color: colors.text }]} numberOfLines={2}>
                            {agentName}
                          </Text>
                          {phaseDuration && (
                            <Text style={[styles.hTimelineDuration, { color: colors.textSecondary }]}>
                              {phaseDuration}
                            </Text>
                          )}
                          <Text style={[styles.hTimelineDate, { color: colors.textSecondary }]}>
                            {phaseStartDate ? formatDateDE(phaseStartDate) : '?'} – {formatDateDE(phaseEndDate)}
                          </Text>
                        </View>
                      );
                    })}
                  </ScrollView>
                )}
              </View>
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    );
  };

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
          data={sortedWatchlist}
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
          {watchlist.length > 0 && (
            <View style={[styles.desktopHeader, { borderBottomColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
              <View style={styles.playerRowColumns}>
                <TouchableOpacity style={styles.playerColNameWrap} onPress={() => toggleSort('name')}>
                  <Text style={[styles.desktopHeaderText, { color: sortKey === 'name' ? colors.primary : colors.text }]}>
                    Name{sortIndicator('name')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={{ flex: 1 }} onPress={() => toggleSort('mv')}>
                  <Text style={[styles.desktopHeaderText, { color: sortKey === 'mv' ? colors.primary : colors.text }]}>
                    Marktwert{sortIndicator('mv')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={{ flex: 1.5 }} onPress={() => toggleSort('club')}>
                  <Text style={[styles.desktopHeaderText, { color: sortKey === 'club' ? colors.primary : colors.text }]}>
                    Verein{sortIndicator('club')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={{ flex: 2 }} onPress={() => toggleSort('agent')}>
                  <Text style={[styles.desktopHeaderText, { color: sortKey === 'agent' ? colors.primary : colors.text }]}>
                    Berater{sortIndicator('agent')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={{ flex: 1 }} onPress={() => toggleSort('added')}>
                  <Text style={[styles.desktopHeaderText, { color: sortKey === 'added' ? colors.primary : colors.text }]}>
                    Hinzugefügt{sortIndicator('added')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          <FlatList
            data={sortedWatchlist}
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

      {/* Detail Modal */}
      {renderDetailSheet()}
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

  // Desktop header row
  desktopHeader: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  desktopHeaderText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },

  // Mobile card
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
  },
  mobileCardAdded: {
    fontSize: 11,
    marginTop: 6,
  },

  // Desktop row
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
  playerColAdded: {
    flex: 1,
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

  // Detail Sheet (Modal)
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalOverlayDesktop: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  detailSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingTop: 50,
    paddingBottom: 8,
    maxHeight: '85%',
    minWidth: '100%',
  },
  detailSheetDesktop: {
    borderRadius: 16,
    minWidth: 0,
    width: 480,
    maxHeight: '80%',
  },
  closeButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 1,
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: {
    fontSize: 16,
    fontWeight: '400',
  },
  detailTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  detailButtonsCol: {
    alignItems: 'flex-end',
    gap: 8,
  },
  detailName: {
    fontSize: 20,
    fontWeight: '700',
  },
  detailNameMeta: {
    fontSize: 13,
    fontWeight: '400',
  },
  tmLogo: {
    height: 26,
    width: 65,
  },
  detailSub: {
    fontSize: 14,
    marginTop: 4,
  },
  detailSection: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    flex: 1,
    justifyContent: 'center',
  },
  detailLabel: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  watchlistMini: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
  },
  watchlistMiniText: {
    fontSize: 12,
    fontWeight: '600',
  },

  // Horizontal Timeline
  hTimeline: {
    marginTop: 12,
  },
  hTimelineCard: {
    width: 120,
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    marginRight: 8,
  },
  hTimelineCardCurrent: {
    borderWidth: 2,
  },
  hTimelineAgent: {
    fontSize: 13,
    fontWeight: '600',
  },
  hTimelineCompany: {
    fontSize: 10,
    marginTop: 2,
  },
  hTimelineDuration: {
    fontSize: 10,
    marginTop: 2,
  },
  hTimelineDate: {
    fontSize: 10,
    marginTop: 2,
    fontStyle: 'italic',
  },
});
