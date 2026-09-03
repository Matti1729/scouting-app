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
  findAmbiguousMergeCandidates,
  AmbiguousMerge,
  mergeScoutedInto,
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
  { key: 'name', label: 'Name', defaultFlex: 1.6, minWidth: 120 },
  { key: 'alter', label: 'Alter', defaultFlex: 0.8, minWidth: 95 },
  { key: 'mv', label: 'Marktwert', defaultFlex: 0.7, minWidth: 60 },
  { key: 'club', label: 'Verein', defaultFlex: 1.4, minWidth: 80 },
  { key: 'agent', label: 'Berater', defaultFlex: 1.5, minWidth: 80 },
  { key: 'rating', label: 'Pot.', defaultFlex: 0.4, minWidth: 34 },
  { key: 'added', label: 'Hinzugefügt', defaultFlex: 0.7, minWidth: 70 },
];

// "Alle Berichte": gleiche Tabelle wie die Watchlist, statt "Hinzugefügt"
// die Berichte-Anzahl + das Datum des letzten Berichts
const OBSERVED_COLUMNS: ColumnDef[] = [
  { key: 'name', label: 'Name', defaultFlex: 1.6, minWidth: 120 },
  { key: 'alter', label: 'Alter', defaultFlex: 0.8, minWidth: 95 },
  { key: 'mv', label: 'Marktwert', defaultFlex: 0.7, minWidth: 60 },
  { key: 'club', label: 'Verein', defaultFlex: 1.4, minWidth: 80 },
  { key: 'agent', label: 'Berater', defaultFlex: 1.5, minWidth: 80 },
  { key: 'rating', label: 'Pot.', defaultFlex: 0.4, minWidth: 34 },
  { key: 'last', label: 'Letzter Bericht', defaultFlex: 0.8, minWidth: 90 },
];

// Farbe wie im Potential-Schiebebalken (1-3 rot, 4-6 orange, 7-9 grün, 10 gold)
function potentialColor(v: number): string {
  if (v === 10) return '#F0C040';
  if (v >= 7) return '#22c55e';
  if (v >= 4) return '#e8930c';
  return '#dc2626';
}

/** Berichtsdatum ("11.04.2026" oder "2026-08-28") -> Timestamp für die Sortierung */
function reportTs(d: string | null): number {
  if (!d) return 0;
  if (/^\d{4}-\d{2}-\d{2}/.test(d)) return new Date(d.slice(0, 10)).getTime();
  const m = d.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (!m) return 0;
  let year = parseInt(m[3], 10);
  if (year < 100) year += 2000;
  return new Date(year, parseInt(m[2], 10) - 1, parseInt(m[1], 10)).getTime();
}

/** "16 J. (08.03.10)" — Alter + Geburtsdatum kurz für die Alter-Spalte */
function formatAlter(birthDate: string | null): string {
  if (!birthDate) return '–';
  const parts = birthDate.split('.');
  if (parts.length !== 3) return birthDate;
  const birth = new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) {
    age--;
  }
  const short = birthDate.replace(/\.(\d{2})(\d{2})$/, '.$2');
  if (age < 10 || age > 50) return short; // unplausibel -> nur das Datum zeigen
  return `${age} J. (${short})`;
}

/** Berichtsdatum einheitlich deutsch anzeigen */
function formatReportDate(d: string | null): string {
  if (!d) return '–';
  if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10).split('-').reverse().join('.');
  return d;
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

  const table = useTableColumns(WATCHLIST_COLUMNS, tableWidth, 'watchlist_main_v2');
  const observedTable = useTableColumns(OBSERVED_COLUMNS, tableWidth, 'watchlist_observed_v3');
  const matchEvalTable = useTableColumns(MATCH_EVAL_COLUMNS, detailTableWidth, 'watchlist_match_evals');

  // Sort
  type SortKey = 'name' | 'alter' | 'mv' | 'club' | 'agent' | 'added';
  const [sortKey, setSortKey] = useState<SortKey>('added');
  const [sortAsc, setSortAsc] = useState(false); // newest first by default
  // Sortierung "Alle Berichte" (eigener Zustand, Standard: neuester Bericht oben)
  type ObsSortKey = 'name' | 'alter' | 'mv' | 'club' | 'agent' | 'rating' | 'last';
  const [obsSortKey, setObsSortKey] = useState<ObsSortKey>('last');
  const [obsSortAsc, setObsSortAsc] = useState(false);

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

  // Tabs: Watchlist | Zielspieler (aktiv ansprechen) | Alle Berichte
  const [viewTab, setViewTab] = useState<'watchlist' | 'ziel' | 'beobachtet'>('watchlist');
  const [observed, setObserved] = useState<ObservedPlayer[]>([]);
  // Unklare TM-Zuordnungen (mehrere Kandidaten) — der Nutzer ordnet von Hand zu
  const [ambiguous, setAmbiguous] = useState<AmbiguousMerge[]>([]);
  const [ambiguousHidden, setAmbiguousHidden] = useState<Set<string>>(new Set());
  const [assigning, setAssigning] = useState(false);

  const fetchData = useCallback(async () => {
    // Gescoutete Spieler mit später aufgetauchten TM-Datensätzen zusammenführen
    // (z.B. U15 gesichtet, ab U17 bei Transfermarkt gelistet)
    await mergeObservedDuplicates();
    const [data, evals, obs, amb] = await Promise.all([
      loadWatchlist(),
      loadAllEvaluations(),
      loadObservedPlayers(),
      findAmbiguousMergeCandidates(),
    ]);
    setWatchlist(data);
    setEvaluations(evals);
    setObserved(obs);
    setAmbiguous(amb);
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
    // gleiche Regel wie überall: Agentur vor Personenname; "Familienangehörige"
    // wird angezeigt, zählt nur im ohne-Berater-Filter als beraterlos
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
        case 'alter':
          return dir * (reportTs(pA.birth_date) - reportTs(pB.birth_date));
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

  // Zielspieler = alle Top-Ziele (kein eigener Status, spart den Extra-Button)
  const zielList = useMemo(
    () => sortedWatchlist.filter((w) => evaluations.get(w.player_id || '')?.status === 'top_ziel'),
    [sortedWatchlist, evaluations]
  );
  const activeList = viewTab === 'ziel' ? zielList : sortedWatchlist;

  const sortIndicator = (key: SortKey) => sortKey === key ? (sortAsc ? ' \u25B2' : ' \u25BC') : '';

  const toggleObsSort = (key: ObsSortKey) => {
    if (obsSortKey === key) {
      setObsSortAsc(!obsSortAsc);
    } else {
      setObsSortKey(key);
      setObsSortAsc(key === 'name' || key === 'club' || key === 'agent');
    }
  };

  const sortedObserved = useMemo(() => {
    const dir = obsSortAsc ? 1 : -1;
    return [...observed].sort((a, b) => {
      switch (obsSortKey) {
        case 'name':
          return dir * formatNameLastFirst(a.player.player_name).localeCompare(formatNameLastFirst(b.player.player_name), 'de');
        case 'alter':
          return dir * (reportTs(a.player.birth_date) - reportTs(b.player.birth_date));
        case 'mv':
          return dir * (parseMvNumber((a.player as any).market_value || '') - parseMvNumber((b.player as any).market_value || ''));
        case 'club':
          return dir * ((a.player as any).club_name || 'zzz').localeCompare((b.player as any).club_name || 'zzz', 'de');
        case 'agent': {
          const agA = agentDisplayName(a.player.current_agent_name, (a.player as any).current_agent_company) || 'zzz';
          const agB = agentDisplayName(b.player.current_agent_name, (b.player as any).current_agent_company) || 'zzz';
          return dir * agA.localeCompare(agB, 'de');
        }
        case 'rating':
          return dir * ((a.lastRating ?? -1) - (b.lastRating ?? -1));
        case 'last':
          return dir * (reportTs(a.lastMatchDate) - reportTs(b.lastMatchDate));
        default:
          return 0;
      }
    });
  }, [observed, obsSortKey, obsSortAsc]);

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
            <Text style={[styles.mobileCardName, { color: colors.text }]} numberOfLines={1}>
              {formatNameLastFirst(player.player_name)}
            </Text>
            {/* Nur EIN Badge: Top-Ziel (Potential 8+) schlägt Zielspieler */}
            {rating != null && rating >= 8 ? (
              <View style={styles.topZielBadge}>
                <Text style={styles.topZielBadgeText}>TOP-ZIEL</Text>
              </View>
            ) : viewTab !== 'ziel' && ev?.status === 'top_ziel' ? (
              <View style={styles.topZielBadge}>
                <Text style={styles.topZielBadgeText}>ZIELSPIELER</Text>
              </View>
            ) : null}
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
                  <Text style={[styles.playerColName, { color: RETRO.text }]} numberOfLines={1}>
                    {formatNameLastFirst(player.player_name)}
                  </Text>
                  {/* Nur EIN Badge: Top-Ziel (Potential 8+) schlägt Zielspieler */}
                  {rating != null && rating >= 8 ? (
                    <View style={styles.topZielBadge}>
                      <Text style={styles.topZielBadgeText}>TOP-ZIEL</Text>
                    </View>
                  ) : viewTab !== 'ziel' && ev?.status === 'top_ziel' ? (
                    <View style={styles.topZielBadge}>
                      <Text style={styles.topZielBadgeText}>ZIELSPIELER</Text>
                    </View>
                  ) : null}
                </View>
              );
            case 'alter':
              return (
                <Text style={[{ fontSize: 13, color: RETRO.text }]} numberOfLines={1}>
                  {formatAlter(player.birth_date)}
                </Text>
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

  // "Alle Berichte"-Zeile: gleiche Tabellen-Optik wie die Watchlist
  const renderObservedRow = ({ item }: { item: ObservedPlayer }) => {
    const player = item.player;
    const agentLabel = getAgentLabel(player);
    const age = calculateAge(player.birth_date);
    return (
      <TableRow
        columnOrder={observedTable.columnOrder}
        getColumnWidth={observedTable.getColumnWidth}
        onPress={() => openPlayerDetail(player)}
        style={[styles.playerRow, { borderBottomColor: RETRO.rowBorder }]}
        renderCell={(key) => {
          switch (key) {
            case 'name':
              return (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={[styles.playerColName, { color: RETRO.text }]} numberOfLines={1}>
                    {formatNameLastFirst(player.player_name)}
                  </Text>
                  {/* Top-Ziel automatisch ab Potential 8 */}
                  {item.lastRating != null && item.lastRating >= 8 && (
                    <View style={styles.topZielBadge}>
                      <Text style={styles.topZielBadgeText}>TOP-ZIEL</Text>
                    </View>
                  )}
                </View>
              );
            case 'alter':
              return (
                <Text style={[{ fontSize: 13, color: RETRO.text }]} numberOfLines={1}>
                  {formatAlter(player.birth_date)}
                </Text>
              );
            case 'mv':
              return (
                <Text style={styles.monoCell} numberOfLines={1}>
                  {(player as any).market_value || '–'}
                </Text>
              );
            case 'club':
              return (
                <Text style={[{ fontSize: 13, color: RETRO.text, fontStyle: (player as any).is_vereinslos ? 'italic' : 'normal' }]} numberOfLines={1}>
                  {(player as any).is_vereinslos ? `zuletzt: ${(player as any).club_name || ''}` : ((player as any).club_name || '')}
                </Text>
              );
            case 'agent':
              return (
                <Text style={[{ fontSize: 13, color: agentLabel.color }]} numberOfLines={1}>
                  {agentLabel.text}
                </Text>
              );
            case 'rating':
              return item.lastRating != null && item.lastRating > 0 ? (
                <View style={[styles.potBadge, { backgroundColor: potentialColor(item.lastRating) }]}>
                  <Text style={styles.potBadgeText}>{item.lastRating}</Text>
                </View>
              ) : null;
            case 'last':
              return (
                <Text style={styles.monoCell} numberOfLines={1}>
                  {formatReportDate(item.lastMatchDate)}
                </Text>
              );
            default:
              return null;
          }
        }}
      />
    );
  };

  // Manuelle Zuordnung: Bericht-Spieler in den gewählten TM-Datensatz überführen
  const handleAssign = async (scoutedId: string, keeperId: string) => {
    if (assigning) return;
    setAssigning(true);
    const ok = await mergeScoutedInto(scoutedId, keeperId);
    if (ok) await fetchData();
    setAssigning(false);
  };

  // Karte "ZUORDNUNG PRÜFEN": unklare Fälle mit Kandidaten-Buttons
  const renderAmbiguousCard = () => {
    const open = ambiguous.filter((a) => !ambiguousHidden.has(a.scouted.id));
    if (open.length === 0) return null;
    return (
      <View style={[styles.ambigCard, { backgroundColor: colors.surface }, HARD_SHADOW]}>
        <Text style={styles.ambigTitle}>ZUORDNUNG PRÜFEN ({open.length})</Text>
        <Text style={styles.ambigHint}>
          Für diese Bericht-Spieler gibt es mehrere mögliche Transfermarkt-Datensätze. Bitte zuordnen:
        </Text>
        {open.map((a) => (
          <View key={a.scouted.id} style={styles.ambigRow}>
            <Text style={styles.ambigName} numberOfLines={1}>
              {formatNameLastFirst(a.scouted.player_name)}
              {a.scouted.birth_date ? `  (${a.scouted.birth_date})` : ''}
            </Text>
            <View style={styles.ambigCandidates}>
              {a.candidates.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.ambigBtn, HARD_SHADOW, assigning && { opacity: 0.5 }]}
                  onPress={() => handleAssign(a.scouted.id, c.id)}
                  disabled={assigning}
                  activeOpacity={0.7}
                >
                  <Text style={styles.ambigBtnText} numberOfLines={1}>
                    {[
                      `${c.player_name}${(() => { const a = ageFromBirthDate(c.birth_date); return a !== null ? ` (${a} J.)` : ''; })()}`,
                      c.is_vereinslos ? 'vereinslos' : c.club_name,
                    ].filter(Boolean).join(' · ')}
                  </Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={[styles.ambigBtn, HARD_SHADOW]}
                onPress={() =>
                  setAmbiguousHidden((prev) => new Set(prev).add(a.scouted.id))
                }
                activeOpacity={0.7}
              >
                <Text style={[styles.ambigBtnText, { color: colors.textSecondary }]}>Keiner davon</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </View>
    );
  };

  const renderEmpty = () => (
    <View style={styles.emptyState}>
      <Text style={styles.emptyIcon}>⭐</Text>
      <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
        {viewTab === 'ziel' ? 'Noch keine Zielspieler' : 'Watchlist ist leer'}
      </Text>
      <Text style={[styles.emptyHint, { color: colors.textSecondary }]}>
        {viewTab === 'ziel'
          ? 'Markiere Spieler im Spielerprofil als Zielspieler'
          : 'Füge Spieler im Beraterstatus-Tracker zur Watchlist hinzu'}
      </Text>
    </View>
  );


  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header (gelber Titelbalken wie im Dashboard) */}
      <RetroHeader
        title={viewTab === 'beobachtet' ? 'Alle Berichte' : viewTab === 'ziel' ? 'Zielspieler' : 'Watchlist'}
        subtitle={
          viewTab === 'beobachtet'
            ? 'Alle Spieler mit Spielbericht'
            : viewTab === 'ziel'
              ? 'Kandidaten für die Ansprache'
              : 'Markierte Spieler im Blick'
        }
        onBack={() => navigation.goBack()}
        tabs={[
          { key: 'ziel', label: `Zielspieler (${zielList.length})` },
          { key: 'watchlist', label: `Watchlist (${watchlist.length})` },
          { key: 'beobachtet', label: `Berichte (${observed.length})` },
        ]}
        activeTab={viewTab}
        onTabChange={(k) => setViewTab(k as typeof viewTab)}
        right={isMobile ? undefined :
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity
              onPress={() => setViewTab('ziel')}
              style={[styles.headerTab, HARD_SHADOW, viewTab === 'ziel' && styles.headerTabActive]}
              activeOpacity={0.7}
            >
              <Text style={[styles.headerTabText, viewTab === 'ziel' && styles.headerTabTextActive]}>
                {`Zielspieler (${zielList.length})`}
              </Text>
            </TouchableOpacity>
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
                {`Alle Berichte (${observed.length})`}
              </Text>
            </TouchableOpacity>
          </View>
        }
      />

      {/* List */}
      {viewTab === 'beobachtet' && !isMobile ? (
        /* "Alle Berichte" als Tabelle — gleiche Optik wie die Watchlist */
        <>
        {renderAmbiguousCard()}
        <View
          style={[styles.listCard, { backgroundColor: colors.surface }, HARD_SHADOW]}
          onLayout={(e) => setTableWidth(e.nativeEvent.layout.width)}
        >
          {observed.length > 0 && tableWidth > 0 && (
            <TableHeader
              columnDefs={OBSERVED_COLUMNS}
              columnOrder={observedTable.columnOrder}
              getColumnWidth={observedTable.getColumnWidth}
              onResizeStart={observedTable.onResizeStart}
              onDragStart={observedTable.onDragStart}
              resizingKey={observedTable.resizingKey}
              draggingKey={observedTable.draggingKey}
              dragOverKey={observedTable.dragOverKey}
              onSort={(key) => toggleObsSort(key as ObsSortKey)}
              sortKey={obsSortKey}
              sortAsc={obsSortAsc}
              colors={colors}
              setHeaderRef={observedTable.setHeaderRef}
            />
          )}
          <FlatList
            data={sortedObserved}
            renderItem={renderObservedRow}
            keyExtractor={(item) => item.player.id}
            contentContainerStyle={observed.length === 0 && !loading ? styles.emptyContainer : undefined}
            ListEmptyComponent={!loading ? (
              <View style={styles.emptyState}>
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Noch keine Berichte</Text>
                <Text style={[styles.emptyHint, { color: colors.textSecondary }]}>
                  Spieler erscheinen hier, sobald ein Spielbericht zu ihnen gespeichert wurde
                </Text>
              </View>
            ) : null}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
            }
          />
        </View>
        </>
      ) : viewTab === 'beobachtet' ? (
        <FlatList
          data={sortedObserved}
          ListHeaderComponent={renderAmbiguousCard()}
          keyExtractor={(item) => item.player.id}
          contentContainerStyle={observed.length === 0 && !loading ? styles.emptyContainer : { padding: 12 }}
          ListEmptyComponent={!loading ? (
            <View style={styles.emptyState}>
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Noch keine Berichte</Text>
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
                {/* Schriftgrößen wie in den Tabellen (Suchmaschine): Zellen 13 */}
                <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }} numberOfLines={1}>
                  {formatNameLastFirst(item.player.player_name)}
                </Text>
                <Text style={{ fontSize: 13, color: colors.textSecondary, marginTop: 2 }} numberOfLines={1}>
                  {[item.player.club_name, item.player.birth_date, item.player.position].filter(Boolean).join(' · ') || '—'}
                </Text>
              </View>
              {item.lastRating != null && item.lastRating > 0 && (
                <Text style={{ fontSize: 13, fontWeight: '700', color: colors.primary }}>{item.lastRating}/10</Text>
              )}
              <Text style={{ fontSize: 11, fontFamily: MONO, color: colors.textSecondary, minWidth: 70, textAlign: 'right' }}>
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
          data={activeList}
          renderItem={renderMobileCard}
          keyExtractor={(item) => item.id}
          extraData={[evaluations, watchlist]}
          ListEmptyComponent={!loading ? renderEmpty : null}
          contentContainerStyle={[
            styles.mobileListContent,
            activeList.length === 0 && !loading ? styles.emptyContainer : undefined,
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
          {activeList.length > 0 && tableWidth > 0 && (
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
            data={activeList}
            renderItem={renderDesktopRow}
            keyExtractor={(item) => item.id}
            extraData={[evaluations, watchlist, viewTab]}
            ListEmptyComponent={!loading ? renderEmpty : null}
            contentContainerStyle={
              activeList.length === 0 && !loading ? styles.emptyContainer : undefined
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
          onCreateReport={(navParams) => {
            returnToPlayerRef.current = detailPlayer;
            setDetailPlayer(null);
            (navigation as any).navigate('PlayerEvaluation', navParams);
          }}
          onOpenEvaluation={(ev) => {
            returnToPlayerRef.current = detailPlayer;
            setDetailPlayer(null);
            (navigation as any).navigate('PlayerEvaluation', {
              evaluationId: ev.id,
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
    // gleiche Maße wie die Datum-/Initialen-Box im RetroHeader
    backgroundColor: '#ffffff',
    borderRadius: 2,
    paddingVertical: 5,
    paddingHorizontal: 10,
    minHeight: 25,
    alignItems: 'center',
    justifyContent: 'center',
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
    fontSize: 13,
  },
  mobileCardMV: {
    fontSize: 13,
    fontWeight: '500',
  },
  mobileCardRow2: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  mobileCardClubInline: {
    fontSize: 13,
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
    fontSize: 13,
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
    fontSize: 13,
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
  // Berichte-Anzahl ("2×") in der Alle-Berichte-Tabelle
  // "ZUORDNUNG PRÜFEN"-Karte (unklare TM-Zuordnungen)
  ambigCard: {
    borderRadius: 2,
    padding: 12,
    marginBottom: 12,
  },
  ambigTitle: {
    fontSize: 11,
    fontWeight: '700' as const,
    fontFamily: MONO,
    letterSpacing: 1.5,
    color: RETRO.text,
    marginBottom: 4,
  },
  ambigHint: {
    fontSize: 13,
    color: '#4a4a55',
    marginBottom: 8,
  },
  ambigRow: {
    marginBottom: 8,
  },
  ambigName: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: RETRO.text,
    marginBottom: 4,
  },
  ambigCandidates: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 8,
  },
  ambigBtn: {
    backgroundColor: '#e6e2da',
    borderRadius: 0,
    paddingHorizontal: 10,
    paddingVertical: 5,
    minHeight: 24,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  ambigBtnText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: RETRO.text,
  },
  reportCountBadge: {
    backgroundColor: '#2563eb',
    borderRadius: 10,
    minWidth: 26,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignItems: 'center' as const,
    alignSelf: 'flex-start' as const,
  },
  reportCountText: {
    fontSize: 11,
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
    fontSize: 11,
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
    fontSize: 10,
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
