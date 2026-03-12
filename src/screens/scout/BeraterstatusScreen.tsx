import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  SectionList,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Modal,
  TextInput,
  RefreshControl,
  ScrollView,
  Dimensions,
  Image,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import {
  BeraterPlayer,
  BeraterChange,
  WatchlistEntry,
  ScanState,
  BeraterStats,
  AgentFilter,
  AgeFilter,
  PlayerStat,
  PlayerEvaluation,
  loadAllPlayers,
  loadAgentChanges,
  loadWatchlist,
  loadScanStatus,
  loadLeagues,
  loadPlayerHistory,
  addToWatchlist,
  removeFromWatchlist,
  isOnWatchlist,
  getYouthYears,
  loadSuggestedPlayers,
  loadRankingsStats,
  refreshPlayerRankings,
  addStatPlayerToWatchlist,
  loadAllEvaluations,
  savePlayerEvaluation,
  deletePlayerEvaluation,
  updateEvaluationNotes,
  updateEvaluationRating,
  updateWatchlistEntry,
} from '../../services/beraterService';

function fuzzyMatch(query: string, ...fields: (string | null | undefined)[]): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return true;
  const combined = fields.map(f => (f || '').toLowerCase()).join(' ');
  return words.every(word => combined.includes(word));
}

type TabKey = 'alle_spieler' | 'beraterwechsel' | 'vorschlaege';
type PlayerListItem =
  | { type: 'club_header'; clubName: string; count: number }
  | { type: 'player'; player: BeraterPlayer };

export function BeraterstatusScreen() {
  const navigation = useNavigation();
  const { colors, isDark } = useTheme();
  const { width } = useWindowDimensions();
  const isMobile = width < 768;

  // State
  const [activeTab, setActiveTab] = useState<TabKey>('alle_spieler');
  const [scanState, setScanState] = useState<ScanState | null>(null);
  const [stats, setStats] = useState<BeraterStats | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Filters (Tab "Alle Spieler")
  const [leagues, setLeagues] = useState<Array<{ id: string; name: string; is_active: boolean }>>([]);
  const [selectedLeagues, setSelectedLeagues] = useState<string[]>([]);
  const [agentFilter, setAgentFilter] = useState<AgentFilter>('all');
  const [selectedAges, setSelectedAges] = useState<string[]>([]);
  const [showLeaguePicker, setShowLeaguePicker] = useState(false);
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const [showAgePicker, setShowAgePicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedSections, setCollapsedSections] = useState<Set<string> | null>(null);
  const [expandedClubs, setExpandedClubs] = useState<Set<string>>(new Set());
  const [dropdownPos, setDropdownPos] = useState<{ x?: number; right?: number; y: number; width: number } | null>(null);

  // Refs für Dropdown-Positionierung
  const leagueChipRef = useRef<View>(null);
  const agentChipRef = useRef<View>(null);
  const ageChipRef = useRef<View>(null);

  // Tab data
  const [players, setPlayers] = useState<BeraterPlayer[]>([]);
  const [playersTotal, setPlayersTotal] = useState(0);
  const [playersLoading, setPlayersLoading] = useState(false);
  const [changes, setChanges] = useState<BeraterChange[]>([]);
  const [changesTotal, setChangesTotal] = useState(0);
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);

  // Vorschläge (Spieler mit Top-Statistiken)
  const [suggestedPlayers, setSuggestedPlayers] = useState<PlayerStat[]>([]);
  const [suggestionsStatType, setSuggestionsStatType] = useState<'goals' | 'assists'>('goals');
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [rankingsRefreshing, setRankingsRefreshing] = useState(false);
  const [rankingsLastUpdate, setRankingsLastUpdate] = useState<string | null>(null);
  const [collapsedSuggestionSections, setCollapsedSuggestionSections] = useState<Set<string> | null>(null);

  // Beraterwechsel sort
  type ChangeSortKey = 'default' | 'name' | 'mv' | 'club' | 'prev_agent' | 'new_agent' | 'date';
  const [changeSortKey, setChangeSortKey] = useState<ChangeSortKey>('default');
  const [changeSortAsc, setChangeSortAsc] = useState(true);

  const toggleChangeSort = (key: ChangeSortKey) => {
    if (changeSortKey === key) {
      setChangeSortAsc(!changeSortAsc);
    } else {
      setChangeSortKey(key);
      setChangeSortAsc(true);
    }
  };

  // Detail sheet
  const [selectedPlayer, setSelectedPlayer] = useState<BeraterPlayer | null>(null);
  const [playerHistory, setPlayerHistory] = useState<BeraterChange[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [isOnWatchlistState, setIsOnWatchlistState] = useState(false);

  // Evaluations
  const [evaluations, setEvaluations] = useState<Map<string, PlayerEvaluation>>(new Map());
  const [modalRating, setModalRating] = useState<number | null>(null);
  const [modalNotes, setModalNotes] = useState('');
  const [modalEvalStatus, setModalEvalStatus] = useState<'interessant' | 'nicht_interessant' | null>(null);
  const notesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ========== DATA LOADING ==========

  const loadStatus = useCallback(async () => {
    try {
      const result = await loadScanStatus();
      setScanState(result.scanState);
      setStats(result.stats);
    } catch (e) {
      console.error('Error loading scan status:', e);
    }
  }, []);

  const loadLeagueList = useCallback(async () => {
    try {
      const result = await loadLeagues();
      setLeagues(result);
    } catch (e) {
      console.error('Error loading leagues:', e);
    }
  }, []);

  const loadPlayersTab = useCallback(async () => {
    setPlayersLoading(true);
    try {
      // Resolve league names → IDs (für U19/U17 mit mehreren Gruppen)
      const vereinslosSelected = selectedLeagues.includes('Vereinslos');
      const realLeagueNames = selectedLeagues.filter(l => l !== 'Vereinslos');

      let leagueIds = realLeagueNames.length > 0
        ? leagues.filter(l => realLeagueNames.includes(l.name)).map(l => l.id)
        : undefined;

      // Vereinslose Spieler haben league_id ihrer letzten Liga (L1/L2/L3)
      // → diese IDs auch laden wenn "Vereinslos" ausgewählt ist
      if (vereinslosSelected) {
        const topLeagueIds = leagues.filter(l => ['L1', 'L2', 'L3'].includes(l.id)).map(l => l.id);
        if (leagueIds) {
          leagueIds = [...new Set([...leagueIds, ...topLeagueIds])];
        } else {
          leagueIds = topLeagueIds;
        }
      }

      const result = await loadAllPlayers({
        leagueIds: leagueIds && leagueIds.length > 0 ? leagueIds : undefined,
        agentFilter,
        ageFilter: selectedAges.length === 1 ? selectedAges[0] : selectedAges.length > 1 ? selectedAges : 'all',
      });
      setPlayers(result.players);
      setPlayersTotal(result.total);
    } catch (e) {
      console.error('Error loading players:', e);
    } finally {
      setPlayersLoading(false);
    }
  }, [selectedLeagues, agentFilter, selectedAges, leagues]);

  const loadChangesTab = useCallback(async () => {
    try {
      const result = await loadAgentChanges({ sinceDays: 28, limit: 200 });
      // Sortierung: Spieler die Berater VERLOREN haben zuerst (höchste Prio)
      const sorted = [...(result.changes || [])].sort((a, b) => {
        const aLost = !a.new_agent_name || a.new_agent_name === 'kein Beratereintrag';
        const bLost = !b.new_agent_name || b.new_agent_name === 'kein Beratereintrag';
        const aFam = a.new_agent_name === 'Familienangehörige';
        const bFam = b.new_agent_name === 'Familienangehörige';

        // Lost agent first
        if (aLost && !bLost) return -1;
        if (!aLost && bLost) return 1;
        // Then Familienangehörige
        if (aFam && !bFam) return -1;
        if (!aFam && bFam) return 1;
        // Then by date (newest first)
        return new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime();
      });
      setChanges(sorted);
      setChangesTotal(result.total);
    } catch (e) {
      console.error('Error loading changes:', e);
    }
  }, []);

  const loadWatchlistTab = useCallback(async () => {
    try {
      const result = await loadWatchlist();
      setWatchlist(result);
    } catch (e) {
      console.error('Error loading watchlist:', e);
    }
  }, []);

  const loadSuggestionsTab = useCallback(async () => {
    setSuggestionsLoading(true);
    try {
      const [result, stats] = await Promise.all([
        loadSuggestedPlayers(suggestionsStatType, { limit: 600 }),
        loadRankingsStats(),
      ]);
      setSuggestedPlayers(result);
      setRankingsLastUpdate(stats.lastUpdate);
    } catch (e) {
      console.error('Error loading suggestions:', e);
    } finally {
      setSuggestionsLoading(false);
    }
  }, [suggestionsStatType]);

  const handleRefreshRankings = useCallback(async () => {
    setRankingsRefreshing(true);
    try {
      const result = await refreshPlayerRankings();
      if (result.success) {
        // Nach erfolgreichem Refresh die Daten neu laden
        await loadSuggestionsTab();
      } else {
        console.error('Rankings refresh failed:', result.errors);
      }
    } catch (e) {
      console.error('Error refreshing rankings:', e);
    } finally {
      setRankingsRefreshing(false);
    }
  }, [loadSuggestionsTab]);

  const handleAddSuggestionToWatchlist = useCallback(async (stat: PlayerStat) => {
    const success = await addStatPlayerToWatchlist(stat);
    if (success) {
      // Aus der Liste entfernen (da jetzt auf Watchlist)
      setSuggestedPlayers(prev => prev.filter(p => p.tm_player_id !== stat.tm_player_id));
      // Watchlist neu laden
      await loadWatchlistTab();
    }
  }, [loadWatchlistTab]);

  const loadTabData = useCallback(async () => {
    switch (activeTab) {
      case 'alle_spieler':
        await loadPlayersTab();
        break;
      case 'beraterwechsel':
        await loadChangesTab();
        break;
      case 'vorschlaege':
        await loadSuggestionsTab();
        break;
    }
  }, [activeTab, loadPlayersTab, loadChangesTab, loadSuggestionsTab]);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadStatus(), loadPlayersTab(), loadChangesTab(), loadWatchlistTab(), loadSuggestionsTab()]);
    setRefreshing(false);
  }, [loadStatus, loadPlayersTab, loadChangesTab, loadSuggestionsTab]);

  const loadEvaluations = useCallback(async () => {
    const evals = await loadAllEvaluations();
    setEvaluations(evals);
  }, []);

  useEffect(() => {
    loadStatus();
    loadLeagueList();
    loadEvaluations();
    // Alle Tabs initial laden (für Badge-Counts)
    loadPlayersTab();
    loadChangesTab();
    loadWatchlistTab();
    loadSuggestionsTab();
    // Auto-Refresh Scan-Status alle 30 Sek.
    const interval = setInterval(loadStatus, 30_000);
    return () => clearInterval(interval);
  }, []);

  // Tab-Daten bei Tab-Wechsel neu laden
  useEffect(() => {
    loadTabData();
  }, [activeTab]);

  // Vorschläge neu laden wenn Statistik-Typ wechselt
  useEffect(() => {
    if (activeTab === 'vorschlaege') {
      loadSuggestionsTab();
    }
  }, [suggestionsStatType]);

  // Beim ersten Laden: alle Sections zugeklappt
  useEffect(() => {
    if (collapsedSections === null && players.length > 0) {
      const allLeagues = new Set(players.map(p => p.is_vereinslos ? 'Vereinslos' : (p.league_name || 'Sonstige')));
      setCollapsedSections(allLeagues);
    }
  }, [players, collapsedSections]);

  // Reload players when filters change
  useEffect(() => {
    if (activeTab === 'alle_spieler') {
      loadPlayersTab();
    }
  }, [selectedLeagues, agentFilter, selectedAges]);

  // ========== PLAYER DETAIL SHEET ==========

  const openPlayerDetail = async (player: BeraterPlayer) => {
    setSelectedPlayer(player);
    setPlayerHistory([]);
    setHistoryLoading(true);

    // Bestehende Evaluation laden, Watchlist als Fallback
    const existingEval = evaluations.get(player.id);
    const wlEntry = watchlist.find(w => w.player_id === player.id);
    setModalRating(existingEval?.rating ?? wlEntry?.rating ?? null);
    setModalNotes(existingEval?.notes ?? wlEntry?.notes ?? '');
    setModalEvalStatus(existingEval?.status ?? null);

    const [onWl, history] = await Promise.all([
      isOnWatchlist(player.id),
      loadPlayerHistory(player.id),
    ]);
    setIsOnWatchlistState(onWl);
    setPlayerHistory(history);
    setHistoryLoading(false);
  };

  const openChangeDetail = (change: BeraterChange) => {
    const pseudoPlayer: BeraterPlayer = {
      id: change.player_id,
      club_id: '',
      player_name: change.player_name,
      tm_player_id: '',
      tm_profile_url: change.tm_profile_url || '',
      birth_date: change.birth_date,
      position: null,
      current_agent_name: change.new_agent_name,
      current_agent_company: change.new_agent_company,
      has_agent: !!(change.new_agent_name && change.new_agent_name !== 'kein Beratereintrag'),
      agent_updated_at: change.detected_at,
      agent_since: change.detected_at,
      last_scanned_at: null,
      is_active: true,
      is_vereinslos: false,
      market_value: null,
      club_name: change.club_name || undefined,
      league_id: change.league_id || undefined,
    };
    // Try to get market_value from loaded players
    const match = players.find(p => p.id === change.player_id);
    if (match) {
      pseudoPlayer.market_value = match.market_value;
    }
    openPlayerDetail(pseudoPlayer);
  };

  const openStatDetail = (stat: PlayerStat) => {
    const pseudoPlayer: BeraterPlayer = {
      id: stat.player_id || '',
      club_id: '',
      player_name: stat.player_name,
      tm_player_id: stat.tm_player_id,
      tm_profile_url: stat.tm_profile_url || '',
      birth_date: stat.birth_date,
      position: stat.position,
      current_agent_name: stat.current_agent_name || null,
      current_agent_company: stat.current_agent_company || null,
      has_agent: stat.has_agent ?? false,
      agent_updated_at: null,
      agent_since: null,
      last_scanned_at: null,
      is_active: true,
      is_vereinslos: false,
      market_value: null,
      club_name: stat.club_name || undefined,
      league_id: stat.league_id || undefined,
      league_name: stat.league_name || undefined,
    };
    openPlayerDetail(pseudoPlayer);
  };

  const handleToggleWatchlist = async () => {
    if (!selectedPlayer) return;

    if (isOnWatchlistState) {
      const success = await removeFromWatchlist(selectedPlayer.id);
      if (success) {
        setIsOnWatchlistState(false);
        await loadWatchlistTab();
      }
    } else {
      let success: boolean;
      if (!selectedPlayer.id) {
        // Vorschläge-Spieler ohne berater_players-Eintrag
        success = await addStatPlayerToWatchlist({
          id: '',
          player_id: null,
          tm_player_id: selectedPlayer.tm_player_id,
          player_name: selectedPlayer.player_name,
          tm_profile_url: selectedPlayer.tm_profile_url,
          birth_date: selectedPlayer.birth_date,
          position: selectedPlayer.position,
          league_id: selectedPlayer.league_id || '',
          club_name: selectedPlayer.club_name || null,
          stat_type: 'goals',
          stat_value: 0,
          games_played: null,
          rank_in_league: null,
          season: null,
          updated_at: '',
        });
      } else {
        success = await addToWatchlist(selectedPlayer.id);
      }
      if (success) {
        setIsOnWatchlistState(true);
        await loadWatchlistTab();
      }
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

  // ========== HELPERS ==========

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

  const getStatAgentLabel = (stat: PlayerStat): { text: string; color: string } => {
    if (!stat.current_agent_name || stat.current_agent_name === 'kein Beratereintrag') {
      return { text: 'kein Beratereintrag', color: colors.success };
    }
    if (stat.current_agent_name === 'Familienangehörige') {
      return { text: 'Familienangehörige', color: colors.warning };
    }
    return { text: stat.current_agent_name, color: colors.textSecondary };
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
    return `${age} J.`;
  };

  const formatDuration = (dateStr: string | null): string => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffDays < 1) return 'seit heute';
    if (diffDays < 7) return `seit ${diffDays} ${diffDays === 1 ? 'Tag' : 'Tagen'}`;
    if (diffDays < 30) {
      const weeks = Math.floor(diffDays / 7);
      return `seit ${weeks} ${weeks === 1 ? 'Woche' : 'Wochen'}`;
    }
    if (diffDays < 365) {
      const months = Math.floor(diffDays / 30);
      return `seit ${months} Mon.`;
    }
    const years = Math.floor(diffDays / 365);
    const remainingMonths = Math.floor((diffDays % 365) / 30);
    if (remainingMonths > 0) {
      return `seit ${years} J. ${remainingMonths} Mon.`;
    }
    return `seit ${years} ${years === 1 ? 'Jahr' : 'J.'}`;
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

  const formatDateDE = (dateStr: string | null): string | null => {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  };

  const formatTimeAgo = (dateStr: string | null): string => {
    if (!dateStr) return 'nie';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffH = Math.floor(diffMs / 3600000);
    const diffD = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return 'gerade eben';
    if (diffMin < 60) return `vor ${diffMin} Min.`;
    if (diffH < 24) return `vor ${diffH} Std.`;
    if (diffD < 7) return `vor ${diffD} Tagen`;
    return date.toLocaleDateString('de-DE');
  };

  const getAgentFilterLabel = (f: AgentFilter): string => {
    switch (f) {
      case 'all': return 'Beraterstatus';
      case 'without_agent': return 'Ohne Berater';
    }
  };

  const getAgeFilterLabel = (f: AgeFilter): string => {
    if (f === 'all') return 'Alter';
    if (f === 'herren') return 'Herren';
    if (f === 'younger') {
      const { years } = getYouthYears();
      return `Ab ${years[0] + 1}`;
    }
    return f; // Jahrgang direkt (z.B. '2009')
  };

  // ========== RENDER FUNCTIONS ==========

  const renderScanStatus = () => {
    if (!stats || !scanState) return null;

    const hasError = scanState.error_count > 0;
    const dotColor = hasError ? colors.error : colors.success;
    const statusLabel = hasError
      ? `Unterbrochen (${scanState.error_count} Fehler)`
      : 'Aktiv';

    const parts: string[] = [statusLabel];
    if (scanState.last_scanned_club) {
      parts.push(scanState.last_scanned_club);
    }
    parts.push(`${scanState.next_club_index}/${scanState.total_clubs} Vereine`);
    parts.push(`${stats.totalPlayers} Spieler`);

    return (
      <View style={[styles.scanStatusBar, { borderBottomColor: colors.border }]}>
        <View style={[styles.scanDot, { backgroundColor: dotColor }]} />
        <Text style={[styles.scanStatusText, { color: colors.textSecondary }]}>
          {parts.join(' \u00B7 ')}
        </Text>
      </View>
    );
  };

  const renderTabs = () => {
    const tabs = ([
      { key: 'alle_spieler' as TabKey, label: 'Alle Spieler', count: playersTotal },
      { key: 'beraterwechsel' as TabKey, label: 'Beraterwechsel', count: filteredChanges.length },
      { key: 'vorschlaege' as TabKey, label: 'Vorschläge', count: suggestionSections.reduce((sum, s) => sum + s.count, 0) },
    ]).map((tab) => (
      <TouchableOpacity
        key={tab.key}
        style={[
          styles.tab,
          isMobile && styles.tabMobile,
          activeTab === tab.key && { borderBottomColor: colors.primary, borderBottomWidth: 2 },
        ]}
        onPress={() => setActiveTab(tab.key)}
      >
        <Text
          numberOfLines={1}
          style={[
            styles.tabText,
            isMobile && styles.tabTextMobile,
            { color: activeTab === tab.key ? colors.primary : colors.textSecondary },
          ]}
        >
          {tab.label}
        </Text>
        {tab.count > 0 && (
          <View style={[styles.tabBadge, { backgroundColor: activeTab === tab.key ? colors.primary + '20' : colors.surfaceSecondary }]}>
            <Text style={[styles.tabBadgeText, { color: activeTab === tab.key ? colors.primary : colors.textSecondary }]}>
              {tab.count > 999 ? `${Math.floor(tab.count / 1000)}k` : tab.count}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    ));

    if (isMobile) {
      return (
        <View style={[styles.tabContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ flexDirection: 'row' }}>
            {tabs}
          </ScrollView>
        </View>
      );
    }

    return (
      <View style={[styles.tabContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {tabs}
      </View>
    );
  };

  // ========== DROPDOWN HELPER ==========

  const openDropdown = (ref: React.RefObject<View | null>, show: (v: boolean) => void) => {
    ref.current?.measureInWindow((x, y, width, height) => {
      const screenWidth = Dimensions.get('window').width;
      const menuWidth = Math.max(width, 120);
      const overflowsRight = x + menuWidth > screenWidth - 8;
      setDropdownPos({
        x: overflowsRight ? undefined : x,
        right: overflowsRight ? screenWidth - (x + width) : undefined,
        y: y + height + 4,
        width: menuWidth,
      });
      show(true);
    });
  };

  const closeDropdown = (hide: (v: boolean) => void) => {
    hide(false);
    setDropdownPos(null);
  };

  const renderDropdown = (
    visible: boolean,
    onClose: () => void,
    options: { value: string; label: string }[],
    selected: string,
    onSelect: (v: string) => void,
  ) => {
    if (!visible || !dropdownPos) return null;
    return (
      <Modal visible transparent animationType="none" onRequestClose={onClose}>
        <TouchableOpacity style={styles.dropdownOverlay} onPress={onClose} activeOpacity={1}>
          <View style={[styles.dropdownMenu, { backgroundColor: colors.surface, borderColor: colors.border, top: dropdownPos.y, left: dropdownPos.x, right: dropdownPos.right, minWidth: dropdownPos.width }]}>
            {options.map(opt => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.dropdownItem, selected === opt.value && { backgroundColor: colors.primary + '15' }]}
                onPress={() => { onSelect(opt.value); onClose(); }}
              >
                <Text style={[styles.dropdownItemText, { color: selected === opt.value ? colors.primary : colors.text }]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    );
  };

  const renderMultiDropdown = (
    visible: boolean,
    onClose: () => void,
    options: { value: string; label: string }[],
    selected: string[],
    onToggle: (v: string) => void,
    onClear: () => void,
  ) => {
    if (!visible || !dropdownPos) return null;
    return (
      <Modal visible transparent animationType="none" onRequestClose={onClose}>
        <TouchableOpacity style={styles.dropdownOverlay} onPress={onClose} activeOpacity={1}>
          <View style={[styles.dropdownMenu, { backgroundColor: colors.surface, borderColor: colors.border, top: dropdownPos.y, left: dropdownPos.x, right: dropdownPos.right, minWidth: dropdownPos.width }]}>
            {selected.length > 0 && (
              <TouchableOpacity
                style={[styles.dropdownItem, { borderBottomWidth: 1, borderBottomColor: colors.border }]}
                onPress={() => { onClear(); onClose(); }}
              >
                <Text style={[styles.dropdownItemText, { color: colors.textSecondary }]}>Alle (zurücksetzen)</Text>
              </TouchableOpacity>
            )}
            {options.map(opt => {
              const isSelected = selected.includes(opt.value);
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.dropdownItem, isSelected && { backgroundColor: colors.primary + '15' }]}
                  onPress={() => onToggle(opt.value)}
                >
                  <Text style={[styles.dropdownItemText, { color: isSelected ? colors.primary : colors.text }]}>
                    {isSelected ? '✓ ' : '   '}{opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
      </Modal>
    );
  };

  // ========== FILTER CHIPS ==========

  const renderFilters = () => {
    const leagueLabel = selectedLeagues.length === 0 ? 'Alle Ligen'
      : selectedLeagues.length === 1 ? selectedLeagues[0]
      : `${selectedLeagues.length} Ligen`;
    const hasLeague = selectedLeagues.length > 0;

    const ageLabel = selectedAges.length === 0 ? 'Alter'
      : selectedAges.length === 1 ? getAgeFilterLabel(selectedAges[0])
      : `${selectedAges.length} Jahrgänge`;
    const hasAge = selectedAges.length > 0;

    return (
      <View style={[styles.filterContainer, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        {/* Suchfeld — nimmt restlichen Platz */}
        <View style={[styles.searchContainer, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
          <Text style={[styles.searchIcon, { color: colors.textSecondary }]}>&#x1F50D;</Text>
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder="Suche..."
            placeholderTextColor={colors.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
        </View>

        {/* Liga Dropdown (Multi) */}
        <View ref={leagueChipRef} collapsable={false}>
          <TouchableOpacity
            style={[styles.filterChip, { backgroundColor: hasLeague ? colors.primary + '15' : colors.surfaceSecondary, borderColor: hasLeague ? colors.primary : colors.border }]}
            onPress={() => openDropdown(leagueChipRef, setShowLeaguePicker)}
          >
            <Text style={[styles.filterChipText, { color: hasLeague ? colors.primary : colors.text }]} numberOfLines={1}>
              {leagueLabel} &#x25BE;
            </Text>
          </TouchableOpacity>
        </View>

        {/* Beraterzustand Dropdown */}
        <View ref={agentChipRef} collapsable={false}>
          <TouchableOpacity
            style={[styles.filterChip, { backgroundColor: agentFilter !== 'all' ? colors.primary + '15' : colors.surfaceSecondary, borderColor: agentFilter !== 'all' ? colors.primary : colors.border }]}
            onPress={() => openDropdown(agentChipRef, setShowAgentPicker)}
          >
            <Text style={[styles.filterChipText, { color: agentFilter !== 'all' ? colors.primary : colors.text }]}>
              {getAgentFilterLabel(agentFilter)} &#x25BE;
            </Text>
          </TouchableOpacity>
        </View>

        {/* Alter Dropdown (Multi) */}
        <View ref={ageChipRef} collapsable={false}>
          <TouchableOpacity
            style={[styles.filterChip, { backgroundColor: hasAge ? colors.primary + '15' : colors.surfaceSecondary, borderColor: hasAge ? colors.primary : colors.border }]}
            onPress={() => openDropdown(ageChipRef, setShowAgePicker)}
          >
            <Text style={[styles.filterChipText, { color: hasAge ? colors.primary : colors.text }]}>
              {ageLabel} &#x25BE;
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // ========== MOBILE RENDER FUNCTIONS ==========

  const renderMobileHeader = () => (
    <>
      <View style={[styles.mobileHeader, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.mobileMenuBtn, { backgroundColor: colors.surfaceSecondary }]}
          onPress={() => navigation.navigate('Dashboard' as never)}
        >
          <Ionicons name="menu" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.mobileHeaderTitle, { color: colors.text }]}>Beraterstatus</Text>
        <TouchableOpacity
          style={[styles.mobileProfileBtn, { backgroundColor: colors.primary }]}
          onPress={() => navigation.navigate('Dashboard' as never)}
        >
          <Text style={[styles.mobileProfileInitials, { color: colors.primaryText }]}>SC</Text>
        </TouchableOpacity>
      </View>
      <View style={[styles.mobileToolbar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.mobileBackBtn, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
          onPress={() => navigation.navigate('Dashboard' as never)}
        >
          <Text style={[styles.mobileBackBtnText, { color: colors.textSecondary }]}>{'\u2190'} Zurück</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
      </View>
    </>
  );

  const renderMobileFilters = () => {
    const leagueLabel = selectedLeagues.length === 0 ? 'Ligen'
      : selectedLeagues.length === 1 ? selectedLeagues[0]
      : `${selectedLeagues.length} Ligen`;
    const hasLeague = selectedLeagues.length > 0;
    const ageLabel = selectedAges.length === 0 ? 'Alter'
      : selectedAges.length === 1 ? getAgeFilterLabel(selectedAges[0])
      : `${selectedAges.length} Jgg.`;
    const hasAge = selectedAges.length > 0;

    return (
      <View style={[styles.mobileFilterContainer, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <View style={styles.mobileSearchRow}>
          <View style={[styles.searchContainer, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
            <Text style={[styles.searchIcon, { color: colors.textSecondary }]}>{'\uD83D\uDD0D'}</Text>
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              placeholder="Suche..."
              placeholderTextColor={colors.textSecondary}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCorrect={false}
              clearButtonMode="while-editing"
            />
          </View>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.mobileChipRow} contentContainerStyle={styles.mobileChipRowContent}>
          <View ref={leagueChipRef} collapsable={false}>
            <TouchableOpacity
              style={[styles.filterChip, { backgroundColor: hasLeague ? colors.primary + '15' : colors.surfaceSecondary, borderColor: hasLeague ? colors.primary : colors.border }]}
              onPress={() => openDropdown(leagueChipRef, setShowLeaguePicker)}
            >
              <Text style={[styles.filterChipText, { color: hasLeague ? colors.primary : colors.text }]} numberOfLines={1}>
                {leagueLabel} {'\u25BE'}
              </Text>
            </TouchableOpacity>
          </View>
          <View ref={agentChipRef} collapsable={false}>
            <TouchableOpacity
              style={[styles.filterChip, { backgroundColor: agentFilter !== 'all' ? colors.primary + '15' : colors.surfaceSecondary, borderColor: agentFilter !== 'all' ? colors.primary : colors.border }]}
              onPress={() => openDropdown(agentChipRef, setShowAgentPicker)}
            >
              <Text style={[styles.filterChipText, { color: agentFilter !== 'all' ? colors.primary : colors.text }]}>
                {getAgentFilterLabel(agentFilter)} {'\u25BE'}
              </Text>
            </TouchableOpacity>
          </View>
          <View ref={ageChipRef} collapsable={false}>
            <TouchableOpacity
              style={[styles.filterChip, { backgroundColor: hasAge ? colors.primary + '15' : colors.surfaceSecondary, borderColor: hasAge ? colors.primary : colors.border }]}
              onPress={() => openDropdown(ageChipRef, setShowAgePicker)}
            >
              <Text style={[styles.filterChipText, { color: hasAge ? colors.primary : colors.text }]}>
                {ageLabel} {'\u25BE'}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  };

  const renderMobilePlayerCard = ({ item }: { item: BeraterPlayer }) => {
    const agentLabel = getAgentLabel(item);
    const age = calculateAge(item.birth_date);
    const evalColor = getEvalColor(item.id);
    const ev = evaluations.get(item.id);
    const wlEntry = watchlist.find(w => w.player_id === item.id);
    const rating = ev?.rating ?? wlEntry?.rating ?? null;
    const hasNotes = !!(ev?.notes || wlEntry?.notes);

    return (
      <TouchableOpacity
        style={[
          styles.mobileCard,
          { backgroundColor: evalColor?.bg || colors.surface, borderColor: colors.border },
          evalColor && { borderLeftWidth: 3, borderLeftColor: evalColor.border },
        ]}
        onPress={() => openPlayerDetail(item)}
        activeOpacity={0.7}
      >
        <View style={styles.mobileCardHeader}>
          <View style={styles.mobileCardNameRow}>
            <Text style={[styles.mobileCardName, { color: colors.text }]} numberOfLines={1}>
              {formatNameLastFirst(item.player_name)}
            </Text>
            {age ? <Text style={[styles.mobileCardAge, { color: colors.textSecondary }]}>{age}</Text> : null}
            {rating != null && (
              <View style={[styles.ratingBadge, { backgroundColor: rating >= 7 ? colors.success + '25' : rating >= 4 ? '#f5a623' + '25' : colors.error + '25' }]}>
                <Text style={[styles.ratingBadgeText, { color: rating >= 7 ? colors.success : rating >= 4 ? '#f5a623' : colors.error }]}>{rating}</Text>
              </View>
            )}
            {hasNotes && <Ionicons name="chatbubble-outline" size={12} color={colors.textSecondary} style={{ marginLeft: 4 }} />}
          </View>
          {item.market_value ? (
            <Text style={[styles.mobileCardMV, { color: colors.text }]}>{item.market_value}</Text>
          ) : null}
        </View>
        <View style={styles.mobileCardRow2}>
          <Text style={[styles.mobileCardClubInline, { color: colors.textSecondary, fontStyle: item.is_vereinslos ? 'italic' : 'normal' }]} numberOfLines={1}>
            {item.is_vereinslos ? `zuletzt: ${item.club_name || ''}` : (item.club_name || '')}
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

  const renderMobileSuggestionCard = ({ item, index }: { item: PlayerStat; index: number }) => {
    const age = calculateAge(item.birth_date);
    const agentLabel = getStatAgentLabel(item);
    const statLabel = item.stat_type === 'goals' ? 'Tore' : 'Vorlagen';
    const evalColor = item.player_id ? getEvalColor(item.player_id) : null;

    return (
      <TouchableOpacity
        style={[styles.mobileCard, { backgroundColor: colors.surface, borderColor: colors.border }, evalColor && { backgroundColor: evalColor.bg, borderLeftWidth: 3, borderLeftColor: evalColor.border }]}
        onPress={() => openStatDetail(item)}
        activeOpacity={0.7}
      >
        <View style={styles.mobileCardHeader}>
          <View style={styles.mobileCardNameRow}>
            <Text style={[styles.mobileCardAge, { color: colors.textSecondary }]}>{index + 1}.</Text>
            <Text style={[styles.mobileCardName, { color: colors.text }]} numberOfLines={1}>
              {formatNameLastFirst(item.player_name)}
            </Text>
            {age ? <Text style={[styles.mobileCardAge, { color: colors.textSecondary }]}>{age}</Text> : null}
          </View>
          <Text style={[styles.mobileCardMV, { color: colors.primary, fontWeight: '600' }]}>
            {item.stat_value} {statLabel}{item.games_played ? ` / ${item.games_played} Sp.` : ''}
          </Text>
        </View>
        <View style={styles.mobileCardRow2}>
          <Text style={[styles.mobileCardClubInline, { color: colors.textSecondary }]} numberOfLines={1}>
            {item.club_name || ''}
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

  const renderMobileChangeCard = ({ item }: { item: BeraterChange }) => {
    const prevLabel = item.previous_agent_name || 'kein Berater';
    const newLabel = item.new_agent_name || 'kein Berater';
    const age = calculateAge(item.birth_date);
    const changeDate = new Date(item.detected_at).toLocaleDateString('de-DE');
    const playerMatch = players.find(p => p.id === item.player_id);
    const mv = playerMatch?.market_value || null;
    const isNowFree = !item.new_agent_name || item.new_agent_name === 'kein Beratereintrag';
    const isNowFamily = item.new_agent_name === 'Familienangehörige';
    const arrowColor = isNowFree ? colors.success : isNowFamily ? colors.warning : colors.primary;

    return (
      <TouchableOpacity
        style={[styles.mobileCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => openChangeDetail(item)}
        activeOpacity={0.7}
      >
        <View style={styles.mobileCardHeader}>
          <View style={styles.mobileCardNameRow}>
            <Text style={[styles.mobileCardName, { color: colors.text }]} numberOfLines={1}>
              {formatNameLastFirst(item.player_name)}
            </Text>
            {age ? <Text style={[styles.mobileCardAge, { color: colors.textSecondary }]}>{age}</Text> : null}
          </View>
          <Text style={[styles.mobileCardDate, { color: colors.textSecondary }]}>{changeDate}</Text>
        </View>
        <View style={styles.mobileCardSubRow}>
          <Text style={[styles.mobileCardClub, { color: colors.textSecondary, marginBottom: 0 }]} numberOfLines={1}>
            {item.club_name || ''}
          </Text>
          {mv ? <Text style={[styles.mobileCardMV, { color: colors.textSecondary }]}>{mv}</Text> : null}
        </View>
        <View style={[styles.mobileCardChangeRow, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
          <Text style={[styles.mobileCardPrevAgent, { color: colors.textSecondary }]} numberOfLines={1}>
            {prevLabel}
          </Text>
          <Text style={[styles.mobileCardArrow, { color: arrowColor }]}>{'\u2192'}</Text>
          <Text style={[styles.mobileCardNewAgent, { color: isNowFree ? colors.success : isNowFamily ? colors.warning : colors.text }]} numberOfLines={1}>
            {newLabel}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderMobileListItem = ({ item, section }: { item: PlayerListItem; section: { title: string } }) => {
    if (item.type === 'club_header') {
      return renderClubHeader(item, section.title);
    }
    return renderMobilePlayerCard({ item: item.player });
  };

  // ========== LIST ROWS ==========

  // Evaluation color helper
  const getEvalColor = (playerId: string): { bg: string; border: string } | null => {
    // Evaluation-Status hat Vorrang vor Watchlist-Farbe
    const ev = evaluations.get(playerId);
    if (ev?.status === 'interessant') return { bg: colors.success + '12', border: colors.success };
    if (ev?.status === 'nicht_interessant') return { bg: colors.error + '12', border: colors.error };
    const onWl = watchlist.some(w => w.player_id === playerId);
    if (onWl) return { bg: colors.warning + '12', border: colors.warning };
    return null;
  };

  const renderPlayerRow = ({ item }: { item: BeraterPlayer }) => {
    const agentLabel = getAgentLabel(item);
    const age = calculateAge(item.birth_date);
    const agentPart = agentLabel.text;
    const evalColor = getEvalColor(item.id);
    const ev = evaluations.get(item.id);
    const wlEntry = watchlist.find(w => w.player_id === item.id);
    const rating = ev?.rating ?? wlEntry?.rating ?? null;
    const hasNotes = !!(ev?.notes || wlEntry?.notes);

    return (
      <TouchableOpacity
        style={[
          styles.playerRow,
          { borderBottomColor: colors.border },
          evalColor && { backgroundColor: evalColor.bg, borderLeftWidth: 3, borderLeftColor: evalColor.border },
        ]}
        onPress={() => openPlayerDetail(item)}
        activeOpacity={0.7}
      >
        <View style={styles.playerRowColumns}>
          <View style={styles.playerColNameWrap}>
            <Text style={[styles.playerColName, { color: colors.text }]} numberOfLines={1}>
              {formatNameLastFirst(item.player_name)}
            </Text>
            {age ? <Text style={[styles.playerColAge, { color: colors.textSecondary }]}>{age}</Text> : null}
          </View>
          <Text style={[styles.playerColMV, { color: colors.textSecondary }]} numberOfLines={1}>
            {item.market_value || '-'}
          </Text>
          <Text style={[styles.playerColClub, { color: colors.textSecondary, fontStyle: item.is_vereinslos ? 'italic' : 'normal' }]} numberOfLines={1}>
            {item.is_vereinslos ? `zuletzt: ${item.club_name || ''}` : (item.club_name || '')}
          </Text>
          <Text style={[styles.playerColAgent, { color: agentLabel.color }]} numberOfLines={1}>
            {agentPart}
          </Text>
          <View style={styles.playerColNotes}>
            {hasNotes && <Ionicons name="chatbubble-outline" size={13} color={colors.textSecondary} />}
          </View>
          <View style={styles.playerColRating}>
            {rating != null && (
              <View style={[styles.ratingBadge, { backgroundColor: rating >= 7 ? colors.success + '25' : rating >= 4 ? '#f5a623' + '25' : colors.error + '25' }]}>
                <Text style={[styles.ratingBadgeText, { color: rating >= 7 ? colors.success : rating >= 4 ? '#f5a623' : colors.error }]}>{rating}</Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderChangeRow = ({ item }: { item: BeraterChange }) => {
    const prevLabel = item.previous_agent_name || 'kein Berater';
    const newLabel = item.new_agent_name || 'kein Berater';
    const age = calculateAge(item.birth_date);
    const changeDate = new Date(item.detected_at).toLocaleDateString('de-DE');
    const playerMatch = players.find(p => p.id === item.player_id);
    const mv = playerMatch?.market_value || '-';
    const evalColor = item.player_id ? getEvalColor(item.player_id) : null;

    return (
      <TouchableOpacity
        style={[
          styles.playerRow,
          { borderBottomColor: colors.border },
          evalColor && { backgroundColor: evalColor.bg, borderLeftWidth: 3, borderLeftColor: evalColor.border },
        ]}
        onPress={() => openChangeDetail(item)}
        activeOpacity={0.7}
      >
        <View style={styles.playerRowColumns}>
          <View style={styles.playerColNameWrap}>
            <Text style={[styles.playerColName, { color: colors.text }]} numberOfLines={1}>
              {formatNameLastFirst(item.player_name)}
            </Text>
            {age ? <Text style={[styles.playerColAge, { color: colors.textSecondary }]}>{age}</Text> : null}
          </View>
          <Text style={[styles.playerColMV, { color: colors.textSecondary }]} numberOfLines={1}>
            {mv}
          </Text>
          <Text style={[styles.playerColClub, { color: colors.textSecondary }]} numberOfLines={1}>
            {item.club_name || ''}
          </Text>
          <Text style={[styles.playerColClub, { color: colors.textSecondary }]} numberOfLines={1}>
            {prevLabel}
          </Text>
          <Text style={[styles.playerColAgent, { color: colors.success }]} numberOfLines={1}>
            {newLabel}
          </Text>
          <Text style={[styles.changeDate, { color: colors.textSecondary }]} numberOfLines={1}>
            {changeDate}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  // ========== DETAIL SHEET ==========

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
            {/* Close ✕ oben rechts — außerhalb ScrollView */}
            <TouchableOpacity
              style={[styles.closeButton, { borderColor: colors.border }]}
              onPress={() => setSelectedPlayer(null)}
              activeOpacity={0.7}
            >
              <Text style={[styles.closeButtonText, { color: colors.textSecondary }]}>✕</Text>
            </TouchableOpacity>

            <ScrollView bounces={false} showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
              {/* Top: Info links, Buttons rechts */}
              <View style={styles.detailTopRow}>
                <View style={{ flex: 1, marginRight: 12 }}>
                  {/* Name + Geburtsdatum */}
                  <Text style={[styles.detailName, { color: colors.text }]}>
                    {selectedPlayer.player_name}{'  '}
                    <Text style={[styles.detailNameMeta, { color: colors.textSecondary }]}>
                      {[selectedPlayer.birth_date, age ? `(${age})` : null].filter(Boolean).join(' ')}
                    </Text>
                  </Text>
                  {/* Verein · Liga */}
                  <Text style={[styles.detailSub, { color: colors.textSecondary }]}>
                    {[selectedPlayer.club_name, selectedPlayer.league_name].filter(Boolean).join(' · ')}
                  </Text>
                  {/* Marktwert */}
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
                </View>
              </View>

              {/* Beraterstatus (horizontal: aktuell links → Vergangenheit rechts) */}
              <View style={[styles.detailSection, { borderColor: colors.border }]}>
                <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Beraterstatus</Text>

                {historyLoading ? (
                  <ActivityIndicator size="small" color={colors.primary} style={{ marginTop: 8 }} />
                ) : (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.hTimeline}>
                    {/* Aktueller Status — immer ganz links */}
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

                    {/* Vergangene Berater — neueste links, älteste rechts */}
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

              {/* Bewertung (1-10) */}
              <View style={[styles.detailSection, { borderColor: colors.border }]}>
                <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Bewertung</Text>
                <View style={styles.ratingRow}>
                  {([null, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as (number | null)[]).map((val) => {
                    const isActive = modalRating === val;
                    return (
                      <TouchableOpacity
                        key={val === null ? 'none' : val}
                        style={[
                          styles.ratingButton,
                          {
                            backgroundColor: isActive ? colors.primary : colors.surfaceSecondary,
                            borderColor: isActive ? colors.primary : colors.border,
                          },
                        ]}
                        onPress={() => handleRatingChange(val)}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.ratingButtonText, { color: isActive ? '#fff' : colors.text }]}>
                          {val === null ? '-' : val}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* Notizen */}
              <View style={[styles.detailSection, { borderColor: colors.border }]}>
                <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Notizen</Text>
                <TextInput
                  style={[
                    styles.notesInput,
                    {
                      color: colors.text,
                      backgroundColor: colors.surfaceSecondary,
                      borderColor: colors.border,
                    },
                  ]}
                  value={modalNotes}
                  onChangeText={handleNotesChange}
                  placeholder="Notizen zum Spieler..."
                  placeholderTextColor={colors.textSecondary}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />
              </View>
            </ScrollView>

            {/* Eval-Buttons (fixiert am Bottom) */}
            <View style={[styles.evalButtonRow, { borderTopColor: colors.border }]}>
              <TouchableOpacity
                style={[
                  styles.evalButton,
                  modalEvalStatus === 'nicht_interessant'
                    ? { backgroundColor: colors.error }
                    : { backgroundColor: colors.border },
                ]}
                onPress={() => handleEvaluation('nicht_interessant')}
                activeOpacity={0.7}
              >
                <Text style={[
                  styles.evalButtonText,
                  { color: modalEvalStatus === 'nicht_interessant' ? '#fff' : colors.textSecondary },
                ]}>Uninteressant</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.evalButton,
                  modalEvalStatus === 'interessant'
                    ? { backgroundColor: colors.success }
                    : { backgroundColor: colors.border },
                ]}
                onPress={() => handleEvaluation('interessant')}
                activeOpacity={0.7}
              >
                <Text style={[
                  styles.evalButtonText,
                  { color: modalEvalStatus === 'interessant' ? '#fff' : colors.textSecondary },
                ]}>Interessant</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.evalButton,
                  isOnWatchlistState
                    ? { backgroundColor: colors.warning }
                    : { backgroundColor: colors.border },
                ]}
                onPress={handleToggleWatchlist}
                activeOpacity={0.7}
              >
                <Text style={[
                  styles.evalButtonText,
                  { color: isOnWatchlistState ? '#fff' : colors.textSecondary },
                ]}>{isOnWatchlistState ? 'Watchlist ✓' : 'Watchlist'}</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    );
  };

  // ========== DROPDOWN OPTIONS ==========

  const leagueOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [];
    const seen = new Set<string>();
    for (const l of leagues.filter(l => l.is_active)) {
      if (!seen.has(l.name)) {
        seen.add(l.name);
        opts.push({ value: l.name, label: l.name });
      }
    }
    opts.push({ value: 'Vereinslos', label: 'Vereinslos' });
    return opts;
  }, [leagues]);

  const agentOptions: { value: string; label: string }[] = [
    { value: 'all', label: 'Alle' },
    { value: 'without_agent', label: 'Ohne Berater' },
  ];

  const ageOptions = useMemo(() => {
    const { years } = getYouthYears();
    const youngestShownYear = years[0];

    const hasYoungerPlayers = players.some(p => {
      if (!p.birth_date) return false;
      const parts = p.birth_date.split('.');
      if (parts.length !== 3) return false;
      const birthYear = parseInt(parts[2]);
      return !isNaN(birthYear) && birthYear > youngestShownYear;
    });

    const opts: { value: string; label: string }[] = [
      { value: 'herren', label: 'Herren' },
      ...years.slice().reverse().map(y => ({ value: String(y), label: String(y) })),
    ];
    if (hasYoungerPlayers) {
      opts.push({ value: 'younger', label: `Ab ${youngestShownYear + 1}` });
    }
    return opts;
  }, [players]);

  // ========== LEAGUE SECTIONS (Alle Spieler Tab) ==========

  const playerSections = useMemo(() => {
    // Client-seitige Suche
    const filteredPlayers = searchQuery.trim()
      ? players.filter(p => fuzzyMatch(searchQuery,
          p.player_name, p.club_name, p.current_agent_name, p.current_agent_company
        ))
      : players;

    const TOP_LEAGUES = ['L1', 'L2', 'L3'];
    const grouped = new Map<string, BeraterPlayer[]>();
    for (const player of filteredPlayers) {
      let league: string;
      if (player.is_vereinslos) {
        // Nur Herren-Profis (1./2./3. Liga) als vereinslos anzeigen
        if (!TOP_LEAGUES.includes(player.league_id || '')) continue;
        league = 'Vereinslos';
      } else {
        league = player.league_name || 'Sonstige';
      }
      if (!grouped.has(league)) grouped.set(league, []);
      grouped.get(league)!.push(player);
    }

    // Sortier-Reihenfolge aus leagues (tier-basiert)
    const leagueOrder = new Map<string, number>();
    const seenNames = new Set<string>();
    for (const l of leagues) {
      if (!seenNames.has(l.name)) {
        seenNames.add(l.name);
        leagueOrder.set(l.name, leagueOrder.size);
      }
    }

    const sections = Array.from(grouped.entries())
      .sort(([a], [b]) => (leagueOrder.get(a) ?? (a === 'Vereinslos' ? 9999 : 999)) - (leagueOrder.get(b) ?? (b === 'Vereinslos' ? 9999 : 999)))
      .map(([title, data]) => ({
        title,
        data: data.sort((a, b) => {
          const clubCmp = (a.club_name || '').localeCompare(b.club_name || '');
          if (clubCmp !== 0) return clubCmp;
          return formatNameLastFirst(a.player_name).localeCompare(formatNameLastFirst(b.player_name));
        }),
      }));

    // Wenn Ligen ausgewählt sind: nur passende Sections anzeigen
    if (selectedLeagues.length > 0) {
      return sections.filter(s => selectedLeagues.includes(s.title));
    }
    return sections;
  }, [players, searchQuery, leagues, selectedLeagues]);

  const toggleSection = useCallback((title: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev || []);
      if (next.has(title)) {
        next.delete(title);
      } else {
        next.add(title);
      }
      return next;
    });
  }, []);

  const toggleClub = useCallback((clubKey: string) => {
    setExpandedClubs(prev => {
      const next = new Set(prev);
      if (next.has(clubKey)) {
        next.delete(clubKey);
      } else {
        next.add(clubKey);
      }
      return next;
    });
  }, []);

  // Sections mit Club-Untergruppen
  const displaySections = useMemo(() => {
    return playerSections.map(section => {
      if (collapsedSections?.has(section.title)) {
        return { ...section, totalCount: section.data.length, data: [] as PlayerListItem[] };
      }

      const items: PlayerListItem[] = [];

      // Vereinslos: keine Club-Untergruppen, direkt auflisten
      if (section.title === 'Vereinslos') {
        for (const p of section.data) {
          items.push({ type: 'player', player: p });
        }
      } else {
        let currentClub = '';
        let clubPlayers: BeraterPlayer[] = [];

        const flushClub = () => {
          if (currentClub && clubPlayers.length > 0) {
            const clubKey = `${section.title}::${currentClub}`;
            items.push({ type: 'club_header', clubName: currentClub, count: clubPlayers.length });
            if (expandedClubs.has(clubKey)) {
              for (const p of clubPlayers) {
                items.push({ type: 'player', player: p });
              }
            }
          }
        };

        for (const player of section.data) {
          const club = player.club_name || 'Unbekannt';
          if (club !== currentClub) {
            flushClub();
            currentClub = club;
            clubPlayers = [];
          }
          clubPlayers.push(player);
        }
        flushClub();
      }

      return { ...section, totalCount: section.data.length, data: items };
    });
  }, [playerSections, collapsedSections, expandedClubs]);

  // ========== SUGGESTION SECTIONS (Vorschläge Tab) ==========

  const suggestionSections = useMemo(() => {
    if (suggestedPlayers.length === 0) return [];

    // Suche anwenden
    let filtered = suggestedPlayers;
    if (searchQuery.trim()) {
      filtered = suggestedPlayers.filter(p => fuzzyMatch(searchQuery,
        p.player_name, p.club_name, p.league_name, p.current_agent_company
      ));
    }

    // Nach Liga gruppieren
    const grouped = new Map<string, PlayerStat[]>();
    for (const player of filtered) {
      const league = player.league_name || player.league_id || 'Sonstige';
      if (!grouped.has(league)) grouped.set(league, []);
      grouped.get(league)!.push(player);
    }

    // Sortier-Reihenfolge aus leagues (tier-basiert)
    const leagueOrder = new Map<string, number>();
    const seenNames = new Set<string>();
    for (const l of leagues) {
      if (!seenNames.has(l.name)) {
        seenNames.add(l.name);
        leagueOrder.set(l.name, leagueOrder.size);
      }
    }

    // Sections erstellen und nach Tier sortieren
    // Top 20 pro Liga, bei Gleichstand mehr anzeigen
    const MAX_PER_LEAGUE = 20;

    return Array.from(grouped.entries())
      .sort(([a], [b]) => (leagueOrder.get(a) ?? 999) - (leagueOrder.get(b) ?? 999))
      .map(([title, data]) => {
        // Nach Statistik sortieren
        const sorted = data.sort((a, b) => b.stat_value - a.stat_value);

        // Cutoff-Wert ermitteln (Wert des 20. Spielers)
        const cutoffValue = sorted[Math.min(MAX_PER_LEAGUE - 1, sorted.length - 1)]?.stat_value || 0;

        // Alle Spieler mit stat_value >= cutoffValue behalten (Gleichstand-Regel)
        const filtered = sorted.filter(p => p.stat_value >= cutoffValue);

        return {
          title,
          data: filtered,
          count: filtered.length,
        };
      });
  }, [suggestedPlayers, leagues, searchQuery]);

  // Vorschläge: alle Sections standardmäßig zugeklappt
  useEffect(() => {
    if (collapsedSuggestionSections === null && suggestionSections.length > 0) {
      setCollapsedSuggestionSections(new Set(suggestionSections.map(s => s.title)));
    }
  }, [suggestionSections, collapsedSuggestionSections]);

  const toggleSuggestionSection = useCallback((title: string) => {
    setCollapsedSuggestionSections(prev => {
      const next = new Set(prev || []);
      if (next.has(title)) {
        next.delete(title);
      } else {
        next.add(title);
      }
      return next;
    });
  }, []);

  // ========== FILTERED CHANGES (Beraterwechsel Tab) ==========

  const selectedLeagueIds = useMemo(() => {
    if (selectedLeagues.length === 0) return null;
    return new Set(leagues.filter(l => selectedLeagues.includes(l.name)).map(l => l.id));
  }, [selectedLeagues, leagues]);

  const filteredChanges = useMemo(() => {
    const { years: youthYears, herrenCutoff } = getYouthYears();
    const youngestShownYear = youthYears[0];

    return changes.filter(c => {
      // Ehem. Berater "kein Berater"/"kein Beratereintrag" ausblenden
      const prev = c.previous_agent_name;
      if (!prev || prev === 'kein Beratereintrag' || prev === 'kein Berater') return false;

      // Suche
      if (searchQuery.trim()) {
        const matches = fuzzyMatch(searchQuery,
          c.player_name, c.club_name, c.new_agent_name, c.previous_agent_name,
          c.new_agent_company, c.previous_agent_company
        );
        if (!matches) return false;
      }

      // Liga
      if (selectedLeagueIds && c.league_id && !selectedLeagueIds.has(c.league_id)) return false;

      // Beraterstatus
      if (agentFilter === 'without_agent') {
        const noAgent = !c.new_agent_name || c.new_agent_name === 'kein Beratereintrag' || c.new_agent_name === 'Familienangehörige';
        if (!noAgent) return false;
      }

      // Alter (Multi)
      if (selectedAges.length > 0 && c.birth_date) {
        const parts = c.birth_date.split('.');
        if (parts.length === 3) {
          const birthYear = parseInt(parts[2]);
          if (!isNaN(birthYear)) {
            const matchesAge = selectedAges.some(af => {
              if (af === 'herren') return birthYear <= herrenCutoff;
              if (af === 'younger') return birthYear > youngestShownYear;
              const yearNum = parseInt(af);
              return !isNaN(yearNum) && birthYear === yearNum;
            });
            if (!matchesAge) return false;
          }
        }
      } else if (selectedAges.length > 0 && !c.birth_date) {
        return false;
      }

      return true;
    }).sort((a, b) => {
      if (changeSortKey === 'default') {
        // Standard: neueste zuerst, dann alphabetisch nach Name
        const dateComp = new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime();
        if (dateComp !== 0) return dateComp;
        return formatNameLastFirst(a.player_name).localeCompare(formatNameLastFirst(b.player_name));
      }

      const dir = changeSortAsc ? 1 : -1;
      switch (changeSortKey) {
        case 'name':
          return dir * formatNameLastFirst(a.player_name).localeCompare(formatNameLastFirst(b.player_name));
        case 'mv': {
          const mvA = players.find(p => p.id === a.player_id)?.market_value || '';
          const mvB = players.find(p => p.id === b.player_id)?.market_value || '';
          return dir * parseMvNumber(mvA) - dir * parseMvNumber(mvB);
        }
        case 'club':
          return dir * (a.club_name || '').localeCompare(b.club_name || '');
        case 'prev_agent':
          return dir * (a.previous_agent_name || '').localeCompare(b.previous_agent_name || '');
        case 'new_agent':
          return dir * (a.new_agent_name || '').localeCompare(b.new_agent_name || '');
        case 'date':
          return dir * (new Date(a.detected_at).getTime() - new Date(b.detected_at).getTime());
        default:
          return 0;
      }
    });
  }, [changes, searchQuery, selectedLeagueIds, agentFilter, selectedAges, changeSortKey, changeSortAsc, players]);

  // ========== FILTERED WATCHLIST ==========

  const renderSectionHeader = ({ section }: { section: { title: string; data: PlayerListItem[]; totalCount?: number } }) => {
    const isCollapsed = collapsedSections?.has(section.title) ?? true;
    const count = (section as any).totalCount ?? section.data.length;

    return (
      <TouchableOpacity
        style={[styles.sectionHeader, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
        onPress={() => toggleSection(section.title)}
        activeOpacity={0.7}
      >
        <View style={styles.sectionHeaderLeft}>
          <Text style={[styles.sectionHeaderArrow, { color: colors.textSecondary }]}>
            {isCollapsed ? '\u25B6' : '\u25BC'}
          </Text>
          <Text style={[styles.sectionHeaderText, { color: colors.text }]}>{section.title}</Text>
          <Text style={[styles.sectionHeaderCount, { color: colors.textSecondary }]}>{count}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderClubHeader = (item: { clubName: string; count: number }, sectionTitle: string) => {
    const clubKey = `${sectionTitle}::${item.clubName}`;
    const isCollapsed = !expandedClubs.has(clubKey);

    return (
      <TouchableOpacity
        style={[styles.clubHeader, { borderBottomColor: colors.border, backgroundColor: colors.surfaceSecondary + '80' }]}
        onPress={() => toggleClub(clubKey)}
        activeOpacity={0.7}
      >
        <Text style={[styles.clubHeaderArrow, { color: colors.textSecondary }]}>
          {isCollapsed ? '\u25B6' : '\u25BC'}
        </Text>
        <Text style={[styles.clubHeaderText, { color: colors.text }]} numberOfLines={1}>{item.clubName}</Text>
        <Text style={[styles.clubHeaderCount, { color: colors.textSecondary }]}>{item.count}</Text>
      </TouchableOpacity>
    );
  };

  const renderListItem = ({ item, section }: { item: PlayerListItem; section: { title: string } }) => {
    if (item.type === 'club_header') {
      return renderClubHeader(item, section.title);
    }
    return renderPlayerRow({ item: item.player });
  };

  // ========== EMPTY STATES ==========

  const renderEmptyState = () => {
    const messages: Record<TabKey, { icon: string; title: string; hint: string }> = {
      alle_spieler: {
        icon: '👥',
        title: 'Noch keine Daten',
        hint: 'Starte einen Scan um Spieler zu laden.',
      },
      beraterwechsel: {
        icon: '🔄',
        title: 'Keine Beraterwechsel',
        hint: 'Nach dem zweiten Scan-Zyklus werden Wechsel der letzten 4 Wochen hier angezeigt.',
      },
      vorschlaege: {
        icon: '📊',
        title: 'Keine Vorschläge',
        hint: 'Klicke auf "Rankings aktualisieren" um die neuesten Top-Spieler zu laden.',
      },
    };
    const msg = messages[activeTab];

    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyIcon}>{msg.icon}</Text>
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>{msg.title}</Text>
        <Text style={[styles.emptyHint, { color: colors.textSecondary }]}>{msg.hint}</Text>
      </View>
    );
  };

  // ========== MAIN RENDER ==========

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      {isMobile ? renderMobileHeader() : (
        <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Text style={[styles.backArrow, { color: colors.primary }]}>{'\u2190'}</Text>
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Beraterstatus-Tracker</Text>
        </View>
      )}

      {/* Scan Status */}
      {renderScanStatus()}

      {/* Tabs */}
      {renderTabs()}

      {/* Filters */}
      {isMobile ? renderMobileFilters() : renderFilters()}

      {/* Loading indicator for players */}
      {activeTab === 'alle_spieler' && playersLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Lade Spieler...</Text>
        </View>
      )}

      {/* Tab Content */}
      {activeTab === 'alle_spieler' && (
        isMobile ? (
          <SectionList
            sections={displaySections}
            renderItem={renderMobileListItem}
            renderSectionHeader={renderSectionHeader}
            keyExtractor={(item, index) => item.type === 'club_header' ? `club-${item.clubName}-${index}` : item.player.id}
            extraData={[evaluations, watchlist]}
            ListEmptyComponent={!playersLoading ? renderEmptyState : null}
            contentContainerStyle={[
              styles.cardListContent,
              players.length === 0 && !playersLoading ? styles.emptyContainer : undefined,
            ]}
            stickySectionHeadersEnabled
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={refreshAll} tintColor={colors.primary} />
            }
          />
        ) : (
          <View style={[styles.listCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <SectionList
              sections={displaySections}
              renderItem={renderListItem}
              renderSectionHeader={renderSectionHeader}
              keyExtractor={(item, index) => item.type === 'club_header' ? `club-${item.clubName}-${index}` : item.player.id}
              extraData={[evaluations, watchlist]}
              ListEmptyComponent={!playersLoading ? renderEmptyState : null}
              contentContainerStyle={players.length === 0 && !playersLoading ? styles.emptyContainer : undefined}
              stickySectionHeadersEnabled
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={refreshAll} tintColor={colors.primary} />
              }
            />
          </View>
        )
      )}

      {activeTab === 'beraterwechsel' && (
        isMobile ? (
          <FlatList
            data={filteredChanges}
            renderItem={renderMobileChangeCard}
            keyExtractor={(item) => item.id}
            extraData={[evaluations]}
            ListEmptyComponent={renderEmptyState}
            contentContainerStyle={[
              styles.cardListContent,
              filteredChanges.length === 0 ? styles.emptyContainer : undefined,
            ]}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={refreshAll} tintColor={colors.primary} />
            }
          />
        ) : (
          <View style={[styles.listCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <SectionList
              sections={[{ title: 'changes', data: filteredChanges }]}
              keyExtractor={(item) => item.id}
              extraData={[evaluations]}
              stickySectionHeadersEnabled={true}
              renderSectionHeader={() => (
                <View style={[styles.playerRow, { borderBottomColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
                  <View style={styles.playerRowColumns}>
                    <TouchableOpacity style={styles.playerColNameWrap} onPress={() => toggleChangeSort('name')}>
                      <Text style={[styles.changeHeaderText, { color: changeSortKey === 'name' ? colors.primary : colors.text }]}>
                        Name{changeSortKey === 'name' ? (changeSortAsc ? ' \u25B2' : ' \u25BC') : ''}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.playerColMV} onPress={() => toggleChangeSort('mv')}>
                      <Text style={[styles.changeHeaderText, { color: changeSortKey === 'mv' ? colors.primary : colors.text }]}>
                        MW{changeSortKey === 'mv' ? (changeSortAsc ? ' \u25B2' : ' \u25BC') : ''}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.playerColClub} onPress={() => toggleChangeSort('club')}>
                      <Text style={[styles.changeHeaderText, { color: changeSortKey === 'club' ? colors.primary : colors.text }]}>
                        Verein{changeSortKey === 'club' ? (changeSortAsc ? ' \u25B2' : ' \u25BC') : ''}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.playerColClub} onPress={() => toggleChangeSort('prev_agent')}>
                      <Text style={[styles.changeHeaderText, { color: changeSortKey === 'prev_agent' ? colors.primary : colors.text }]}>
                        Ehem. Berater{changeSortKey === 'prev_agent' ? (changeSortAsc ? ' \u25B2' : ' \u25BC') : ''}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.playerColAgent} onPress={() => toggleChangeSort('new_agent')}>
                      <Text style={[styles.changeHeaderText, { color: changeSortKey === 'new_agent' ? colors.primary : colors.text }]}>
                        Neuer Berater{changeSortKey === 'new_agent' ? (changeSortAsc ? ' \u25B2' : ' \u25BC') : ''}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.changeDate} onPress={() => toggleChangeSort('date')}>
                      <Text style={[styles.changeHeaderText, { color: changeSortKey === 'date' ? colors.primary : colors.text }]}>
                        Datum{changeSortKey === 'date' ? (changeSortAsc ? ' \u25B2' : ' \u25BC') : ''}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
              renderItem={renderChangeRow}
              ListEmptyComponent={renderEmptyState}
              contentContainerStyle={filteredChanges.length === 0 ? styles.emptyContainer : undefined}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={refreshAll} tintColor={colors.primary} />
              }
            />
          </View>
        )
      )}

      {/* Vorschläge Tab */}
      {activeTab === 'vorschlaege' && (
        <View style={{ flex: 1 }}>
          {/* Statistik-Typ Auswahl + Refresh Button */}
          <View style={[styles.suggestionsHeader, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
            <View style={styles.statTypeToggle}>
              <TouchableOpacity
                style={[
                  styles.statTypeButton,
                  suggestionsStatType === 'goals' && { backgroundColor: colors.primary },
                ]}
                onPress={() => setSuggestionsStatType('goals')}
              >
                <Text style={[
                  styles.statTypeButtonText,
                  { color: suggestionsStatType === 'goals' ? colors.primaryText : colors.text }
                ]}>
                  Torschützen
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.statTypeButton,
                  suggestionsStatType === 'assists' && { backgroundColor: colors.primary },
                ]}
                onPress={() => setSuggestionsStatType('assists')}
              >
                <Text style={[
                  styles.statTypeButtonText,
                  { color: suggestionsStatType === 'assists' ? colors.primaryText : colors.text }
                ]} numberOfLines={1}>
                  Vorlagen
                </Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[styles.refreshButton, { borderColor: colors.border }]}
              onPress={handleRefreshRankings}
              disabled={rankingsRefreshing}
            >
              {rankingsRefreshing ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Ionicons name="refresh" size={18} color={colors.primary} />
              )}
              <Text style={[styles.refreshButtonText, { color: colors.primary }]}>
                Rankings aktualisieren
              </Text>
            </TouchableOpacity>
          </View>

          {/* Last Update Info */}
          {rankingsLastUpdate && (
            <Text style={[styles.lastUpdateText, { color: colors.textSecondary }]}>
              Zuletzt aktualisiert: {new Date(rankingsLastUpdate).toLocaleDateString('de-DE', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Text>
          )}

          {/* Loading State */}
          {suggestionsLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
                Lade Vorschläge...
              </Text>
            </View>
          ) : suggestionSections.length === 0 ? (
            <ScrollView
              contentContainerStyle={styles.emptyContainer}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={refreshAll} tintColor={colors.primary} />
              }
            >
              <View style={styles.emptyState}>
                <Ionicons name="analytics-outline" size={48} color={colors.textSecondary} style={{ marginBottom: 12 }} />
                <Text style={[styles.emptyText, { color: colors.text }]}>
                  Keine Vorschläge
                </Text>
                <Text style={[styles.emptyHint, { color: colors.textSecondary }]}>
                  Klicke auf "Rankings aktualisieren" um die neuesten Top-Spieler zu laden
                </Text>
              </View>
            </ScrollView>
          ) : isMobile ? (
            <SectionList
              sections={suggestionSections.map(section => ({
                ...section,
                data: (collapsedSuggestionSections?.has(section.title) ?? true) ? [] : section.data,
              }))}
              keyExtractor={(item) => item.id}
              extraData={[evaluations, watchlist]}
              stickySectionHeadersEnabled={true}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={refreshAll} tintColor={colors.primary} />
              }
              renderSectionHeader={({ section }) => {
                const isCollapsed = collapsedSuggestionSections?.has(section.title) ?? true;
                return (
                  <TouchableOpacity
                    style={[styles.sectionHeader, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
                    onPress={() => toggleSuggestionSection(section.title)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.sectionHeaderLeft}>
                      <Text style={[styles.sectionHeaderArrow, { color: colors.textSecondary }]}>
                        {isCollapsed ? '\u25B6' : '\u25BC'}
                      </Text>
                      <Text style={[styles.sectionHeaderText, { color: colors.text }]}>
                        {section.title}
                      </Text>
                      <Text style={[styles.sectionHeaderCount, { color: colors.textSecondary }]}>
                        {section.count}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              }}
              renderItem={({ item, index }) => renderMobileSuggestionCard({ item, index })}
              contentContainerStyle={styles.cardListContent}
            />
          ) : (
            <View style={[styles.listCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <SectionList
              sections={suggestionSections.map(section => ({
                ...section,
                data: (collapsedSuggestionSections?.has(section.title) ?? true) ? [] : section.data,
              }))}
              keyExtractor={(item) => item.id}
              extraData={[evaluations, watchlist]}
              stickySectionHeadersEnabled={true}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={refreshAll} tintColor={colors.primary} />
              }
              renderSectionHeader={({ section }) => {
                const isCollapsed = collapsedSuggestionSections?.has(section.title) ?? true;
                return (
                  <View style={{ backgroundColor: colors.surfaceSecondary }}>
                    <TouchableOpacity
                      style={[styles.sectionHeader, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
                      onPress={() => toggleSuggestionSection(section.title)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.sectionHeaderLeft}>
                        <Text style={[styles.sectionHeaderArrow, { color: colors.textSecondary }]}>
                          {isCollapsed ? '\u25B6' : '\u25BC'}
                        </Text>
                        <Text style={[styles.sectionHeaderText, { color: colors.text }]}>
                          {section.title}
                        </Text>
                        <Text style={[styles.sectionHeaderCount, { color: colors.textSecondary }]}>
                          {section.count}
                        </Text>
                      </View>
                    </TouchableOpacity>

                    {!isCollapsed && (
                      <View style={[styles.playerRow, { borderBottomColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
                        <View style={styles.playerRowColumns}>
                          <Text style={[styles.playerColNameWrap, styles.columnHeader, { color: colors.textSecondary }]}>Name</Text>
                          <Text style={[styles.playerColClub, styles.columnHeader, { color: colors.textSecondary }]}>Verein</Text>
                          <Text style={[styles.playerColAgent, styles.columnHeader, { color: colors.textSecondary }]}>Berater</Text>
                          <Text style={[styles.suggestionColGames, styles.columnHeader, { color: colors.textSecondary }]}>Spiele</Text>
                          <Text style={[styles.suggestionColStat, styles.columnHeader, { color: colors.textSecondary }]}>
                            {suggestionsStatType === 'goals' ? 'Tore' : 'Vorlagen'}
                          </Text>
                        </View>
                      </View>
                    )}
                  </View>
                );
              }}
              renderItem={({ item, index }) => {
                const age = calculateAge(item.birth_date);
                const agentLabel = getStatAgentLabel(item);
                const evalColor = item.player_id ? getEvalColor(item.player_id) : null;
                return (
                  <TouchableOpacity
                    style={[
                      styles.playerRow,
                      { borderBottomColor: colors.border },
                      evalColor && { backgroundColor: evalColor.bg, borderLeftWidth: 3, borderLeftColor: evalColor.border },
                    ]}
                    onPress={() => openStatDetail(item)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.playerRowColumns}>
                      <View style={styles.playerColNameWrap}>
                        <Text style={[styles.playerColName, { color: colors.text }]} numberOfLines={1}>
                          <Text style={{ color: colors.textSecondary }}>{index + 1}. </Text>
                          {formatNameLastFirst(item.player_name)}
                        </Text>
                        {age ? <Text style={[styles.playerColAge, { color: colors.textSecondary }]}>{age}</Text> : null}
                      </View>
                      <Text style={[styles.playerColClub, { color: colors.textSecondary }]} numberOfLines={1}>
                        {item.club_name || '-'}
                      </Text>
                      <Text style={[styles.playerColAgent, { color: agentLabel.color }]} numberOfLines={1}>
                        {agentLabel.text}
                      </Text>
                      <Text style={[styles.suggestionColGames, { color: colors.textSecondary }]}>
                        {item.games_played ?? '-'}
                      </Text>
                      <Text style={[styles.suggestionColStat, { color: colors.primary, fontWeight: '600' }]}>
                        {item.stat_value}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              }}
            />
            </View>
          )}
        </View>
      )}

      {/* Detail Sheet */}
      {renderDetailSheet()}

      {/* Filter Dropdowns */}
      {renderMultiDropdown(
        showLeaguePicker,
        () => closeDropdown(setShowLeaguePicker),
        leagueOptions,
        selectedLeagues,
        (v) => setSelectedLeagues(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]),
        () => setSelectedLeagues([]),
      )}
      {renderDropdown(
        showAgentPicker,
        () => closeDropdown(setShowAgentPicker),
        agentOptions,
        agentFilter,
        (v) => setAgentFilter(v as AgentFilter),
      )}
      {renderMultiDropdown(
        showAgePicker,
        () => closeDropdown(setShowAgePicker),
        ageOptions,
        selectedAges,
        (v) => setSelectedAges(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]),
        () => setSelectedAges([]),
      )}
    </SafeAreaView>
  );
}

// ============================================================================
// STYLES
// ============================================================================

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
  },

  // Scan Status (Info-Leiste)
  scanStatusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
    gap: 6,
  },
  scanDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  scanStatusText: {
    fontSize: 11,
  },

  // Tabs
  tabContainer: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 6,
  },
  tabMobile: {
    flex: undefined,
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
    paddingHorizontal: 16,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
  },
  tabTextMobile: {
    fontSize: 12,
  },
  tabBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    minWidth: 22,
    alignItems: 'center',
  },
  tabBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },

  // Search (nimmt restlichen Platz in der Filterzeile)
  searchContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 8,
  },
  searchIcon: {
    fontSize: 13,
    marginRight: 4,
  },
  searchInput: {
    flex: 1,
    fontSize: 12,
    paddingVertical: 6,
  },

  // Filters (eine Zeile: Suche links, Filter rechts)
  filterContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    gap: 6,
  },
  filterChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '500',
  },

  // Loading
  loadingOverlay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 8,
  },
  loadingText: {
    fontSize: 13,
  },

  // List card frame (KMH-Style)
  listCard: {
    flex: 1,
    margin: 12,
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },

  // Section headers (Liga-Gruppierung, einklappbar)
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionHeaderArrow: {
    fontSize: 9,
  },
  sectionHeaderText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionHeaderCount: {
    fontSize: 11,
  },

  // Club headers (einklappbare Vereins-Untergruppen)
  clubHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderBottomWidth: 1,
    gap: 6,
  },
  clubHeaderArrow: {
    fontSize: 8,
  },
  clubHeaderText: {
    flex: 1,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  clubHeaderCount: {
    fontSize: 11,
  },

  // Player rows (KMH-Style: single line)
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
    flex: 1.5,
    fontSize: 11,
  },
  changeDate: {
    flex: 1,
    fontSize: 11,
  },
  changeHeaderText: {
    fontSize: 11,
    fontWeight: '600',
  },
  rowArrow: {
    fontSize: 16,
    fontWeight: '300',
    marginLeft: 6,
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
  detailSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingTop: 50,
    paddingBottom: 0,
    maxHeight: '92%',
    minWidth: '100%',
  },
  modalOverlayDesktop: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  detailSheetDesktop: {
    borderRadius: 16,
    minWidth: 0,
    width: 680,
    maxHeight: '90%',
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

  // Filter Dropdowns
  dropdownOverlay: {
    flex: 1,
  },
  dropdownMenu: {
    position: 'absolute',
    borderRadius: 10,
    paddingVertical: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
    borderWidth: 1,
  },
  dropdownItem: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 6,
    marginHorizontal: 4,
  },
  dropdownItemText: {
    fontSize: 14,
  },

  // ===== MOBILE STYLES (KMH Pattern) =====

  mobileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  mobileMenuBtn: {
    width: 40,
    height: 40,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mobileHeaderTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  mobileProfileBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mobileProfileInitials: {
    fontSize: 14,
    fontWeight: '600',
  },
  mobileToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    gap: 8,
  },
  mobileBackBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mobileBackBtnText: {
    fontSize: 14,
    fontWeight: '500',
  },

  // Mobile Filters
  mobileFilterContainer: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  mobileSearchRow: {
    marginBottom: 8,
  },
  mobileChipRow: {
    flexGrow: 0,
  },
  mobileChipRowContent: {
    gap: 6,
  },

  // Mobile Card List
  cardListContent: {
    padding: 12,
    paddingBottom: 20,
  },

  // Mobile Card (KMH: borderRadius 12, padding 14, marginBottom 10)
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
  mobileCardDate: {
    fontSize: 11,
  },
  mobileCardSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  mobileCardClub: {
    fontSize: 12,
    marginBottom: 8,
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
  mobileCardAgentBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  mobileCardAgentText: {
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
  },
  mobileCardDuration: {
    fontSize: 11,
    marginLeft: 8,
  },
  mobileCardChangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
  },
  mobileCardPrevAgent: {
    fontSize: 12,
    flex: 1,
  },
  mobileCardArrow: {
    fontSize: 16,
    fontWeight: '700',
  },
  mobileCardNewAgent: {
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
    textAlign: 'right' as const,
  },

  // Vorschläge Tab
  suggestionsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    flexWrap: 'wrap',
    gap: 8,
  },
  statTypeToggle: {
    flexDirection: 'row',
    borderRadius: 8,
    overflow: 'hidden',
  },
  statTypeButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  statTypeButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  refreshButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
  },
  refreshButtonText: {
    fontSize: 12,
    fontWeight: '500',
  },
  lastUpdateText: {
    fontSize: 11,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    gap: 10,
  },
  suggestionRank: {
    width: 30,
    alignItems: 'center',
  },
  suggestionRankText: {
    fontSize: 14,
    fontWeight: '600',
  },
  suggestionInfo: {
    flex: 1,
  },
  suggestionName: {
    fontSize: 14,
    fontWeight: '600',
  },
  suggestionClub: {
    fontSize: 12,
    marginTop: 2,
  },
  suggestionStat: {
    alignItems: 'center',
    minWidth: 50,
  },
  suggestionStatValue: {
    fontSize: 18,
    fontWeight: '700',
  },
  suggestionStatLabel: {
    fontSize: 10,
  },
  addToWatchlistButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  suggestionColGames: {
    width: 40,
    fontSize: 11,
    textAlign: 'center',
  },
  suggestionColStat: {
    width: 50,
    fontSize: 12,
    textAlign: 'center',
  },
  columnHeader: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
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

  // Eval-Buttons
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
