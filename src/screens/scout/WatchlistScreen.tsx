import React, { useState, useCallback, useMemo, useRef } from 'react';
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
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { RETRO, RETRO_THEME, HARD_SHADOW, HARD_SHADOW_LG, MONO } from '../../theme/retro';
import { RetroHeader } from '../../components/RetroHeader';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { ColumnDef } from '../../types/tableColumns';
import { useTableColumns } from '../../hooks/useTableColumns';
import { TableHeader } from '../../components/table/TableHeader';
import { TableRow } from '../../components/table/TableRow';
import {
  loadWatchlist,
  WatchlistEntry,
  BeraterPlayer,
  BeraterChange,
  PlayerEvaluation,
  removeFromWatchlist,
  loadPlayerHistory,
  loadAllEvaluations,
  loadPlayerEvaluation,
  savePlayerEvaluation,
  deletePlayerEvaluation,
  updateEvaluationNotes,
  updateEvaluationRating,
  updateWatchlistEntry,
  loadMatchEvaluationsForPlayer,
  MatchEvaluation,
  loadObservedPlayers,
  mergeObservedDuplicates,
  ObservedPlayer,
} from '../../services/beraterService';
import { savePlayerNotesText, fetchSearchPlayer, StipendiumSearchPlayer, positionCode, ageFromBirthDate, agentDisplayName } from '../../services/stipendiumService';
import { PlayerDetailModal } from '../../components/PlayerDetailModal';
import { RatingBar } from '../../components/evaluation/RatingBar';
import { fetchAgentInfo } from '../../services/transfermarktService';

const MATCH_EVAL_COLUMNS: ColumnDef[] = [
  { key: 'date', label: 'Datum', defaultFlex: 0.8, minWidth: 70 },
  { key: 'match', label: 'Beschreibung', defaultFlex: 2, minWidth: 120 },
  { key: 'agegroup', label: 'Jahrgang', defaultFlex: 0.6, minWidth: 50 },
];

const WATCHLIST_COLUMNS: ColumnDef[] = [
  { key: 'name', label: 'Name', defaultFlex: 1.7, minWidth: 120 },
  { key: 'mv', label: 'Marktwert', defaultFlex: 0.7, minWidth: 60 },
  { key: 'club', label: 'Verein', defaultFlex: 1.4, minWidth: 80 },
  { key: 'agent', label: 'Berater', defaultFlex: 1.5, minWidth: 80 },
  { key: 'rating', label: 'Pot.', defaultFlex: 0.4, minWidth: 34 },
  { key: 'added', label: 'Hinzugefügt', defaultFlex: 0.7, minWidth: 70 },
];

// Farbe wie im Potential-Schiebebalken (1-3 rot, 4-6 orange, 7-9 grün, 10 gold)
function potentialColor(v: number): string {
  if (v === 10) return '#F0C040';
  if (v >= 7) return '#22c55e';
  if (v >= 4) return '#e8930c';
  return '#dc2626';
}

export function WatchlistScreen() {
  const navigation = useNavigation();
  // Retro-Look (Anstoss-Optik): feste Palette statt Dark/Light-Theme
  const colors = RETRO_THEME;
  const { width } = useWindowDimensions();
  const isMobile = width < 768;

  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tableWidth, setTableWidth] = useState(0);
  const [detailTableWidth, setDetailTableWidth] = useState(0);

  const table = useTableColumns(WATCHLIST_COLUMNS, tableWidth);
  const matchEvalTable = useTableColumns(MATCH_EVAL_COLUMNS, detailTableWidth, 'watchlist_match_evals');

  // Sort
  type SortKey = 'name' | 'mv' | 'club' | 'agent' | 'added';
  const [sortKey, setSortKey] = useState<SortKey>('added');
  const [sortAsc, setSortAsc] = useState(false); // newest first by default

  // Detail modal
  const [selectedPlayer, setSelectedPlayer] = useState<BeraterPlayer | null>(null);
  const returnToPlayerRef = useRef<StipendiumSearchPlayer | null>(null);
  // Neues geteiltes Spielerprofil (wie Dashboard/Suchmaschine)
  const [detailPlayer, setDetailPlayer] = useState<StipendiumSearchPlayer | null>(null);
  const [playerHistory, setPlayerHistory] = useState<BeraterChange[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [matchEvaluations, setMatchEvaluations] = useState<MatchEvaluation[]>([]);

  // Evaluations
  const [evaluations, setEvaluations] = useState<Map<string, PlayerEvaluation>>(new Map());
  const [modalRating, setModalRating] = useState<number | null>(null);
  const [modalNotes, setModalNotes] = useState('');
  const [modalEvalStatus, setModalEvalStatus] = useState<'interessant' | 'nicht_interessant' | 'top_ziel' | null>(null);
  const notesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Tabs: Watchlist (Interessant-Shortlist) | Beobachtet (alle Spieler mit ≥1 Bericht)
  const [viewTab, setViewTab] = useState<'watchlist' | 'beobachtet'>('watchlist');
  const [observed, setObserved] = useState<ObservedPlayer[]>([]);

  const fetchData = useCallback(async () => {
    // Gescoutete Spieler mit später aufgetauchten TM-Datensätzen zusammenführen
    // (z.B. U15 gesichtet, ab U17 bei Transfermarkt gelistet)
    await mergeObservedDuplicates();
    const [data, evals, obs] = await Promise.all([
      loadWatchlist(),
      loadAllEvaluations(),
      loadObservedPlayers(),
    ]);
    setWatchlist(data);
    setEvaluations(evals);
    setObserved(obs);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchData();
      if (returnToPlayerRef.current) {
        const player = returnToPlayerRef.current;
        returnToPlayerRef.current = null;
        setTimeout(() => setDetailPlayer(player), 100);
      }
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
    if (player.current_agent_name === 'Familienangehörige') {
      return { text: 'Familienangehörige', color: colors.warning };
    }
    // gleiche Regel wie überall: Agentur vor Personenname
    const display = agentDisplayName(player.current_agent_name, player.current_agent_company);
    if (!display) return { text: 'kein Beratereintrag', color: colors.success };
    return { text: display, color: colors.textSecondary };
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
      // Top-Ziele ("sofort machen") stehen immer oben, egal wie sortiert wird
      const topA = evaluations.get(a.player_id || '')?.status === 'top_ziel' ? 0 : 1;
      const topB = evaluations.get(b.player_id || '')?.status === 'top_ziel' ? 0 : 1;
      if (topA !== topB) return topA - topB;

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
  }, [watchlist, sortKey, sortAsc, evaluations]);

  const sortIndicator = (key: SortKey) => sortKey === key ? (sortAsc ? ' \u25B2' : ' \u25BC') : '';

  // Modal handlers
  // Öffnet das geteilte Spielerprofil (PlayerDetailModal) — wie im Dashboard
  const openPlayerDetail = async (player: BeraterPlayer) => {
    const sp = await fetchSearchPlayer(player.tm_player_id || null, player.player_name);
    setDetailPlayer(
      sp || {
        id: player.id,
        player_name: player.player_name,
        birth_date: player.birth_date,
        age: ageFromBirthDate(player.birth_date),
        position: positionCode(player.position),
        current_agent_name: player.current_agent_name,
        current_agent_company: (player as any).current_agent_company ?? null,
        agent_url: (player as any).agent_url ?? null,
        tm_player_id: player.tm_player_id || null,
        tm_profile_url: player.tm_profile_url || null,
        market_value: (player as any).market_value ?? null,
        contract_until: (player as any).contract_until ?? null,
        is_vereinslos: !!(player as any).is_vereinslos,
        club_name: (player as any).club_name || null,
        club_tm_id: null,
        league_name: (player as any).league_name || null,
      }
    );
  };

  const handleRemoveFromWatchlist = async () => {
    if (!selectedPlayer) return;
    const success = await removeFromWatchlist(selectedPlayer.id);
    if (success) {
      setWatchlist(prev => prev.filter(w => w.player_id !== selectedPlayer.id));
      setSelectedPlayer(null);
    }
  };

  const handleEvaluation = async (status: 'interessant' | 'nicht_interessant') => {
    if (!selectedPlayer) return;
    if (modalEvalStatus === status) {
      // Toggle: gleicher Status nochmal → Bewertung entfernen
      const success = await deletePlayerEvaluation(selectedPlayer.id);
      if (success) {
        setEvaluations(prev => {
          const next = new Map(prev);
          next.delete(selectedPlayer.id);
          return next;
        });
        setModalEvalStatus(null);
      }
    } else {
      // Neuer Status setzen
      const success = await savePlayerEvaluation(selectedPlayer.id, status, modalRating, modalNotes || null);
      if (success) {
        setEvaluations(prev => {
          const next = new Map(prev);
          next.set(selectedPlayer.id, {
            id: '',
            player_id: selectedPlayer.id,
            status,
            rating: modalRating,
            notes: modalNotes || null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
          return next;
        });
        setModalEvalStatus(status);
      }
    }
  };

  const handleRatingChange = async (rating: number | null) => {
    setModalRating(rating);
    if (!selectedPlayer) return;
    const existing = evaluations.get(selectedPlayer.id);
    if (existing) {
      await updateEvaluationRating(selectedPlayer.id, rating);
      setEvaluations(prev => {
        const next = new Map(prev);
        next.set(selectedPlayer.id, { ...existing, rating, updated_at: new Date().toISOString() });
        return next;
      });
    } else {
      // Keine Evaluation → Rating in Watchlist-Tabelle speichern
      await updateWatchlistEntry(selectedPlayer.id, { rating });
      setWatchlist(prev => prev.map(w => w.player_id === selectedPlayer.id ? { ...w, rating } : w));
    }
  };

  const handleNotesChange = (text: string) => {
    setModalNotes(text);
    if (!selectedPlayer) return;
    if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
    notesTimerRef.current = setTimeout(async () => {
      // Profil-Notizen (player_notes) synchron halten
      savePlayerNotesText(selectedPlayer.id, text || null);
      const existing = evaluations.get(selectedPlayer.id);
      if (existing) {
        await updateEvaluationNotes(selectedPlayer.id, text || null);
        setEvaluations(prev => {
          const next = new Map(prev);
          next.set(selectedPlayer.id, { ...existing, notes: text || null, updated_at: new Date().toISOString() });
          return next;
        });
      } else {
        // Keine Evaluation → Notizen in Watchlist-Tabelle speichern
        await updateWatchlistEntry(selectedPlayer.id, { notes: text || null });
        setWatchlist(prev => prev.map(w => w.player_id === selectedPlayer.id ? { ...w, notes: text || null } : w));
      }
    }, 800);
  };

  const handleOpenProfile = () => {
    if (selectedPlayer?.tm_profile_url) {
      Linking.openURL(selectedPlayer.tm_profile_url);
    } else if (selectedPlayer?.player_name) {
      const query = encodeURIComponent(selectedPlayer.player_name);
      Linking.openURL(`https://www.transfermarkt.de/schnellsuche/ergebnis/schnellsuche?query=${query}`);
    }
  };

  // Evaluation color helper
  const getEvalColor = (playerId: string, isOnWatchlist: boolean): { bg: string; border: string } | null => {
    // Evaluation-Status hat Vorrang vor Watchlist-Farbe
    const ev = evaluations.get(playerId);
    if (ev?.status === 'interessant') return { bg: colors.success + '12', border: colors.success };
    if (ev?.status === 'nicht_interessant') return { bg: colors.error + '12', border: colors.error };
    if (isOnWatchlist) return { bg: colors.warning + '12', border: colors.warning };
    return null;
  };

  // Mobile card
  const renderMobileCard = ({ item }: { item: WatchlistEntry }) => {
    if (!item.player) return null;
    const player = item.player;
    const agentLabel = getAgentLabel(player);
    const age = calculateAge(player.birth_date);
    const addedDate = formatDateDE(item.added_at);
    const evalColor = getEvalColor(player.id, true); // Watchlist items are always on watchlist
    const ev = evaluations.get(player.id);
    const rating = ev?.rating ?? item.rating ?? null;
    const hasNotes = !!(ev?.notes || item.notes);

    return (
      <TouchableOpacity
        style={[
          styles.mobileCard,
          { backgroundColor: colors.surface },
          HARD_SHADOW,
        ]}
        onPress={() => openPlayerDetail(player)}
        activeOpacity={0.7}
      >
        <View style={styles.mobileCardHeader}>
          <View style={styles.mobileCardNameRow}>
            {ev?.status === 'top_ziel' && (
              <View style={styles.topZielBadge}>
                <Text style={styles.topZielBadgeText}>TOP-ZIEL</Text>
              </View>
            )}
            <Text style={[styles.mobileCardName, { color: colors.text }]} numberOfLines={1}>
              {formatNameLastFirst(player.player_name)}
            </Text>
            {age ? <Text style={[styles.mobileCardAge, { color: colors.textSecondary }]}>{age}</Text> : null}
            {rating != null && (
              <View style={[styles.ratingBadge, { backgroundColor: rating >= 7 ? colors.success + '25' : rating >= 4 ? '#f5a623' + '25' : colors.error + '25' }]}>
                <Text style={[styles.ratingBadgeText, { color: rating >= 7 ? colors.success : rating >= 4 ? '#f5a623' : colors.error }]}>{rating}</Text>
              </View>
            )}
            {hasNotes && <Ionicons name="chatbubble-outline" size={12} color={colors.textSecondary} style={{ marginLeft: 4 }} />}
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
    const evalColor = getEvalColor(player.id, true);
    const ev = evaluations.get(player.id);
    const rating = ev?.rating ?? item.rating ?? null;
    const hasNotes = !!(ev?.notes || item.notes);

    return (
      <TableRow
        columnOrder={table.columnOrder}
        getColumnWidth={table.getColumnWidth}
        onPress={() => openPlayerDetail(player)}
        style={[styles.playerRow, { borderBottomColor: RETRO.rowBorder }]}
        renderCell={(key) => {
          switch (key) {
            case 'name':
              return (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  {ev?.status === 'top_ziel' && (
                    <View style={styles.topZielBadge}>
                      <Text style={styles.topZielBadgeText}>TOP-ZIEL</Text>
                    </View>
                  )}
                  <Text style={[styles.playerColName, { color: RETRO.text }]} numberOfLines={1}>
                    {formatNameLastFirst(player.player_name)}
                  </Text>
                  {age ? <Text style={[styles.playerColAge, { color: colors.textSecondary }]}>{age}</Text> : null}
                </View>
              );
            case 'mv':
              return (
                <Text style={styles.monoCell} numberOfLines={1}>
                  {player.market_value || '–'}
                </Text>
              );
            case 'club':
              return (
                <Text style={[{ fontSize: 13, color: RETRO.text, fontStyle: player.is_vereinslos ? 'italic' : 'normal' }]} numberOfLines={1}>
                  {player.is_vereinslos ? `zuletzt: ${player.club_name || ''}` : (player.club_name || '')}
                </Text>
              );
            case 'agent':
              return (
                <Text style={[{ fontSize: 13, color: agentLabel.color }]} numberOfLines={1}>
                  {agentLabel.text}
                </Text>
              );
            case 'rating':
              return rating != null ? (
                <View style={[styles.potBadge, { backgroundColor: potentialColor(rating) }]}>
                  <Text style={styles.potBadgeText}>{rating}</Text>
                </View>
              ) : null;
            case 'added':
              return (
                <Text style={styles.monoCell} numberOfLines={1}>
                  {addedDate || '–'}
                </Text>
              );
            default:
              return null;
          }
        }}
      />
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
    const ratingOptions: (number | null)[] = [null, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

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
            style={[styles.detailSheet, { backgroundColor: colors.background, borderColor: colors.border }, !isMobile && styles.detailSheetDesktop]}
            onPress={() => {}}
          >
            {/* Top-Bar mit Close-Button */}
            <View style={styles.detailTopBar}>
              <View style={{ flex: 1 }} />
              <TouchableOpacity
                style={[styles.closeButton, { borderColor: colors.border }]}
                onPress={() => setSelectedPlayer(null)}
                activeOpacity={0.7}
              >
                <Text style={[styles.closeButtonText, { color: colors.textSecondary }]}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView bounces={false} showsVerticalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}>
              {/* Header Card */}
              <View style={[styles.detailHeaderCard, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
                <View style={styles.detailNameRow}>
                  <Text style={[styles.detailName, { color: colors.text }]} numberOfLines={1}>
                    {selectedPlayer.player_name}
                  </Text>
                  <View style={{ flex: 1 }} />
                  <TouchableOpacity onPress={handleOpenProfile} activeOpacity={0.7}>
                    <Image
                      source={require('../../../assets/transfermarkt-logo.png')}
                      style={styles.tmLogo}
                      resizeMode="contain"
                    />
                  </TouchableOpacity>
                </View>
                <Text style={{ fontSize: 13, color: colors.textSecondary, marginTop: -4 }}>
                  {[selectedPlayer.club_name, selectedPlayer.league_name].filter(Boolean).join(' · ')}
                </Text>
                <View style={[styles.detailInfoBar, { borderTopColor: colors.border }]}>
                  <View style={styles.detailInfoCell}>
                    <Text style={[styles.detailInfoLabel, styles.detailInfoLabelPos, { color: colors.textSecondary }]}>MARKTWERT</Text>
                    <View style={{ alignItems: 'center' }}>
                      <Text style={[styles.detailInfoValue, { color: colors.text, fontSize: isMobile ? 24 : 36 }]} numberOfLines={1}>
                        {selectedPlayer.market_value || '-'}
                      </Text>
                      <Text style={{ fontSize: isMobile ? 11 : 14, color: 'transparent', marginTop: 2 }}>{'\u00A0'}</Text>
                    </View>
                  </View>
                  <View style={[styles.detailInfoDivider, { backgroundColor: colors.border }]} />
                  <View style={styles.detailInfoCell}>
                    <Text style={[styles.detailInfoLabel, styles.detailInfoLabelPos, { color: colors.textSecondary }]}>ALTER</Text>
                    <View style={{ alignItems: 'center' }}>
                      <Text style={[styles.detailInfoValue, { color: colors.text, fontSize: isMobile ? 24 : 36 }]}>
                        {age || '-'}
                      </Text>
                      {selectedPlayer.birth_date ? (
                        <Text style={{ fontSize: isMobile ? 11 : 14, color: colors.textSecondary, marginTop: 2 }}>
                          {selectedPlayer.birth_date}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                  <View style={[styles.detailInfoDivider, { backgroundColor: colors.border }]} />
                  <View style={styles.detailInfoCell}>
                    <Text style={[styles.detailInfoLabel, styles.detailInfoLabelPos, { color: colors.textSecondary }]}>POTENTIAL</Text>
                    <RatingBar value={modalRating ?? 0} onChange={(v) => handleRatingChange(v || null)} compact compactSize={isMobile ? 36 : 52} />
                  </View>
                </View>
              </View>

              {/* Beraterstatus */}
              <View style={[styles.detailSection, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>BERATERSTATUS</Text>
                {historyLoading ? (
                  <ActivityIndicator size="small" color={colors.primary} style={{ marginTop: 8 }} />
                ) : (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.hTimeline}>
                    <View style={[styles.hTimelineCard, styles.hTimelineCardCurrent, { backgroundColor: agentLabel.color + '15', borderColor: agentLabel.color }]}>
                      <Text style={[styles.hTimelineAgent, { color: agentLabel.color }]} numberOfLines={2}>
                        {agentLabel.text}
                      </Text>
                      {selectedPlayer.current_agent_company && (() => {
                        const name = (selectedPlayer.current_agent_name || '').toLowerCase().replace(/[-\s]/g, '');
                        const company = selectedPlayer.current_agent_company.toLowerCase().replace(/[-\s]/g, '');
                        return !company.includes(name) && !name.includes(company);
                      })() && (
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
                      const phaseDuration = phaseStartDate ? formatDurationBetween(phaseStartDate, phaseEndDate) : null;
                      return (
                        <View key={change.id} style={[styles.hTimelineCard, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
                          <Text style={[styles.hTimelineAgent, { color: colors.text }]} numberOfLines={2}>{agentName}</Text>
                          {phaseDuration && <Text style={[styles.hTimelineDuration, { color: colors.textSecondary }]}>{phaseDuration}</Text>}
                          <Text style={[styles.hTimelineDate, { color: colors.textSecondary }]}>
                            {phaseStartDate ? formatDateDE(phaseStartDate) : '?'} – {formatDateDE(phaseEndDate)}
                          </Text>
                        </View>
                      );
                    })}
                  </ScrollView>
                )}
              </View>

              {/* Notizen */}
              <View style={[styles.detailSection, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>NOTIZEN</Text>
                <TextInput
                  style={[styles.notesInput, { color: colors.text, backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
                  value={modalNotes}
                  onChangeText={handleNotesChange}
                  placeholder="Notizen zum Spieler..."
                  placeholderTextColor={colors.textSecondary}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />
              </View>

              {/* Spielbewertungen */}
              <View
                style={[styles.detailSection, { backgroundColor: colors.surface, borderColor: colors.border }]}
                onLayout={(e) => setDetailTableWidth(e.nativeEvent.layout.width - 32)}
              >
                <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>SPIELBEWERTUNGEN</Text>
                {detailTableWidth > 0 && (
                  <TableHeader
                    columnDefs={MATCH_EVAL_COLUMNS}
                    columnOrder={matchEvalTable.columnOrder}
                    getColumnWidth={matchEvalTable.getColumnWidth}
                    onResizeStart={matchEvalTable.onResizeStart}
                    onDragStart={matchEvalTable.onDragStart}
                    resizingKey={matchEvalTable.resizingKey}
                    draggingKey={matchEvalTable.draggingKey}
                    dragOverKey={matchEvalTable.dragOverKey}
                    colors={colors}
                    setHeaderRef={matchEvalTable.setHeaderRef}
                  />
                )}
                {matchEvaluations.length === 0 ? (
                  <Text style={{ fontSize: 13, color: colors.textSecondary, paddingVertical: 8 }}>-</Text>
                ) : (
                  matchEvaluations.map((ev) => (
                    <TableRow
                      key={ev.id}
                      columnOrder={matchEvalTable.columnOrder}
                      getColumnWidth={matchEvalTable.getColumnWidth}
                      style={[styles.playerRow, { borderBottomColor: colors.border }]}
                      onPress={() => {
                        returnToPlayerRef.current = selectedPlayer as any;
                        setSelectedPlayer(null);
                        setTimeout(() => {
                          (navigation as any).navigate('PlayerEvaluation', {
                            matchId: ev.match_id,
                            matchName: ev.match_name,
                            matchDate: ev.match_date,
                            mannschaft: ev.age_group,
                            playerName: `${ev.last_name || ''}, ${ev.first_name || ''}`,
                            playerNumber: ev.jersey_number,
                            playerPosition: ev.positions?.split(', ')[0] || null,
                            playerBirthDate: ev.birth_date,
                            agentName: ev.agent_name,
                            transfermarktUrl: ev.transfermarkt_url,
                          });
                        }, 300);
                      }}
                      renderCell={(key) => {
                        switch (key) {
                          case 'date':
                            return <Text style={{ fontSize: 11, color: colors.textSecondary }} numberOfLines={1}>{ev.match_date || '-'}</Text>;
                          case 'match':
                            return <Text style={{ fontSize: 11, color: colors.text }} numberOfLines={1}>{ev.match_name || '-'}</Text>;
                          case 'agegroup':
                            return <Text style={{ fontSize: 11, color: colors.textSecondary }} numberOfLines={1}>{ev.age_group || '-'}</Text>;
                          default:
                            return null;
                        }
                      }}
                    />
                  ))
                )}
              </View>
            </ScrollView>

            {/* Eval-Buttons */}
            <View style={[styles.evalButtonRow, { borderTopColor: colors.border }]}>
              <TouchableOpacity
                style={[styles.evalButton, modalEvalStatus === 'nicht_interessant' ? { backgroundColor: colors.error } : { backgroundColor: colors.border }]}
                onPress={() => handleEvaluation('nicht_interessant')}
                activeOpacity={0.7}
              >
                <Text style={[styles.evalButtonText, { color: modalEvalStatus === 'nicht_interessant' ? '#fff' : colors.textSecondary }]}>Uninteressant</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.evalButton, modalEvalStatus === 'interessant' ? { backgroundColor: colors.success } : { backgroundColor: colors.border }]}
                onPress={() => handleEvaluation('interessant')}
                activeOpacity={0.7}
              >
                <Text style={[styles.evalButtonText, { color: modalEvalStatus === 'interessant' ? '#fff' : colors.textSecondary }]}>Interessant</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.evalButton, { backgroundColor: colors.warning }]}
                onPress={handleRemoveFromWatchlist}
                activeOpacity={0.7}
              >
                <Text style={[styles.evalButtonText, { color: '#fff' }]}>Von Watchlist entfernen</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header (gelber Titelbalken wie im Dashboard) */}
      <RetroHeader
        title={viewTab === 'beobachtet' ? 'Beobachtet' : 'Watchlist'}
        subtitle={viewTab === 'beobachtet' ? 'Alle gesichteten Spieler' : 'Markierte Spieler im Blick'}
        onBack={() => navigation.goBack()}
        right={
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity
              onPress={() => setViewTab('watchlist')}
              style={[styles.headerTab, HARD_SHADOW, viewTab === 'watchlist' && styles.headerTabActive]}
              activeOpacity={0.7}
            >
              <Text style={[styles.headerTabText, viewTab === 'watchlist' && styles.headerTabTextActive]}>
                {`Watchlist (${watchlist.length})`}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setViewTab('beobachtet')}
              style={[styles.headerTab, HARD_SHADOW, viewTab === 'beobachtet' && styles.headerTabActive]}
              activeOpacity={0.7}
            >
              <Text style={[styles.headerTabText, viewTab === 'beobachtet' && styles.headerTabTextActive]}>
                {`Beobachtet (${observed.length})`}
              </Text>
            </TouchableOpacity>
          </View>
        }
      />

      {/* List */}
      {viewTab === 'beobachtet' ? (
        <FlatList
          data={observed}
          keyExtractor={(item) => item.player.id}
          contentContainerStyle={observed.length === 0 && !loading ? styles.emptyContainer : { padding: 12 }}
          ListEmptyComponent={!loading ? (
            <View style={styles.emptyState}>
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Noch keine beobachteten Spieler</Text>
              <Text style={[styles.emptyHint, { color: colors.textSecondary }]}>
                Spieler erscheinen hier, sobald ein Spielbericht zu ihnen gespeichert wurde
              </Text>
            </View>
          ) : null}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => openPlayerDetail(item.player)}
              style={[{
                flexDirection: 'row', alignItems: 'center', gap: 10,
                backgroundColor: colors.surface,
                borderRadius: 2, paddingVertical: 10, paddingHorizontal: 14, marginBottom: 10,
              }, HARD_SHADOW]}
              activeOpacity={0.7}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }} numberOfLines={1}>
                  {item.player.player_name}
                </Text>
                <Text style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }} numberOfLines={1}>
                  {[item.player.club_name, item.player.birth_date, item.player.position].filter(Boolean).join(' · ') || '—'}
                </Text>
              </View>
              {item.lastRating != null && item.lastRating > 0 && (
                <Text style={{ fontSize: 13, fontWeight: '700', color: colors.primary }}>{item.lastRating}/10</Text>
              )}
              <View style={{ backgroundColor: '#2563eb', borderRadius: 10, minWidth: 26, paddingHorizontal: 6, paddingVertical: 3, alignItems: 'center' }}>
                <Text style={{ fontSize: 12, fontWeight: '800', color: '#fff' }}>{item.reportCount}×</Text>
              </View>
              <Text style={{ fontSize: 12, fontFamily: MONO, color: colors.textSecondary, minWidth: 70, textAlign: 'right' }}>
                {/* Datum kann ISO oder DD.MM.YYYY sein — einheitlich deutsch anzeigen */}
                {item.lastMatchDate && /^\d{4}-\d{2}-\d{2}/.test(item.lastMatchDate)
                  ? item.lastMatchDate.slice(0, 10).split('-').reverse().join('.')
                  : item.lastMatchDate || ''}
              </Text>
            </TouchableOpacity>
          )}
        />
      ) : isMobile ? (
        <FlatList
          data={sortedWatchlist}
          renderItem={renderMobileCard}
          keyExtractor={(item) => item.id}
          extraData={[evaluations, watchlist]}
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
        <View
          style={[styles.listCard, { backgroundColor: colors.surface }, HARD_SHADOW]}
          onLayout={(e) => setTableWidth(e.nativeEvent.layout.width)}
        >
          {watchlist.length > 0 && tableWidth > 0 && (
            <TableHeader
              columnDefs={WATCHLIST_COLUMNS}
              columnOrder={table.columnOrder}
              getColumnWidth={table.getColumnWidth}
              onResizeStart={table.onResizeStart}
              onDragStart={table.onDragStart}
              resizingKey={table.resizingKey}
              draggingKey={table.draggingKey}
              dragOverKey={table.dragOverKey}
              onSort={(key) => toggleSort(key as SortKey)}
              sortKey={sortKey}
              sortAsc={sortAsc}
              colors={colors}
              setHeaderRef={table.setHeaderRef}
            />
          )}
          <FlatList
            data={sortedWatchlist}
            renderItem={renderDesktopRow}
            keyExtractor={(item) => item.id}
            extraData={[evaluations, watchlist]}
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
      {detailPlayer && (
        <PlayerDetailModal
          player={detailPlayer}
          onClose={() => setDetailPlayer(null)}
          onStatusChanged={() => fetchData()}
          onOpenEvaluation={(ev) => {
            returnToPlayerRef.current = detailPlayer;
            setDetailPlayer(null);
            (navigation as any).navigate('PlayerEvaluation', {
              matchId: ev.match_id,
              matchName: ev.match_name,
              matchDate: ev.match_date,
              mannschaft: ev.age_group,
              playerName: `${ev.last_name || ''}, ${ev.first_name || ''}`,
              playerNumber: ev.jersey_number,
              playerPosition: ev.positions?.split(', ')[0] || null,
              playerBirthDate: ev.birth_date,
              agentName: ev.agent_name,
              transfermarktUrl: ev.transfermarkt_url,
              beraterPlayerId: detailPlayer.id,
            });
          }}
        />
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
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  headerTab: {
    backgroundColor: '#ffffff',
    borderRadius: 2,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  headerTabActive: {
    backgroundColor: RETRO.text,
  },
  headerTabText: {
    fontSize: 12,
    fontWeight: '700' as const,
    fontFamily: MONO,
    color: RETRO.text,
  },
  headerTabTextActive: {
    color: RETRO.yellow,
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
  // weiße Retro-Karte: randlos, nur harter Schatten
  listCard: {
    flex: 1,
    margin: 12,
    borderRadius: 2,
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
    borderRadius: 2,
    padding: 14,
    marginBottom: 10,
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
    paddingVertical: 8,
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
    fontSize: 13,
    fontWeight: '700',
    flexShrink: 1,
  },
  monoCell: {
    fontSize: 12,
    fontFamily: MONO,
    color: RETRO.text,
  },
  potBadge: {
    minWidth: 26,
    height: 22,
    paddingHorizontal: 5,
    borderRadius: 2,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  potBadgeText: {
    fontSize: 13,
    fontWeight: '800' as const,
    color: '#ffffff',
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
    flex: 1.5,
    fontSize: 11,
  },
  playerColAdded: {
    flex: 0.7,
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
    paddingBottom: 0,
    maxHeight: '92%',
    minWidth: '100%',
    borderWidth: 1,
    overflow: 'hidden',
  },
  detailSheetDesktop: {
    borderRadius: 16,
    minWidth: 0,
    width: '95%',
    maxWidth: 1200,
    maxHeight: '92%',
  },
  detailTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  detailHeaderCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  detailNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  detailName: {
    fontSize: 20,
    fontWeight: '700',
    flexShrink: 1,
  },
  tmLogo: {
    height: 26,
    width: 65,
  },
  detailInfoBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingTop: 6,
    marginTop: 4,
  },
  detailInfoCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 20,
    paddingBottom: 8,
    paddingHorizontal: 6,
  },
  detailInfoLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  detailInfoLabelPos: {
    position: 'absolute',
    top: 0,
    left: 6,
  },
  detailInfoValue: {
    fontWeight: '700',
  },
  detailInfoDivider: {
    width: 1,
    alignSelf: 'stretch',
  },
  detailSection: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 12,
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

  // Rating
  ratingRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  ratingButton: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ratingButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },

  // Notizen
  notesInput: {
    marginTop: 8,
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    minHeight: 80,
  },

  // Tinder-Buttons
  evalButtonRow: {
    flexDirection: 'row',
    gap: 6,
    paddingTop: 12,
    paddingBottom: 16,
    borderTopWidth: 1,
    alignItems: 'center',
  },
  evalButton: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  evalButtonText: {
    fontSize: 11,
    fontWeight: '600',
  },
  ratingBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginLeft: 6,
  },
  // "Sofort machen"-Markierung (goldenes Badge vor dem Namen)
  topZielBadge: {
    backgroundColor: '#F0C040',
    borderRadius: 2,
    paddingHorizontal: 5,
    paddingVertical: 1,
    marginRight: 2,
  },
  topZielBadgeText: {
    fontSize: 9,
    fontWeight: '800' as const,
    letterSpacing: 0.5,
    color: '#14141e',
  },
  ratingBadgeText: {
    fontSize: 10,
    fontWeight: '700' as const,
  },
  playerColRating: {
    flex: 0.5,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  playerColNotes: {
    flex: 0.3,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
});
