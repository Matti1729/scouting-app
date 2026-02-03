import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Pressable,
  FlatList,
  Modal,
  ScrollView,
  ActivityIndicator,
  Alert,
  useWindowDimensions,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';
import {
  fetchMatchFromUrl,
  fetchLineupsFromUrl,
  isValidFussballDeUrl,
  formatDateForDisplay,
  isMatchFinished,
  MatchData,
  LineupsData,
  PlayerLineupData,
  ScrapeDebug,
} from '../../services/fussballDeService';
import {
  scrapeLineupsFromFussballDe,
  ScrapedPlayer,
} from '../../services/lineupScraperService';
import {
  pickAndExtractLineups,
  MediaSource,
} from '../../services/visionLineupService';
import {
  findBestMatch,
  fetchAgentInfo,
  batchSearchPlayersWithFullInfo,
  batchFetchAgentInfo,
  getTransfermarktSearchUrl,
  TransfermarktAgentInfo,
} from '../../services/transfermarktService';
import { Dropdown } from '../../components/Dropdown';
import { LineupList } from '../../components/LineupList';
import { Player as LineupPlayer } from '../../components/PlayerRow';
import { Linking } from 'react-native';
import {
  loadMatches,
  createMatch,
  updateMatch,
  deleteMatch,
  loadLineups,
  replaceLineup,
  updatePlayer,
  DbMatch,
  DbLineup,
} from '../../services/matchService';
import {
  getRelevantTermine,
  convertToMatchFormat,
  getDFBTermineCount,
  getHallenTermineCount,
  getLastUpdateDisplay,
} from '../../services/dfbTermine';
import { Ionicons } from '@expo/vector-icons';

// Dropdown Optionen
const SPIELART_OPTIONS = [
  { value: 'Punktspiel', label: 'Punktspiel' },
  { value: 'Pokalspiel', label: 'Pokalspiel' },
  { value: 'Freundschaftsspiel', label: 'Freundschaftsspiel' },
  { value: 'Turnier', label: 'Turnier' },
  { value: 'Hallenturnier', label: 'Hallenturnier' },
  { value: 'Nationalmannschaft', label: 'Nationalmannschaft' },
];

const ALTERSKLASSE_OPTIONS = [
  { value: 'U13', label: 'U13' },
  { value: 'U14', label: 'U14' },
  { value: 'U15', label: 'U15' },
  { value: 'U16', label: 'U16' },
  { value: 'U17', label: 'U17' },
  { value: 'U18', label: 'U18' },
  { value: 'U19', label: 'U19' },
  { value: 'U20', label: 'U20' },
  { value: 'U21', label: 'U21' },
  { value: 'Herren', label: 'Herren' },
];

// Types
type SortField = 'datum' | 'zeit' | 'art' | 'spiel' | 'mannschaft' | 'ort';
type SortDirection = 'asc' | 'desc';

interface Match {
  id: string;
  datum: string;
  datumEnde: string | null;
  zeit: string;
  mannschaft: string;
  spiel: string;
  art: string;
  ort: string | null;
  selected?: boolean;
  fussballDeUrl?: string;
  ergebnis?: string;
  isArchived?: boolean;
}

interface Player {
  id: string;
  nummer: string;
  vorname: string;
  name: string;
  jahrgang: string;
  position: string;
  // Transfermarkt-Felder
  transfermarkt_url?: string;
  agent_name?: string;
  agent_company?: string;
  has_agent?: boolean;
  birth_date?: string;  // Vollständiges Geburtsdatum (DD.MM.YYYY) von Transfermarkt
  fussball_de_url?: string;
}

// Leere Aufstellungen - werden erst durch Import oder manuelle Eingabe gefüllt
const INITIAL_LINEUP_HOME: Player[] = [];
const INITIAL_SUBS_HOME: Player[] = [];
const INITIAL_LINEUP_AWAY: Player[] = [];
const INITIAL_SUBS_AWAY: Player[] = [];

// Hilfsfunktion: Alter aus Geburtsdatum berechnen (Format: "DD.MM.YYYY")
const calculateAge = (birthDate: string): number | null => {
  if (!birthDate) return null;
  const parts = birthDate.split('.');
  if (parts.length !== 3) return null;
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1; // JS Monate sind 0-basiert
  const year = parseInt(parts[2], 10);
  if (isNaN(day) || isNaN(month) || isNaN(year)) return null;

  const birth = new Date(year, month, day);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
};

// Hilfsfunktion: Geburtsjahr aus Geburtsdatum oder Jahrgang extrahieren
const getDisplayYear = (player: Player): string => {
  if (player.birth_date) {
    const parts = player.birth_date.split('.');
    if (parts.length === 3) return parts[2];
  }
  return player.jahrgang || '';
};

// Hilfsfunktion: Alter und Jahr für Anzeige formatieren
const getAgeDisplay = (player: Player): string => {
  // Wenn vollständiges Geburtsdatum vorhanden, Alter berechnen
  if (player.birth_date) {
    const age = calculateAge(player.birth_date);
    const year = getDisplayYear(player);
    if (age !== null && year) {
      return `${year}, ${age} J.`;
    }
  }
  // Fallback: nur Jahrgang
  return player.jahrgang || '';
};

// Badge-Farben für Spielarten
const getMatchTypeBadgeStyle = (matchType: string): { backgroundColor: string; color: string } => {
  const type = matchType?.toLowerCase() || '';
  if (type.includes('punktspiel') || type.includes('liga')) {
    return { backgroundColor: '#dbeafe', color: '#1d4ed8' }; // Blau
  }
  if (type.includes('pokal')) {
    return { backgroundColor: '#fef3c7', color: '#b45309' }; // Gold
  }
  if (type.includes('freundschaft') || type.includes('test')) {
    return { backgroundColor: '#f1f5f9', color: '#64748b' }; // Grau
  }
  if (type.includes('turnier') || type.includes('hallen')) {
    return { backgroundColor: '#ede9fe', color: '#7c3aed' }; // Lila
  }
  return { backgroundColor: '#f1f5f9', color: '#64748b' };
};

// Hilfsfunktion: Datum-String parsen (ISO oder deutsches Format)
const parseDateString = (dateStr: string): Date | null => {
  if (!dateStr) return null;
  // ISO Format: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) return date;
  }
  // Deutsches Format: "Sa, 25.01.2026" oder "25.01.2026"
  const germanMatch = dateStr.match(/(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})/);
  if (germanMatch) {
    const day = parseInt(germanMatch[1], 10);
    const month = parseInt(germanMatch[2], 10) - 1;
    let year = parseInt(germanMatch[3], 10);
    if (year < 100) year += 2000;
    return new Date(year, month, day);
  }
  return null;
};

// Prüfen ob Event aktuell läuft (zwischen Start- und Enddatum)
const isEventActive = (startDate: string, endDate: string | null): boolean => {
  if (!startDate) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const start = parseDateString(startDate);
  if (!start) return false;
  start.setHours(0, 0, 0, 0);

  // Wenn kein Enddatum, prüfe nur ob heute = Startdatum
  if (!endDate) {
    return today.getTime() === start.getTime();
  }

  const end = parseDateString(endDate);
  if (!end) return false;
  end.setHours(23, 59, 59, 999);

  // Event läuft wenn heute zwischen Start und Ende liegt
  return today >= start && today <= end;
};

// Prüfen ob Event beendet ist (für Archivierung)
const isEventFinished = (startDate: string, endDate: string | null): boolean => {
  if (!startDate) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Relevantes Datum ist Enddatum oder Startdatum
  const relevantDate = endDate ? parseDateString(endDate) : parseDateString(startDate);
  if (!relevantDate) return false;
  relevantDate.setHours(23, 59, 59, 999);

  // Event ist beendet wenn heute nach dem relevanten Datum liegt
  return today > relevantDate;
};

// Hilfsfunktion: DbMatch zu Match konvertieren
const dbMatchToMatch = (dbMatch: DbMatch): Match => ({
  id: dbMatch.id,
  datum: dbMatch.match_date || '',
  datumEnde: dbMatch.match_date_end || null,
  zeit: dbMatch.match_time || '',
  mannschaft: dbMatch.age_group || 'Herren',
  spiel: dbMatch.away_team
    ? `${dbMatch.home_team} - ${dbMatch.away_team}`
    : dbMatch.home_team, // Für Events ohne Gegner (Lehrgänge etc.)
  art: dbMatch.match_type || 'Punktspiel',
  ort: dbMatch.location || null,
  fussballDeUrl: dbMatch.fussball_de_url || undefined,
  ergebnis: dbMatch.result || undefined,
  isArchived: dbMatch.is_archived,
});

// Deutsches Datumsformat mit Datum-Range Support
const formatDateGerman = (datum: string, datumEnde: string | null): string => {
  if (!datum) return '-';

  const formatShort = (dateStr: string) => {
    const date = parseDateString(dateStr);
    if (!date) return '-';
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear().toString().slice(-2);
    return `${day}.${month}.${year}`;
  };

  if (datumEnde && datumEnde !== datum) {
    const startDate = parseDateString(datum);
    const endDate = parseDateString(datumEnde);
    if (!startDate || !endDate) return formatShort(datum);

    const startDay = startDate.getDate().toString().padStart(2, '0');
    const startMonth = (startDate.getMonth() + 1).toString().padStart(2, '0');

    // Gleicher Monat und Jahr: "08.-18.02.26"
    if (startDate.getMonth() === endDate.getMonth() && startDate.getFullYear() === endDate.getFullYear()) {
      return `${startDay}.-${formatShort(datumEnde)}`;
    }
    // Unterschiedlicher Monat: "28.02.-05.03.26"
    return `${startDay}.${startMonth}.-${formatShort(datumEnde)}`;
  }

  return formatShort(datum);
};

// Hilfsfunktion: DbLineup zu Player konvertieren
const dbLineupToPlayer = (dbLineup: DbLineup): Player => ({
  id: dbLineup.id,
  nummer: dbLineup.nummer || '',
  vorname: dbLineup.vorname || '',
  name: dbLineup.name,
  jahrgang: dbLineup.jahrgang || '',
  position: dbLineup.position || '',
  transfermarkt_url: dbLineup.transfermarkt_url || undefined,
  agent_name: dbLineup.agent_name || undefined,
  agent_company: dbLineup.agent_company || undefined,
  has_agent: dbLineup.has_agent,
  birth_date: dbLineup.birth_date || undefined,
  fussball_de_url: dbLineup.fussball_de_url || undefined,
  isGoalkeeper: dbLineup.is_goalkeeper ?? false,
});

export function MatchListScreen({ navigation }: any) {
  const { colors, isDark } = useTheme();
  const { width } = useWindowDimensions();
  const isMobile = width < 768;
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMatches, setSelectedMatches] = useState<string[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState<Match | null>(null);
  const [shouldReopenModal, setShouldReopenModal] = useState(false);

  // Neues Spiel anlegen / bearbeiten Modal
  const [addMatchModalVisible, setAddMatchModalVisible] = useState(false);
  const [isEditingMatch, setIsEditingMatch] = useState(false);
  const [fussballDeUrl, setFussballDeUrl] = useState('');
  const [isLoadingUrl, setIsLoadingUrl] = useState(false);
  const [urlError, setUrlError] = useState('');
  const [scrapeDebugInfo, setScrapeDebugInfo] = useState<ScrapeDebug | null>(null);

  // Lösch-Bestätigung Modal
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);

  // Spieler hinzufügen Modal
  const [addPlayerModalVisible, setAddPlayerModalVisible] = useState(false);
  const [newPlayerData, setNewPlayerData] = useState({
    vorname: '',
    name: '',
    nummer: '',
    team: 'home' as 'home' | 'away',
  });

  // Bearbeitungsmodus im Aufstellungs-Modal
  const [isEditMode, setIsEditMode] = useState(false);
  const [editedMatchData, setEditedMatchData] = useState({
    homeTeam: '',
    awayTeam: '',
    datum: '',
    zeit: '',
    matchType: 'Punktspiel',
    mannschaft: 'Herren',
  });
  const [editedHomeLineup, setEditedHomeLineup] = useState<Player[]>([]);
  const [editedAwayLineup, setEditedAwayLineup] = useState<Player[]>([]);

  // Aktuelle Aufstellungen (persistiert)
  const [homeLineup, setHomeLineup] = useState<Player[]>(INITIAL_LINEUP_HOME);
  const [awayLineup, setAwayLineup] = useState<Player[]>(INITIAL_LINEUP_AWAY);
  const [homeSubs, setHomeSubs] = useState<Player[]>(INITIAL_SUBS_HOME);
  const [awaySubs, setAwaySubs] = useState<Player[]>(INITIAL_SUBS_AWAY);

  // Bearbeitungsmodus für Auswechselspieler
  const [editedHomeSubs, setEditedHomeSubs] = useState<Player[]>([]);
  const [editedAwaySubs, setEditedAwaySubs] = useState<Player[]>([]);

  // Mobile Team-Tab State
  const [activeTeam, setActiveTeam] = useState<'home' | 'away'>('home');

  // Neue Spiel-Formularfelder
  const [newMatchData, setNewMatchData] = useState({
    homeTeam: '',
    awayTeam: '',
    date: '',
    time: '',
    mannschaft: 'Herren',
    matchType: 'Punktspiel',
    location: '',
  });
  const [matches, setMatches] = useState<Match[]>([]);
  const [isLoadingMatches, setIsLoadingMatches] = useState(true);

  // Aufstellung Import
  const [isLoadingLineups, setIsLoadingLineups] = useState(false);
  const [lineupStatus, setLineupStatus] = useState<'none' | 'loading' | 'available' | 'unavailable'>('none');

  // Archiv-Ansicht
  const [showArchive, setShowArchive] = useState(false);

  // Sortierung
  const [sortField, setSortField] = useState<SortField>('datum');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // DFB-Sync State
  const [dfbSyncLoading, setDfbSyncLoading] = useState(false);
  const [showDfbSyncModal, setShowDfbSyncModal] = useState(false);

  // Spielerprofil-Modal State
  const [playerProfileModalVisible, setPlayerProfileModalVisible] = useState(false);
  const [selectedPlayerForProfile, setSelectedPlayerForProfile] = useState<Player | null>(null);
  const [isLoadingPlayerData, setIsLoadingPlayerData] = useState(false);
  const [playerTmUrl, setPlayerTmUrl] = useState<string | null>(null);
  const [playerAgentInfo, setPlayerAgentInfo] = useState<TransfermarktAgentInfo | null>(null);

  // Transfermarkt Batch-Suche State
  const [isSearchingTM, setIsSearchingTM] = useState(false);
  const [tmSearchProgress, setTmSearchProgress] = useState({ current: 0, total: 0, playerName: '' });

  // Aufstellungen laden Modal
  const [lineupSourceModalVisible, setLineupSourceModalVisible] = useState(false);

  // Modal wieder öffnen wenn man von PlayerEvaluation zurückkommt
  useFocusEffect(
    React.useCallback(() => {
      if (shouldReopenModal && selectedMatch) {
        setModalVisible(true);
        setShouldReopenModal(false);
      }
    }, [shouldReopenModal, selectedMatch])
  );

  // Spiele aus Supabase laden
  const fetchMatches = async () => {
    setIsLoadingMatches(true);
    const result = await loadMatches();
    if (result.success && result.data) {
      setMatches(result.data.map(dbMatchToMatch));
    }
    setIsLoadingMatches(false);
  };

  // Aufstellung für ein Spiel laden
  const fetchLineupForMatch = async (matchId: string) => {
    const result = await loadLineups(matchId);
    if (result.success && result.data) {
      const homePlayers = result.data.filter(p => p.team === 'home');
      const awayPlayers = result.data.filter(p => p.team === 'away');

      setHomeLineup(homePlayers.filter(p => p.is_starter).map(dbLineupToPlayer));
      setHomeSubs(homePlayers.filter(p => !p.is_starter).map(dbLineupToPlayer));
      setAwayLineup(awayPlayers.filter(p => p.is_starter).map(dbLineupToPlayer));
      setAwaySubs(awayPlayers.filter(p => !p.is_starter).map(dbLineupToPlayer));
    } else {
      // Keine Aufstellung vorhanden
      setHomeLineup([]);
      setHomeSubs([]);
      setAwayLineup([]);
      setAwaySubs([]);
    }
  };

  // OPTIMIERTE Transfermarkt-Suche: Findet Spieler UND holt Berater + Geburtsdatum in EINEM Durchgang
  const searchTransfermarktForLineup = async (matchId: string, homeTeam: string, awayTeam: string) => {
    // Alle Spieler aus Supabase laden
    const result = await loadLineups(matchId);
    if (!result.success || !result.data) return;

    const allPlayers = result.data;

    // Spieler ohne TM-URL oder ohne vollständige Profildaten suchen
    // Prüfe auch auf undefined und leere Strings
    // Wenn TM-URL vorhanden aber kein Geburtsdatum/Berater -> Profildaten nachladen
    const playersToSearch = allPlayers.filter(p =>
      !p.transfermarkt_url || !p.agent_name || !p.birth_date
    );
    if (playersToSearch.length === 0) {
      console.log('All players already have TM data');
      return;
    }

    setIsSearchingTM(true);
    setTmSearchProgress({ current: 0, total: playersToSearch.length, playerName: '' });

    try {
      // OPTIMIERTE Batch-Suche: Ein Request pro Spieler für URL + Berater + Geburtsdatum
      const searchResults = await batchSearchPlayersWithFullInfo(
        playersToSearch.map(p => ({
          id: p.id,
          name: p.name,
          vorname: p.vorname || undefined,
          clubHint: p.team === 'home' ? homeTeam : awayTeam,  // Korrekter Verein pro Spieler!
          transfermarkt_url: p.transfermarkt_url,
          agent_name: p.agent_name,
          agent_company: p.agent_company,
          has_agent: p.has_agent,
          birth_date: p.birth_date,
        })),
        (current, total, playerName) => {
          setTmSearchProgress({ current, total, playerName });
        }
      );

      // Alle gefundenen Daten (URL + Berater + Geburtsdatum) in Supabase speichern
      // Speichere auch Teildaten (z.B. nur Agent oder nur Geburtsdatum)
      for (const result of searchResults) {
        if (result.transfermarkt_url || result.agent_name || result.birth_date) {
          await updatePlayer(result.id, {
            transfermarkt_url: result.transfermarkt_url ?? undefined,
            agent_name: result.agent_name ?? undefined,
            agent_company: result.agent_company ?? undefined,
            has_agent: result.has_agent,
            birth_date: result.birth_date ?? undefined,
          });
        }
      }

      // Aufstellung neu laden um UI zu aktualisieren
      await fetchLineupForMatch(matchId);

      const found = searchResults.filter(r => r.transfermarkt_url).length;
      const agents = searchResults.filter(r => r.has_agent).length;
      const withBirthDate = searchResults.filter(r => r.birth_date).length;
      console.log(`TM search complete: ${found}/${searchResults.length} found, ${agents} with agents, ${withBirthDate} with birth_date`);
      console.log('Search results:', JSON.stringify(searchResults, null, 2));

    } catch (err) {
      console.error('TM batch search error:', err);
    } finally {
      setIsSearchingTM(false);
    }
  };

  // Berater-Info für alle Spieler mit TM-URL abrufen
  // Kann eigenständig aufgerufen werden oder als Teil der TM-Suche (dann skipStatusReset=true)
  const fetchAgentInfoForLineup = async (matchId: string, skipStatusReset = false) => {
    // Alle Spieler aus Supabase laden
    const result = await loadLineups(matchId);
    if (!result.success || !result.data) return;

    const allPlayers = result.data;

    // Nur Spieler mit TM-URL aber ohne Berater-Info
    const playersWithTM = allPlayers.filter(p =>
      p.transfermarkt_url &&
      !p.agent_name &&
      p.has_agent !== true
    );

    if (playersWithTM.length === 0) {
      console.log('All players already have agent info or no TM URL');
      return;
    }

    if (!skipStatusReset) {
      setIsSearchingTM(true);
    }
    setTmSearchProgress({ current: 0, total: playersWithTM.length, playerName: 'Berater laden...' });

    try {
      const agentResults = await batchFetchAgentInfo(
        playersWithTM.map(p => ({
          id: p.id,
          name: `${p.vorname || ''} ${p.name}`,
          transfermarkt_url: p.transfermarkt_url,
          agent_name: p.agent_name,
          has_agent: p.has_agent,
        })),
        (current, total, playerName) => {
          setTmSearchProgress({ current, total, playerName: `Berater: ${playerName}` });
        }
      );

      // Berater-Info und Geburtsdatum in Supabase speichern
      for (const result of agentResults) {
        await updatePlayer(result.id, {
          agent_name: result.agent_name ?? undefined,
          agent_company: result.agent_company ?? undefined,
          has_agent: result.has_agent,
          birth_date: result.birth_date ?? undefined,
        });
      }

      // Aufstellung neu laden
      await fetchLineupForMatch(matchId);

      console.log(`Agent fetch complete: ${agentResults.filter(r => r.has_agent).length} agents found`);
    } catch (err) {
      console.error('Agent batch fetch error:', err);
    } finally {
      if (!skipStatusReset) {
        setIsSearchingTM(false);
      }
    }
  };

  // Initial laden
  useEffect(() => {
    fetchMatches();
  }, []);

  // Fussball.de URL laden
  const handleLoadFromUrl = async () => {
    if (!fussballDeUrl.trim()) {
      setUrlError('Bitte eine URL eingeben');
      return;
    }

    if (!isValidFussballDeUrl(fussballDeUrl)) {
      setUrlError('Bitte eine gültige fussball.de URL eingeben');
      return;
    }

    setIsLoadingUrl(true);
    setUrlError('');

    try {
      const result = await fetchMatchFromUrl(fussballDeUrl);

      if (result.success && result.data) {
        setNewMatchData({
          homeTeam: result.data.homeTeam || '',
          awayTeam: result.data.awayTeam || '',
          date: result.data.date || '',
          time: result.data.time || '',
          mannschaft: result.data.ageGroup || 'Herren',
          matchType: result.data.matchType || 'Punktspiel',
          location: result.data.location || '',
        });
        setUrlError('');
        // Debug-Info speichern wenn Ort leer ist
        if (!result.data.location && result.debug) {
          setScrapeDebugInfo(result.debug);
        } else {
          setScrapeDebugInfo(null);
        }
      } else {
        setUrlError(result.error || 'Konnte Daten nicht laden');
        // Debug-Info bei Fehler speichern
        if (result.debug) {
          setScrapeDebugInfo(result.debug);
        }
      }
    } catch (err) {
      setUrlError('Fehler beim Laden der Daten');
    } finally {
      setIsLoadingUrl(false);
    }
  };

  // Neues Spiel erstellen oder bearbeiten
  const handleCreateMatch = async () => {
    if (!newMatchData.homeTeam || !newMatchData.awayTeam) {
      setUrlError('Bitte beide Teams eingeben');
      return;
    }

    if (isEditingMatch && selectedMatch) {
      // Bestehendes Spiel aktualisieren
      const result = await updateMatch(selectedMatch.id, {
        home_team: newMatchData.homeTeam,
        away_team: newMatchData.awayTeam,
        match_date: newMatchData.date || undefined,
        match_time: newMatchData.time || undefined,
        age_group: newMatchData.mannschaft,
        match_type: newMatchData.matchType,
        location: newMatchData.location || undefined,
        fussball_de_url: fussballDeUrl || undefined,
      });

      if (result.success) {
        await fetchMatches(); // Neu laden
      }
    } else {
      // Neues Spiel erstellen
      console.log('Creating match with fussball_de_url:', fussballDeUrl);
      const result = await createMatch({
        home_team: newMatchData.homeTeam,
        away_team: newMatchData.awayTeam,
        match_date: newMatchData.date ? formatDateForDisplay(newMatchData.date) : undefined,
        match_time: newMatchData.time || undefined,
        age_group: newMatchData.mannschaft,
        match_type: newMatchData.matchType,
        location: newMatchData.location || undefined,
        fussball_de_url: fussballDeUrl || undefined,
      });
      console.log('Create match result:', result.success, result.data?.fussball_de_url);

      if (result.success) {
        await fetchMatches(); // Neu laden
      }
    }

    setAddMatchModalVisible(false);
    resetAddMatchForm();
  };

  // Formular zurücksetzen
  const resetAddMatchForm = () => {
    setFussballDeUrl('');
    setUrlError('');
    setIsEditingMatch(false);
    setScrapeDebugInfo(null);
    setNewMatchData({
      homeTeam: '',
      awayTeam: '',
      date: '',
      time: '',
      mannschaft: 'Herren',
      matchType: 'Punktspiel',
      location: '',
    });
  };

  // Sortier-Funktionen
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const getSortIndicator = (field: SortField): string => {
    if (sortField !== field) return '';
    return sortDirection === 'asc' ? ' ▲' : ' ▼';
  };

  const getSortedMatches = (matchList: Match[]): Match[] => {
    return [...matchList].sort((a, b) => {
      let valueA: any, valueB: any;
      switch (sortField) {
        case 'datum':
          // Deutsches Datum korrekt parsen (DD.MM.YY oder DD.MM.YYYY)
          const dateA = parseDateString(a.datum);
          const dateB = parseDateString(b.datum);
          valueA = dateA ? dateA.getTime() : 0;
          valueB = dateB ? dateB.getTime() : 0;
          break;
        case 'zeit':
          valueA = a.zeit || '';
          valueB = b.zeit || '';
          break;
        case 'art':
          valueA = a.art?.toLowerCase() || '';
          valueB = b.art?.toLowerCase() || '';
          break;
        case 'spiel':
          valueA = a.spiel?.toLowerCase() || '';
          valueB = b.spiel?.toLowerCase() || '';
          break;
        case 'mannschaft':
          valueA = a.mannschaft || '';
          valueB = b.mannschaft || '';
          break;
        case 'ort':
          valueA = a.ort?.toLowerCase() || '';
          valueB = b.ort?.toLowerCase() || '';
          break;
        default:
          return 0;
      }
      if (valueA < valueB) return sortDirection === 'asc' ? -1 : 1;
      if (valueA > valueB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  };

  // DFB-Termine synchronisieren
  const handleDFBSync = async () => {
    setDfbSyncLoading(true);
    try {
      const relevantTermine = getRelevantTermine();
      let added = 0;
      let deleted = 0;

      // Zuerst alle existierenden DFB-Typ Matches löschen (Nationalmannschaft & Hallenturnier)
      const dfbMatches = matches.filter(m =>
        m.art === 'Nationalmannschaft' || m.art === 'Hallenturnier'
      );

      for (const match of dfbMatches) {
        const result = await deleteMatch(match.id);
        if (result.success) {
          deleted++;
        }
      }

      // Dann alle neuen Termine hinzufügen
      for (const termin of relevantTermine) {
        const matchData = convertToMatchFormat(termin);

        const result = await createMatch({
          home_team: matchData.home_team,
          away_team: matchData.away_team,
          match_date: matchData.match_date,
          match_date_end: matchData.match_date_end || undefined,
          match_time: matchData.match_time || undefined,
          age_group: matchData.age_group,
          match_type: matchData.match_type,
          location: matchData.location || undefined,
        });

        if (result.success) {
          added++;
        }
      }

      await fetchMatches();
      setShowDfbSyncModal(false);
      Alert.alert(
        'DFB-Sync abgeschlossen',
        `${deleted} alte Einträge gelöscht, ${added} Termine neu geladen`
      );
    } catch (error) {
      console.error('DFB-Sync Fehler:', error);
      Alert.alert('Fehler', 'Fehler beim Synchronisieren der DFB-Termine');
    } finally {
      setDfbSyncLoading(false);
    }
  };

  const toggleMatchSelection = (matchId: string) => {
    setSelectedMatches(prev =>
      prev.includes(matchId)
        ? prev.filter(id => id !== matchId)
        : [...prev, matchId]
    );
  };

  // Alle sichtbaren Spiele auswählen/abwählen
  const toggleSelectAll = () => {
    const visibleMatchIds = filteredMatches.map(m => m.id);
    const allSelected = visibleMatchIds.every(id => selectedMatches.includes(id));

    if (allSelected) {
      // Alle abwählen
      setSelectedMatches(prev => prev.filter(id => !visibleMatchIds.includes(id)));
    } else {
      // Alle auswählen
      setSelectedMatches(prev => [...new Set([...prev, ...visibleMatchIds])]);
    }
  };

  // Kalender-Export (ICS Format)
  const exportSelectedToCalendar = () => {
    const selectedGames = matches.filter(m => selectedMatches.includes(m.id));
    if (selectedGames.length === 0) {
      Alert.alert('Hinweis', 'Bitte wähle mindestens ein Spiel aus.');
      return;
    }

    // ICS Datei erstellen (Format wie KMH-App "Spiele unserer Spieler" mit \r\n)
    let icsContent = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Scouting-App//Spielplan//DE\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\n`;

    selectedGames.forEach(game => {
      // Datum parsen - unterstützt ISO (2026-01-31) und Deutsch (31.01.26)
      const startDate = parseDateString(game.datum);
      if (!startDate) return;

      const dateStr = startDate.getFullYear().toString() +
        (startDate.getMonth() + 1).toString().padStart(2, '0') +
        startDate.getDate().toString().padStart(2, '0');

      // Ende-Datum (für mehrtägige Termine)
      let endDateStr = dateStr;
      if (game.datumEnde) {
        const endDate = parseDateString(game.datumEnde);
        if (endDate) {
          endDateStr = endDate.getFullYear().toString() +
            (endDate.getMonth() + 1).toString().padStart(2, '0') +
            endDate.getDate().toString().padStart(2, '0');
        }
      }

      // Zeit formatieren: HH:MM -> HHMMSS
      let timeStr = '120000'; // Default 12:00
      if (game.zeit && game.zeit !== '-') {
        const timeParts = game.zeit.split(':');
        timeStr = timeParts[0].padStart(2, '0') + (timeParts[1] || '00').padStart(2, '0') + '00';
      }

      // Ende: 2 Stunden nach Start (wie KMH-App)
      const startHour = parseInt(timeStr.substring(0, 2));
      const endHour = (startHour + 2) % 24;
      const endTimeStr = endHour.toString().padStart(2, '0') + timeStr.substring(2);

      icsContent += `BEGIN:VEVENT\r\nDTSTART:${dateStr}T${timeStr}\r\nDTEND:${endDateStr}T${endTimeStr}\r\nSUMMARY:${game.spiel}\r\nDESCRIPTION:${game.art}${game.mannschaft ? ' - ' + game.mannschaft : ''}\r\nLOCATION:${game.ort || ''}\r\nEND:VEVENT\r\n`;
    });

    icsContent += 'END:VCALENDAR';

    // Download (Web)
    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `spiele_${new Date().toISOString().split('T')[0]}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    Alert.alert('Erfolg', `${selectedGames.length} Spiele wurden exportiert.`);

    // Auswahl zurücksetzen
    setSelectedMatches([]);
  };

  const handleMatchPress = async (match: Match) => {
    setSelectedMatch(match);
    setModalVisible(true);
    // Aufstellung aus Supabase laden
    await fetchLineupForMatch(match.id);
  };

  // Ort in Karten-App öffnen (Google Maps / Apple Maps)
  const openLocationInMaps = (location: string) => {
    if (!location) return;

    const encodedLocation = encodeURIComponent(location);

    // Auf iOS Apple Maps bevorzugen, sonst Google Maps
    if (Platform.OS === 'ios') {
      // Apple Maps URL Schema
      const appleUrl = `maps://maps.apple.com/?q=${encodedLocation}`;
      Linking.canOpenURL(appleUrl).then((supported) => {
        if (supported) {
          Linking.openURL(appleUrl);
        } else {
          // Fallback zu Google Maps im Browser
          Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodedLocation}`);
        }
      });
    } else {
      // Android/Web: Google Maps
      Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodedLocation}`);
    }
  };

  const handlePlayerSelect = useCallback(async (player: Player) => {
    if (!selectedMatch) return;

    // Bestimmen ob Spieler von Heim- oder Auswärtsmannschaft
    const [homeTeam, awayTeam] = selectedMatch.spiel.split(' - ') || [];
    const isHomePlayer = homeLineup.some(p => p.id === player.id) || homeSubs.some(p => p.id === player.id);
    const playerClub = isHomePlayer ? homeTeam : awayTeam;

    // TM-URL und Agent-Info suchen wenn noch nicht vorhanden
    let tmUrl = player.transfermarkt_url;

    if (!tmUrl) {
      const fullName = `${player.vorname} ${player.name}`;
      // Vereinsname aus dem aktuellen Spiel für besseres Matching
      const clubHint = playerClub || '';

      console.log('Searching player:', fullName, 'Club:', clubHint);

      // Transfermarkt-Suche mit Vereins-Hint
      const searchResult = await findBestMatch(fullName, clubHint);

      if (searchResult.success && searchResult.player?.profileUrl) {
        tmUrl = searchResult.player.profileUrl;

        // In Supabase speichern
        await updatePlayer(player.id, {
          transfermarkt_url: tmUrl,
        });

        // Agent-Info nachladen
        try {
          const result = await fetchAgentInfo(tmUrl);
          if (result.success && result.agentInfo) {
            await updatePlayer(player.id, {
              agent_name: result.agentInfo.agentName ?? undefined,
              agent_company: result.agentInfo.agentCompany ?? undefined,
              has_agent: result.agentInfo.hasAgent,
              birth_date: result.agentInfo.birthDate ?? undefined,
            });
            // Player-Objekt aktualisieren für Navigation
            player.agent_name = result.agentInfo.agentName ?? undefined;
            player.birth_date = result.agentInfo.birthDate ?? undefined;
          }
        } catch (err) {
          console.error('Fehler beim Laden der Agent-Info:', err);
        }

        // Lokalen State aktualisieren
        const updatePlayerTmData = (players: Player[]): Player[] => {
          return players.map(p =>
            p.id === player.id
              ? {
                  ...p,
                  transfermarkt_url: tmUrl,
                  agent_name: player.agent_name,
                  birth_date: player.birth_date,
                }
              : p
          );
        };
        setHomeLineup(prev => updatePlayerTmData(prev));
        setAwayLineup(prev => updatePlayerTmData(prev));
        setHomeSubs(prev => updatePlayerTmData(prev));
        setAwaySubs(prev => updatePlayerTmData(prev));
      }
    }

    // Direkt zur Spielerbewertung navigieren
    setModalVisible(false);
    setShouldReopenModal(true);
    navigation.navigate('PlayerEvaluation', {
      matchId: selectedMatch.id,
      matchName: selectedMatch.spiel,
      matchDate: selectedMatch.datum,
      mannschaft: selectedMatch.mannschaft,
      playerName: `${player.name}, ${player.vorname}`,
      playerNumber: player.nummer?.replace(/^0+/, '') || '', // Führende Nullen entfernen
      playerPosition: player.position,
      playerBirthYear: player.jahrgang,
      playerBirthDate: player.birth_date || undefined, // Vollständiges Geburtsdatum von TM
      playerClub: playerClub || '', // Vereinsname aus Aufstellung
      transfermarktUrl: tmUrl,
      agentName: player.agent_name || undefined,
    });
  }, [selectedMatch, homeLineup, homeSubs, navigation]);

  // Memoized handlers for field changes in edit mode (combined for lineup + subs)
  const handleHomeFieldChange = useCallback((playerId: string, field: keyof Player, value: string) => {
    // Update in lineup if found there
    setEditedHomeLineup(prev => {
      if (prev.some(p => p.id === playerId)) {
        return prev.map(p => p.id === playerId ? { ...p, [field]: value } : p);
      }
      return prev;
    });
    // Update in subs if found there
    setEditedHomeSubs(prev => {
      if (prev.some(p => p.id === playerId)) {
        return prev.map(p => p.id === playerId ? { ...p, [field]: value } : p);
      }
      return prev;
    });
  }, []);

  const handleAwayFieldChange = useCallback((playerId: string, field: keyof Player, value: string) => {
    // Update in lineup if found there
    setEditedAwayLineup(prev => {
      if (prev.some(p => p.id === playerId)) {
        return prev.map(p => p.id === playerId ? { ...p, [field]: value } : p);
      }
      return prev;
    });
    // Update in subs if found there
    setEditedAwaySubs(prev => {
      if (prev.some(p => p.id === playerId)) {
        return prev.map(p => p.id === playerId ? { ...p, [field]: value } : p);
      }
      return prev;
    });
  }, []);

  const handleNewPlayer = () => {
    if (!selectedMatch) return;
    // Modal schließen aber merken dass es wieder geöffnet werden soll
    setModalVisible(false);
    setShouldReopenModal(true);
    navigation.navigate('PlayerEvaluation', {
      matchId: selectedMatch.id,
      matchName: selectedMatch.spiel,
      matchDate: selectedMatch.datum,
      mannschaft: selectedMatch.mannschaft,
    });
  };

  // Spielerprofil-Modal öffnen und automatisch TM-Daten laden
  const handleOpenPlayerProfile = async (player: Player) => {
    setSelectedPlayerForProfile(player);
    setPlayerTmUrl(player.transfermarkt_url || null);
    setPlayerAgentInfo(null);
    setIsLoadingPlayerData(true);
    setPlayerProfileModalVisible(true);

    try {
      // Wenn noch kein TM-Link vorhanden, suchen
      let tmUrl = player.transfermarkt_url;

      if (!tmUrl) {
        const fullName = `${player.vorname} ${player.name}`;
        // Vereinsname aus dem aktuellen Spiel für besseres Matching
        const [homeTeam, awayTeam] = selectedMatch?.spiel.split(' - ') || [];
        // TODO: Wissen wir ob der Spieler Home oder Away ist? Für jetzt beide probieren
        const clubHint = homeTeam || awayTeam || '';
        const searchResult = await findBestMatch(fullName, clubHint);

        if (searchResult.success && searchResult.player) {
          tmUrl = searchResult.player.profileUrl;
          setPlayerTmUrl(tmUrl);

          // In Supabase speichern
          await updatePlayer(player.id, { transfermarkt_url: tmUrl });

          // Agent-Info nachladen
          try {
            const result = await fetchAgentInfo(tmUrl);
            if (result.success && result.agentInfo) {
              await updatePlayer(player.id, {
                agent_name: result.agentInfo.agentName ?? undefined,
                agent_company: result.agentInfo.agentCompany ?? undefined,
                has_agent: result.agentInfo.hasAgent,
                birth_date: result.agentInfo.birthDate ?? undefined,
              });
              // selectedPlayerForProfile aktualisieren
              setSelectedPlayerForProfile(prev => prev ? {
                ...prev,
                transfermarkt_url: tmUrl,
                agent_name: result.agentInfo?.agentName ?? undefined,
                birth_date: result.agentInfo?.birthDate ?? undefined,
              } : null);
            }
          } catch (err) {
            console.error('Fehler beim Laden der Agent-Info:', err);
          }

          // Lokalen State aktualisieren
          const updatePlayerTmData = (players: Player[]): Player[] => {
            return players.map(p =>
              p.id === player.id ? { ...p, transfermarkt_url: tmUrl } : p
            );
          };
          setHomeLineup(prev => updatePlayerTmData(prev));
          setAwayLineup(prev => updatePlayerTmData(prev));
          setHomeSubs(prev => updatePlayerTmData(prev));
          setAwaySubs(prev => updatePlayerTmData(prev));
        }
      } else if (tmUrl && (!player.agent_name || !player.birth_date)) {
        // URL vorhanden aber Agent-Info fehlt - nachladen
        try {
          const result = await fetchAgentInfo(tmUrl);
          if (result.success && result.agentInfo) {
            await updatePlayer(player.id, {
              agent_name: result.agentInfo.agentName ?? undefined,
              agent_company: result.agentInfo.agentCompany ?? undefined,
              has_agent: result.agentInfo.hasAgent,
              birth_date: result.agentInfo.birthDate ?? undefined,
            });
            // selectedPlayerForProfile aktualisieren
            setSelectedPlayerForProfile(prev => prev ? {
              ...prev,
              agent_name: result.agentInfo?.agentName ?? undefined,
              birth_date: result.agentInfo?.birthDate ?? undefined,
            } : null);
          }
        } catch (err) {
          console.error('Fehler beim Laden der Agent-Info:', err);
        }
      }

      // TM-Link ist jetzt verfügbar
      if (tmUrl) {
        setPlayerTmUrl(tmUrl);
      }
    } catch (err) {
      console.error('Fehler beim Laden der Spielerdaten:', err);
    } finally {
      setIsLoadingPlayerData(false);
    }
  };

  // Transfermarkt-URL öffnen
  const handleOpenTransfermarkt = (url: string) => {
    Linking.openURL(url);
  };

  // Von Spielerprofil zur Bewertung navigieren
  const handleEvaluateFromProfile = () => {
    if (!selectedMatch || !selectedPlayerForProfile) return;
    setPlayerProfileModalVisible(false);
    setModalVisible(false);
    setShouldReopenModal(true);
    navigation.navigate('PlayerEvaluation', {
      matchId: selectedMatch.id,
      matchName: selectedMatch.spiel,
      matchDate: selectedMatch.datum,
      mannschaft: selectedMatch.mannschaft,
      playerName: `${selectedPlayerForProfile.name}, ${selectedPlayerForProfile.vorname}`,
      playerNumber: selectedPlayerForProfile.nummer,
      playerPosition: selectedPlayerForProfile.position,
      playerBirthYear: selectedPlayerForProfile.jahrgang,
      // TM-Daten
      playerBirthDate: selectedPlayerForProfile.birth_date,
      agentName: selectedPlayerForProfile.agent_name,
      transfermarktUrl: selectedPlayerForProfile.transfermarkt_url,
    });
  };

  // Bearbeitungsmodus aktivieren
  const handleEditMatch = () => {
    if (!selectedMatch) return;

    const [homeTeam, awayTeam] = selectedMatch.spiel.split(' - ');

    setEditedMatchData({
      homeTeam: homeTeam || '',
      awayTeam: awayTeam || '',
      datum: selectedMatch.datum,
      zeit: selectedMatch.zeit,
      matchType: selectedMatch.art || 'Punktspiel',
      mannschaft: selectedMatch.mannschaft || 'Herren',
    });

    // Spieleraufstellungen für Bearbeitung kopieren
    setEditedHomeLineup([...homeLineup]);
    setEditedAwayLineup([...awayLineup]);
    setEditedHomeSubs([...homeSubs]);
    setEditedAwaySubs([...awaySubs]);

    setIsEditMode(true);
  };

  // Bearbeitungen speichern
  const handleSaveEditedMatch = async () => {
    if (!selectedMatch) return;

    // In Supabase speichern
    const [homeTeam, awayTeam] = editedMatchData.homeTeam && editedMatchData.awayTeam
      ? [editedMatchData.homeTeam, editedMatchData.awayTeam]
      : selectedMatch.spiel.split(' - ');

    await updateMatch(selectedMatch.id, {
      home_team: homeTeam,
      away_team: awayTeam,
      match_date: editedMatchData.datum || undefined,
      match_time: editedMatchData.zeit || undefined,
      match_type: editedMatchData.matchType,
      age_group: editedMatchData.mannschaft,
    });

    setMatches(prev => prev.map(m => {
      if (m.id === selectedMatch.id) {
        return {
          ...m,
          spiel: `${editedMatchData.homeTeam} - ${editedMatchData.awayTeam}`,
          datum: editedMatchData.datum,
          zeit: editedMatchData.zeit,
          art: editedMatchData.matchType,
          mannschaft: editedMatchData.mannschaft,
        };
      }
      return m;
    }));

    // Spieleraufstellungen speichern
    setHomeLineup([...editedHomeLineup]);
    setAwayLineup([...editedAwayLineup]);
    setHomeSubs([...editedHomeSubs]);
    setAwaySubs([...editedAwaySubs]);

    // Update selectedMatch für die Anzeige
    setSelectedMatch({
      ...selectedMatch,
      spiel: `${editedMatchData.homeTeam} - ${editedMatchData.awayTeam}`,
      datum: editedMatchData.datum,
      zeit: editedMatchData.zeit,
      art: editedMatchData.matchType,
      mannschaft: editedMatchData.mannschaft,
    });

    setIsEditMode(false);
  };

  // Bearbeitung abbrechen
  const handleCancelEdit = () => {
    setIsEditMode(false);
  };

  // Spiel löschen - Bestätigungsdialog öffnen
  const handleDeleteMatch = () => {
    if (!selectedMatch) return;
    setDeleteConfirmVisible(true);
  };

  // Spiel wirklich löschen
  const confirmDeleteMatch = async () => {
    if (!selectedMatch) return;

    // Aus Datenbank löschen
    const result = await deleteMatch(selectedMatch.id);
    if (!result.success) {
      console.error('Fehler beim Löschen:', result.error);
      // Trotzdem UI schließen, aber Fehler loggen
    }

    // Aus lokalem State entfernen
    setMatches(prev => prev.filter(m => m.id !== selectedMatch.id));
    setDeleteConfirmVisible(false);
    setModalVisible(false);
    setSelectedMatch(null);
  };

  // Spieler hinzufügen
  const handleAddPlayer = () => {
    setAddPlayerModalVisible(true);
  };

  // Neuen Spieler speichern
  const handleSaveNewPlayer = () => {
    if (!newPlayerData.name || !newPlayerData.vorname) {
      return;
    }
    // TODO: Spieler zur Aufstellung hinzufügen (wenn Backend implementiert)
    console.log('Neuer Spieler:', newPlayerData);
    setAddPlayerModalVisible(false);
    setNewPlayerData({ vorname: '', name: '', nummer: '', team: 'home' });
  };

  // Aufstellungen von fussball.de importieren und in Supabase speichern
  const handleImportLineups = async () => {
    if (!selectedMatch?.fussballDeUrl) {
      console.log('handleImportLineups: Keine fussballDeUrl vorhanden', {
        selectedMatch: selectedMatch?.id,
        fussballDeUrl: selectedMatch?.fussballDeUrl
      });
      Alert.alert(
        'Keine URL hinterlegt',
        'Für dieses Spiel ist keine fussball.de URL hinterlegt. Bitte Spiel bearbeiten und URL hinzufügen, oder Screenshot importieren.'
      );
      setLineupStatus('unavailable');
      return;
    }

    setIsLoadingLineups(true);
    setLineupStatus('loading');

    try {
      // Hilfsfunktion: Spieler für Supabase vorbereiten
      const preparePlayersForDb = (
        players: { nummer: string; vorname: string; name: string; jahrgang: string; position: string; isGoalkeeper?: boolean }[],
        team: 'home' | 'away',
        isStarter: boolean
      ) => players.map(p => ({
        team,
        is_starter: isStarter,
        nummer: p.nummer,
        vorname: p.vorname,
        name: p.name,
        jahrgang: p.jahrgang,
        position: p.position,
        is_goalkeeper: p.isGoalkeeper ?? false,
      }));

      // 1. Versuche zuerst den Puppeteer-Scraper (wenn Backend konfiguriert)
      const scraperResult = await scrapeLineupsFromFussballDe(selectedMatch.fussballDeUrl);
      console.log('Puppeteer scraper result:', scraperResult.success, scraperResult.error);

      if (scraperResult.success && scraperResult.data?.available) {
        console.log('Aufstellungen via Scraper geladen!');

        const data = scraperResult.data;

        // In Supabase speichern
        const allPlayers = [
          ...preparePlayersForDb(data.homeStarters, 'home', true),
          ...preparePlayersForDb(data.homeSubs, 'home', false),
          ...preparePlayersForDb(data.awayStarters, 'away', true),
          ...preparePlayersForDb(data.awaySubs, 'away', false),
        ];

        const saveResult = await replaceLineup(selectedMatch.id, allPlayers);

        if (saveResult.success) {
          // Aufstellung neu laden (mit korrekten IDs aus DB)
          await fetchLineupForMatch(selectedMatch.id);

          // Transfermarkt-Links automatisch suchen
          const [homeTeam, awayTeam] = selectedMatch.spiel.split(' - ');
          searchTransfermarktForLineup(selectedMatch.id, homeTeam || '', awayTeam || '');
        }

        // Ergebnis speichern wenn vorhanden
        if (data.result) {
          await updateMatch(selectedMatch.id, { result: data.result });
          setMatches(prev => prev.map(m =>
            m.id === selectedMatch.id ? { ...m, ergebnis: data.result } : m
          ));
          setSelectedMatch({ ...selectedMatch, ergebnis: data.result });
        }

        setLineupStatus('available');
        return;
      }

      // 2. Fallback: AJAX-Methode
      console.log('Trying AJAX method for lineups...');
      const result = await fetchLineupsFromUrl(selectedMatch.fussballDeUrl);
      console.log('AJAX result:', JSON.stringify(result, null, 2));

      if (result.success && result.data) {
        if (result.data.available) {
          // In Supabase speichern
          const allPlayers = [
            ...preparePlayersForDb(result.data.homeStarters, 'home', true),
            ...preparePlayersForDb(result.data.homeSubs, 'home', false),
            ...preparePlayersForDb(result.data.awayStarters, 'away', true),
            ...preparePlayersForDb(result.data.awaySubs, 'away', false),
          ];

          const saveResult = await replaceLineup(selectedMatch.id, allPlayers);

          if (saveResult.success) {
            // Aufstellung neu laden (mit korrekten IDs aus DB)
            await fetchLineupForMatch(selectedMatch.id);

            // Transfermarkt-Links automatisch suchen
            const [homeTeam, awayTeam] = selectedMatch.spiel.split(' - ');
            searchTransfermarktForLineup(selectedMatch.id, homeTeam || '', awayTeam || '');
          }

          setLineupStatus('available');
        } else {
          // Ergebnis speichern wenn vorhanden (auch wenn keine Aufstellungen)
          if (result.data.result) {
            await updateMatch(selectedMatch.id, { result: result.data.result });
            setMatches(prev => prev.map(m =>
              m.id === selectedMatch.id ? { ...m, ergebnis: result.data!.result } : m
            ));
            setSelectedMatch({ ...selectedMatch, ergebnis: result.data.result });
          }
          setLineupStatus('unavailable');
        }
      } else {
        setLineupStatus('unavailable');
      }
    } catch (err) {
      console.error('Fehler beim Importieren:', err);
      setLineupStatus('unavailable');
    } finally {
      setIsLoadingLineups(false);
    }
  };

  // Aufstellungen aus Bild/PDF extrahieren
  const handleExtractFromMedia = async (source: MediaSource) => {
    if (!selectedMatch) return;

    setLineupSourceModalVisible(false);
    setIsLoadingLineups(true);
    setLineupStatus('loading');

    try {
      const [homeTeam, awayTeam] = selectedMatch.spiel.split(' - ');

      const result = await pickAndExtractLineups(source, homeTeam, awayTeam);

      if (!result.success || !result.data) {
        if (result.error !== 'Keine Datei ausgewählt') {
          Alert.alert('Fehler', result.error || 'Keine Daten extrahiert');
        }
        setLineupStatus('unavailable');
        return;
      }

      if (!result.data.available) {
        Alert.alert('Hinweis', 'Keine Aufstellung im Bild erkannt');
        setLineupStatus('unavailable');
        return;
      }

      // Spieler für DB vorbereiten (wie bei handleImportLineups)
      const preparePlayersForDb = (
        players: { nummer: string; vorname: string; name: string; jahrgang: string; position: string; isGoalkeeper?: boolean }[],
        team: 'home' | 'away',
        isStarter: boolean
      ) => players.map(p => ({
        team,
        is_starter: isStarter,
        nummer: p.nummer,
        vorname: p.vorname,
        name: p.name,
        jahrgang: p.jahrgang,
        position: p.position,
        is_goalkeeper: p.isGoalkeeper ?? false,
      }));

      const data = result.data;
      const allPlayers = [
        ...preparePlayersForDb(data.homeStarters, 'home', true),
        ...preparePlayersForDb(data.homeSubs, 'home', false),
        ...preparePlayersForDb(data.awayStarters, 'away', true),
        ...preparePlayersForDb(data.awaySubs, 'away', false),
      ];

      const saveResult = await replaceLineup(selectedMatch.id, allPlayers);

      if (saveResult.success) {
        await fetchLineupForMatch(selectedMatch.id);

        searchTransfermarktForLineup(selectedMatch.id, homeTeam || '', awayTeam || '');
      }

      setLineupStatus('available');

    } catch (err) {
      console.error('Vision extraction error:', err);
      Alert.alert('Fehler', 'Bildverarbeitung fehlgeschlagen');
      setLineupStatus('unavailable');
    } finally {
      setIsLoadingLineups(false);
    }
  };

  // Quellenauswahl für Aufstellungen anzeigen
  const handleLoadLineups = () => {
    setLineupSourceModalVisible(true);
  };

  // Spiel archivieren (wenn beendet)
  const archiveFinishedMatches = () => {
    setMatches(prev => prev.map(match => {
      if (!match.isArchived && isMatchFinished(match.datum)) {
        return { ...match, isArchived: true };
      }
      return match;
    }));
  };

  // Archivierung beim Laden prüfen
  React.useEffect(() => {
    archiveFinishedMatches();
  }, []);

  // Filter-Logik
  const filteredMatches = useMemo(() => {
    const filtered = matches.filter(match => {
      const matchesSearch =
        searchQuery === '' ||
        match.spiel.toLowerCase().includes(searchQuery.toLowerCase()) ||
        match.mannschaft.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (match.ort && match.ort.toLowerCase().includes(searchQuery.toLowerCase()));

      // Trenne aktive und archivierte Spiele
      // Event ist archiviert wenn manuell archiviert ODER wenn es beendet ist
      const isArchived = match.isArchived || isEventFinished(match.datum, match.datumEnde);
      const matchesArchiveFilter = showArchive ? isArchived : !isArchived;

      return matchesSearch && matchesArchiveFilter;
    });
    return getSortedMatches(filtered);
  }, [matches, searchQuery, showArchive, sortField, sortDirection]);

  // Anzahl archivierter Spiele
  const archivedCount = matches.filter(m => m.isArchived || isEventFinished(m.datum, m.datumEnde)).length;

  // Desktop: Tabellen-Zeile
  const renderMatchRow = ({ item }: { item: Match }) => {
    const isSelected = selectedMatches.includes(item.id);
    const isActive = isEventActive(item.datum, item.datumEnde);
    const isPast = showArchive;
    const badgeStyle = getMatchTypeBadgeStyle(item.art);

    return (
      <View
        style={[
          styles.row,
          {
            backgroundColor: isActive && !isPast ? (isDark ? '#064e3b' : '#dcfce7') : isPast ? colors.surfaceSecondary : colors.surface,
            borderLeftColor: isSelected ? colors.primary : isActive && !isPast ? '#10b981' : 'transparent',
            borderBottomColor: colors.border,
          },
        ]}
      >
        {/* Checkbox - separate touchable */}
        <Pressable
          style={styles.checkboxCell}
          onPress={() => toggleMatchSelection(item.id)}
        >
          <View
            style={[
              styles.checkbox,
              {
                borderColor: isSelected ? colors.primary : colors.border,
                backgroundColor: isSelected ? colors.primary : 'transparent',
              },
            ]}
          >
            {isSelected && <Text style={styles.checkmark}>✓</Text>}
          </View>
        </Pressable>

        {/* Row content - clickable to open modal */}
        <TouchableOpacity
          style={styles.rowContent}
          onPress={() => handleMatchPress(item)}
          activeOpacity={0.7}
        >
          {/* Datum */}
        <View style={styles.cellDatum}>
          <Text style={[styles.cellText, styles.datumText, { color: colors.text }]} numberOfLines={1}>
            {formatDateGerman(item.datum, item.datumEnde)}
          </Text>
        </View>

        {/* Zeit */}
        <View style={styles.cell}>
          <Text style={[styles.cellText, { color: colors.textSecondary }]}>
            {item.zeit || '-'}
          </Text>
        </View>

        {/* Art mit Badge */}
        <View style={styles.cellArt}>
          <View style={[styles.artBadge, { backgroundColor: badgeStyle.backgroundColor }]}>
            <Text style={[styles.artBadgeText, { color: badgeStyle.color }]}>
              {item.art}
            </Text>
          </View>
        </View>

        {/* Spiel + Ergebnis */}
        <View style={styles.cellSpiel}>
          <View style={styles.spielCell}>
            <Text style={[styles.cellText, { color: colors.text }]} numberOfLines={1}>
              {item.spiel}
            </Text>
            {item.ergebnis && (
              <Text style={[styles.ergebnisText, { color: colors.primary }]}>
                {item.ergebnis}
              </Text>
            )}
          </View>
        </View>

        {/* Mannschaft */}
        <View style={styles.cellMannschaft}>
          <Text style={[styles.cellText, { color: colors.text }]}>
            {item.mannschaft}
          </Text>
        </View>

        {/* Ort (klickbar) */}
        <View style={styles.cellOrt}>
          {item.ort ? (
            <TouchableOpacity onPress={() => openLocationInMaps(item.ort || '')}>
              <Text style={[styles.cellText, { color: colors.accent }]} numberOfLines={1}>
                📍 {item.ort}
              </Text>
            </TouchableOpacity>
          ) : (
            <Text style={[styles.cellText, { color: colors.textSecondary }]} numberOfLines={1}>-</Text>
          )}
        </View>
        </TouchableOpacity>
      </View>
    );
  };

  // Mobile: Card-Layout
  const renderMatchCard = ({ item }: { item: Match }) => {
    const isSelected = selectedMatches.includes(item.id);
    const isActive = isEventActive(item.datum, item.datumEnde);
    const isPast = showArchive;
    const badgeStyle = getMatchTypeBadgeStyle(item.art);

    return (
      <TouchableOpacity
        style={[
          styles.matchCard,
          { backgroundColor: colors.surface, borderColor: colors.border },
          isActive && !isPast && { backgroundColor: isDark ? '#064e3b' : '#dcfce7', borderColor: '#10b981' },
          isPast && { backgroundColor: colors.surfaceSecondary },
        ]}
        onPress={() => handleMatchPress(item)}
        onLongPress={() => toggleMatchSelection(item.id)}
        activeOpacity={0.7}
      >
        {/* Header: Mannschaft-Badge + Art-Badge + Datum */}
        <View style={styles.matchCardHeader}>
          <View style={styles.matchCardBadges}>
            {item.mannschaft && (
              <View style={[styles.matchCardBadge, { backgroundColor: colors.primary }]}>
                <Text style={[styles.matchCardBadgeText, { color: colors.primaryText }]}>{item.mannschaft}</Text>
              </View>
            )}
            {item.art && (
              <View style={[styles.matchCardBadge, { backgroundColor: isPast ? colors.surfaceSecondary : badgeStyle.backgroundColor }]}>
                <Text style={[styles.matchCardBadgeText, { color: isPast ? colors.textSecondary : badgeStyle.color }]}>{item.art}</Text>
              </View>
            )}
          </View>
          <Text style={[styles.matchCardDate, { color: isPast ? colors.textSecondary : colors.textSecondary }]}>
            {formatDateGerman(item.datum, item.datumEnde)}{item.zeit ? `, ${item.zeit}` : ''}
          </Text>
        </View>

        {/* Mitte: Spielpaarung + Ergebnis */}
        <View style={styles.matchCardCenter}>
          <Text style={[styles.matchCardTitle, { color: isPast ? colors.textSecondary : colors.text }]} numberOfLines={2}>
            {item.spiel}
          </Text>
          {item.ergebnis && (
            <Text style={[styles.matchCardResult, { color: colors.primary }]}>
              ({item.ergebnis})
            </Text>
          )}
        </View>

        {/* Footer: Ort (klickbar) + Checkbox */}
        <View style={[styles.matchCardFooter, { borderTopColor: colors.border }]}>
          {item.ort ? (
            <TouchableOpacity
              style={styles.matchCardLocationBtn}
              onPress={() => openLocationInMaps(item.ort || '')}
            >
              <Text style={[styles.matchCardLocation, { color: colors.accent }]} numberOfLines={1}>
                📍 {item.ort}
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={{ flex: 1 }} />
          )}
          <TouchableOpacity
            style={[
              styles.matchCardCheckbox,
              { backgroundColor: colors.surface, borderColor: colors.border },
              isSelected && styles.matchCardCheckboxSelected,
            ]}
            onPress={() => toggleMatchSelection(item.id)}
          >
            {isSelected && <Text style={styles.matchCardCheckmark}>✓</Text>}
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Mobile Header (wie KMH-App) */}
      {isMobile ? (
        <>
          {/* Main Header: Burger | Title | Profile */}
          <View style={[styles.mobileHeader, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
            {/* Burger Menu - exakt wie KMH mit Ionicons */}
            <TouchableOpacity
              style={[styles.mobileMenuBtn, { backgroundColor: colors.surfaceSecondary }]}
              onPress={() => navigation.navigate('Dashboard')}
            >
              <Ionicons name="menu" size={24} color={colors.text} />
            </TouchableOpacity>

            {/* Title */}
            <Text style={[styles.mobileHeaderTitle, { color: colors.text }]}>Spiele-Übersicht</Text>

            {/* Profile Button - exakt wie KMH */}
            <TouchableOpacity
              style={[styles.mobileProfileBtn, { backgroundColor: colors.primary }]}
              onPress={() => navigation.navigate('Dashboard')}
            >
              <Text style={[styles.mobileProfileInitials, { color: colors.primaryText }]}>SC</Text>
            </TouchableOpacity>
          </View>

          {/* Toolbar: Zurück | Checkbox | Sync */}
          <View style={[styles.mobileToolbar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
            {/* Zurück Button - exakt wie KMH */}
            <TouchableOpacity
              style={[styles.mobileBackBtn, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
              onPress={() => navigation.navigate('Dashboard')}
            >
              <Text style={[styles.mobileBackBtnText, { color: colors.textSecondary }]}>← Zurück</Text>
            </TouchableOpacity>

            <View style={{ flex: 1 }} />

            {/* Alle auswählen - exakt wie KMH mit Ionicons */}
            <TouchableOpacity
              style={[
                styles.mobileIconBtn,
                { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
                filteredMatches.length > 0 && filteredMatches.every(m => selectedMatches.includes(m.id)) && styles.mobileIconBtnActive
              ]}
              onPress={toggleSelectAll}
            >
              <Ionicons
                name={filteredMatches.length > 0 && filteredMatches.every(m => selectedMatches.includes(m.id)) ? "checkbox" : "checkbox-outline"}
                size={18}
                color={filteredMatches.length > 0 && filteredMatches.every(m => selectedMatches.includes(m.id)) ? "#fff" : colors.textSecondary}
              />
            </TouchableOpacity>

            {/* DFB-Sync */}
            <TouchableOpacity
              style={[styles.mobileIconBtn, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
              onPress={() => setShowDfbSyncModal(true)}
            >
              <Text style={[styles.mobileIconBtnText, { color: colors.textSecondary }]}>↻</Text>
            </TouchableOpacity>
          </View>

          {/* Toggle: Anstehend | Archiv */}
          <View style={[styles.mobileToggle, { backgroundColor: colors.surfaceSecondary }]}>
            <TouchableOpacity
              style={[styles.mobileToggleBtn, !showArchive && [styles.mobileToggleBtnActive, { backgroundColor: colors.surface }]]}
              onPress={() => setShowArchive(false)}
            >
              <Text style={[styles.mobileToggleBtnText, { color: colors.textSecondary }, !showArchive && { color: colors.text, fontWeight: '600' }]}>
                Anstehend ({matches.filter(m => !m.isArchived && !isMatchFinished(m.datum)).length})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.mobileToggleBtn, showArchive && [styles.mobileToggleBtnActive, { backgroundColor: colors.surface }]]}
              onPress={() => setShowArchive(true)}
            >
              <Text style={[styles.mobileToggleBtnText, { color: colors.textSecondary }, showArchive && { color: colors.text, fontWeight: '600' }]}>
                Archiv ({archivedCount})
              </Text>
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <>
        {/* Desktop: Top Header Bar (wie Mobile) */}
        <View style={[styles.desktopTopHeader, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          {/* Menu Button */}
          <TouchableOpacity
            style={[styles.desktopMenuBtn, { backgroundColor: colors.surfaceSecondary }]}
            onPress={() => navigation.navigate('Dashboard')}
          >
            <Ionicons name="menu" size={24} color={colors.text} />
          </TouchableOpacity>

          {/* Title + Subtitle (zentriert) */}
          <View style={styles.desktopTitleContainer}>
            <Text style={[styles.desktopHeaderTitle, { color: colors.text }]}>Spiele-Übersicht</Text>
            <Text style={[styles.desktopHeaderSubtitle, { color: colors.textSecondary }]}>Termine der nächsten Spiele, Lehrgänge und Turniere</Text>
          </View>

          {/* DFB-Sync Button */}
          <TouchableOpacity
            style={[styles.tab, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
            onPress={() => setShowDfbSyncModal(true)}
          >
            <Text style={[styles.tabText, { color: colors.text }]}>DFB-Termine ↻</Text>
          </TouchableOpacity>
        </View>

        {/* Desktop: Toolbar */}
        <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          {/* Zurück-Button */}
          <TouchableOpacity
            style={[styles.backButton, { backgroundColor: colors.surfaceSecondary }]}
            onPress={() => navigation.navigate('Dashboard')}
          >
            <Text style={[styles.backButtonText, { color: colors.text }]}>←</Text>
          </TouchableOpacity>

          {/* Suchleiste */}
          <View style={[styles.searchContainer, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder }]}>
            <Text style={[styles.searchIcon, { color: colors.textSecondary }]}>🔍</Text>
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Spiel, Mannschaft suchen..."
              placeholderTextColor={colors.textSecondary}
            />
          </View>

          {/* Tab-Leiste: Anstehend | Archiv | + Neues Spiel */}
          <View style={styles.tabBar}>
            {/* Anstehend Tab */}
            <TouchableOpacity
              style={[
                styles.tab,
                !showArchive && styles.tabActive,
                {
                  backgroundColor: !showArchive ? colors.primary : colors.surfaceSecondary,
                  borderColor: !showArchive ? colors.primary : colors.border,
                },
              ]}
              onPress={() => setShowArchive(false)}
            >
              <Text style={[
                styles.tabText,
                { color: !showArchive ? colors.primaryText : colors.text }
              ]}>
                Anstehend ({matches.filter(m => !m.isArchived && !isMatchFinished(m.datum)).length})
              </Text>
            </TouchableOpacity>

            {/* Archiv Tab */}
            <TouchableOpacity
              style={[
                styles.tab,
                showArchive && styles.tabActive,
                {
                  backgroundColor: showArchive ? colors.primary : colors.surfaceSecondary,
                  borderColor: showArchive ? colors.primary : colors.border,
                },
              ]}
              onPress={() => setShowArchive(true)}
            >
              <Text style={[
                styles.tabText,
                { color: showArchive ? colors.primaryText : colors.text }
              ]}>
                Archiv ({archivedCount})
              </Text>
            </TouchableOpacity>

            {/* Neues Spiel Button */}
            <TouchableOpacity
              style={[styles.tab, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
              onPress={() => setAddMatchModalVisible(true)}
            >
              <Text style={[styles.tabText, { color: colors.text }]}>+ Event anlegen</Text>
            </TouchableOpacity>

            {/* Kalender-Export Button (nur wenn Spiele ausgewählt) */}
            {selectedMatches.length > 0 && (
              <TouchableOpacity
                style={[styles.tab, { backgroundColor: '#10b981', borderColor: '#10b981' }]}
                onPress={exportSelectedToCalendar}
              >
                <Text style={[styles.tabText, { color: '#fff' }]}>
                  📅 {selectedMatches.length} exportieren
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
        </>
      )}

      {/* Desktop: Tabellen-Layout */}
      {!isMobile ? (
        <View style={[styles.tableContainer, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          {/* Tabellen-Header */}
          <View style={[styles.tableHeader, { backgroundColor: colors.surfaceSecondary, borderBottomColor: colors.border }]}>
            <TouchableOpacity style={styles.checkboxCell} onPress={toggleSelectAll}>
              <View style={[
                styles.checkbox,
                filteredMatches.length > 0 &&
                filteredMatches.every(m => selectedMatches.includes(m.id)) &&
                { backgroundColor: '#10b981', borderColor: '#10b981' }
              ]}>
                {filteredMatches.length > 0 &&
                 filteredMatches.every(m => selectedMatches.includes(m.id)) && (
                  <Text style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>✓</Text>
                )}
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cellDatum} onPress={() => handleSort('datum')}>
              <Text style={[styles.headerText, { color: colors.textSecondary }]}>DATUM{getSortIndicator('datum')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cell} onPress={() => handleSort('zeit')}>
              <Text style={[styles.headerText, { color: colors.textSecondary }]}>ZEIT{getSortIndicator('zeit')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cellArt} onPress={() => handleSort('art')}>
              <Text style={[styles.headerText, { color: colors.textSecondary }]}>ART{getSortIndicator('art')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cellSpiel} onPress={() => handleSort('spiel')}>
              <Text style={[styles.headerText, { color: colors.textSecondary }]}>BESCHREIBUNG{getSortIndicator('spiel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cellMannschaft} onPress={() => handleSort('mannschaft')}>
              <Text style={[styles.headerText, { color: colors.textSecondary }]}>JAHRGANG{getSortIndicator('mannschaft')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cellOrt} onPress={() => handleSort('ort')}>
              <Text style={[styles.headerText, { color: colors.textSecondary }]}>ORT{getSortIndicator('ort')}</Text>
            </TouchableOpacity>
          </View>

          {/* Tabellen-Inhalt */}
          <FlatList
            data={filteredMatches}
            keyExtractor={(item) => item.id}
            renderItem={renderMatchRow}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                  {showArchive ? 'Keine archivierten Spiele' : 'Keine anstehenden Spiele'}
                </Text>
              </View>
            }
          />
        </View>
      ) : (
        /* Mobile: Card-Layout */
        <>
          <FlatList
            data={filteredMatches}
            keyExtractor={(item) => item.id}
            renderItem={renderMatchCard}
            style={styles.cardList}
            contentContainerStyle={styles.cardListContent}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Text style={styles.emptyIcon}>📅</Text>
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                  {showArchive ? 'Keine archivierten Spiele' : 'Keine anstehenden Spiele'}
                </Text>
                {!showArchive && (
                  <TouchableOpacity
                    style={[styles.emptyButton, { backgroundColor: colors.primary }]}
                    onPress={() => setAddMatchModalVisible(true)}
                  >
                    <Text style={[styles.emptyButtonText, { color: colors.primaryText }]}>Spiel anlegen</Text>
                  </TouchableOpacity>
                )}
              </View>
            }
          />

          {/* Floating Export Button (wenn Spiele ausgewählt) */}
          {selectedMatches.length > 0 && (
            <TouchableOpacity
              style={styles.floatingExportBtn}
              onPress={exportSelectedToCalendar}
            >
              <Text style={styles.floatingExportBtnText}>📅 {selectedMatches.length} exportieren</Text>
            </TouchableOpacity>
          )}

          {/* Floating Add Button */}
          <TouchableOpacity
            style={[styles.floatingAddBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={() => setAddMatchModalVisible(true)}
          >
            <Text style={[styles.floatingAddBtnText, { color: colors.text }]}>+</Text>
          </TouchableOpacity>
        </>
      )}

      {/* Match Detail Modal */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {selectedMatch && (
              <>
                {/* Modal Header */}
                <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
                  <View style={styles.modalHeaderRow}>
                    {/* Left: Mannschaft + Art */}
                    <View style={styles.modalHeaderLeft}>
                      {isEditMode ? (
                        <>
                          <Dropdown
                            options={ALTERSKLASSE_OPTIONS}
                            value={editedMatchData.mannschaft}
                            onChange={(value) => setEditedMatchData(prev => ({ ...prev, mannschaft: value as string }))}
                            placeholder="Altersklasse"
                          />
                          <Dropdown
                            options={SPIELART_OPTIONS}
                            value={editedMatchData.matchType}
                            onChange={(value) => setEditedMatchData(prev => ({ ...prev, matchType: value as string }))}
                            placeholder="Spielart"
                          />
                        </>
                      ) : (
                        <>
                          <View style={[styles.modalBadge, { backgroundColor: colors.primary }]}>
                            <Text style={[styles.modalBadgeText, { color: colors.primaryText }]}>
                              {selectedMatch.mannschaft}
                            </Text>
                          </View>
                          <Text style={[styles.modalArt, { color: colors.textSecondary }]}>
                            {selectedMatch.art}
                          </Text>
                        </>
                      )}
                    </View>

                    {/* Center: Partie oder Edit-Inputs */}
                    {isEditMode ? (
                      <View style={styles.editHeaderCenter}>
                        <TextInput
                          style={[styles.editHeaderInput, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder, color: colors.text }]}
                          value={editedMatchData.homeTeam}
                          onChangeText={(text) => setEditedMatchData(prev => ({ ...prev, homeTeam: text }))}
                          placeholder="Heimmannschaft"
                          placeholderTextColor={colors.textSecondary}
                        />
                        <Text style={[styles.editHeaderVs, { color: colors.textSecondary }]}>-</Text>
                        <TextInput
                          style={[styles.editHeaderInput, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder, color: colors.text }]}
                          value={editedMatchData.awayTeam}
                          onChangeText={(text) => setEditedMatchData(prev => ({ ...prev, awayTeam: text }))}
                          placeholder="Auswärtsmannschaft"
                          placeholderTextColor={colors.textSecondary}
                        />
                      </View>
                    ) : (
                      <Text style={[styles.modalTitle, { color: colors.text }]}>
                        {selectedMatch.spiel}
                      </Text>
                    )}

                    {/* Right: Datum + Zeit + Close */}
                    <View style={styles.modalHeaderRight}>
                      {isEditMode ? (
                        <View style={styles.editDateTimeContainer}>
                          <TextInput
                            style={[styles.editDateInput, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder, color: colors.text }]}
                            value={editedMatchData.datum}
                            onChangeText={(text) => setEditedMatchData(prev => ({ ...prev, datum: text }))}
                            placeholder="Datum"
                            placeholderTextColor={colors.textSecondary}
                          />
                          <TextInput
                            style={[styles.editTimeInput, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder, color: colors.text }]}
                            value={editedMatchData.zeit}
                            onChangeText={(text) => setEditedMatchData(prev => ({ ...prev, zeit: text }))}
                            placeholder="Zeit"
                            placeholderTextColor={colors.textSecondary}
                          />
                        </View>
                      ) : (
                        <View style={styles.modalDateTime}>
                          <Text style={[styles.modalDateText, { color: colors.text }]}>
                            {selectedMatch.datum}
                          </Text>
                          <Text style={[styles.modalTimeText, { color: colors.textSecondary }]}>
                            {selectedMatch.zeit}
                          </Text>
                        </View>
                      )}
                      <TouchableOpacity onPress={() => { setIsEditMode(false); setModalVisible(false); }}>
                        <Text style={[styles.modalClose, { color: colors.textSecondary }]}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>

                {/* Aufstellungen - Zwei Spalten */}
                <View style={styles.modalBody}>
                  {/* Import Button und Status */}
                  {!isEditMode && (
                    <View style={styles.importSection}>
                      <TouchableOpacity
                        style={[styles.importButton, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
                        onPress={handleLoadLineups}
                        disabled={isLoadingLineups}
                      >
                        {isLoadingLineups ? (
                          <ActivityIndicator size="small" color={colors.primary} />
                        ) : (
                          <Text style={[styles.importButtonText, { color: colors.text }]}>
                            Aufstellungen laden
                          </Text>
                        )}
                      </TouchableOpacity>
                      {lineupStatus === 'unavailable' && (
                        <Text style={[styles.lineupStatusText, { color: colors.textSecondary }]}>
                          Keine Aufstellung bei fussball.de. Screenshot importieren oder manuell anlegen.
                        </Text>
                      )}
                      {lineupStatus === 'available' && (
                        <Text style={[styles.lineupStatusText, { color: colors.success || '#22c55e' }]}>
                          Daten erfolgreich importiert!
                        </Text>
                      )}
                      {isSearchingTM && (
                        <View style={styles.tmSearchProgress}>
                          <ActivityIndicator size="small" color={colors.primary} />
                          <Text style={[styles.tmSearchText, { color: colors.textSecondary }]}>
                            TM-Suche: {tmSearchProgress.current}/{tmSearchProgress.total} - {tmSearchProgress.playerName}
                          </Text>
                        </View>
                      )}
                      {selectedMatch.ergebnis && (
                        <View style={[styles.resultBadge, { backgroundColor: colors.primary }]}>
                          <Text style={[styles.resultText, { color: colors.primaryText }]}>
                            Ergebnis: {selectedMatch.ergebnis}
                          </Text>
                        </View>
                      )}
                    </View>
                  )}

                  {/* Mobile: Team-Tabs */}
                  {isMobile && (
                    <View style={styles.teamTabsContainer}>
                      <TouchableOpacity
                        style={[
                          styles.teamTab,
                          activeTeam === 'home' && styles.teamTabActive,
                          activeTeam === 'home' && { borderBottomColor: colors.primary }
                        ]}
                        onPress={() => setActiveTeam('home')}
                      >
                        <Text style={[
                          styles.teamTabText,
                          { color: activeTeam === 'home' ? colors.primary : colors.textSecondary }
                        ]}>
                          {selectedMatch.spiel.split(' - ')[0]}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.teamTab,
                          activeTeam === 'away' && styles.teamTabActive,
                          activeTeam === 'away' && { borderBottomColor: colors.primary }
                        ]}
                        onPress={() => setActiveTeam('away')}
                      >
                        <Text style={[
                          styles.teamTabText,
                          { color: activeTeam === 'away' ? colors.primary : colors.textSecondary }
                        ]}>
                          {selectedMatch.spiel.split(' - ')[1]}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  <View style={[styles.lineupsContainer, isMobile && styles.lineupsContainerMobile]}>
                    {/* Heimmannschaft - Desktop oder wenn auf Mobile activeTeam === 'home' */}
                    {(!isMobile || activeTeam === 'home') && (
                      <View style={[styles.lineupColumn, isMobile && styles.lineupColumnMobile]}>
                        {!isMobile && (
                          isEditMode ? (
                            <TextInput
                              style={[styles.lineupTitleInput, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder, color: colors.text }]}
                              value={editedMatchData.homeTeam}
                              onChangeText={(text) => setEditedMatchData(prev => ({ ...prev, homeTeam: text }))}
                              placeholder="Heimmannschaft"
                              placeholderTextColor={colors.textSecondary}
                            />
                          ) : (
                            <Text style={[styles.lineupTitle, { color: colors.text }]}>
                              {selectedMatch.spiel.split(' - ')[0]}
                            </Text>
                          )
                        )}
                        <LineupList
                          players={isEditMode ? editedHomeLineup : homeLineup}
                          subs={isEditMode ? editedHomeSubs : homeSubs}
                          onPlayerPress={handlePlayerSelect}
                          onFieldChange={isEditMode ? handleHomeFieldChange : undefined}
                          isEditMode={isEditMode}
                          emptyMessage="Keine Spieler vorhanden"
                        />
                      </View>
                    )}

                    {/* Trennlinie - nur auf Desktop */}
                    {!isMobile && <View style={[styles.lineupDivider, { backgroundColor: colors.border }]} />}

                    {/* Auswärtsmannschaft - Desktop oder wenn auf Mobile activeTeam === 'away' */}
                    {(!isMobile || activeTeam === 'away') && (
                      <View style={[styles.lineupColumn, isMobile && styles.lineupColumnMobile]}>
                        {!isMobile && (
                          isEditMode ? (
                            <TextInput
                              style={[styles.lineupTitleInput, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder, color: colors.text }]}
                              value={editedMatchData.awayTeam}
                              onChangeText={(text) => setEditedMatchData(prev => ({ ...prev, awayTeam: text }))}
                              placeholder="Auswärtsmannschaft"
                              placeholderTextColor={colors.textSecondary}
                            />
                          ) : (
                            <Text style={[styles.lineupTitle, { color: colors.text }]}>
                              {selectedMatch.spiel.split(' - ')[1]}
                            </Text>
                          )
                        )}
                        <LineupList
                          players={isEditMode ? editedAwayLineup : awayLineup}
                          subs={isEditMode ? editedAwaySubs : awaySubs}
                          onPlayerPress={handlePlayerSelect}
                          onFieldChange={isEditMode ? handleAwayFieldChange : undefined}
                          isEditMode={isEditMode}
                          emptyMessage="Keine Spieler vorhanden"
                        />
                      </View>
                    )}
                  </View>
                </View>

                {/* Footer */}
                <View style={[styles.modalFooter, { borderTopColor: colors.border }]}>
                  {isEditMode ? (
                    /* Bearbeitungsmodus Footer */
                    <>
                      <TouchableOpacity
                        style={[styles.footerButton, { borderColor: colors.border }]}
                        onPress={handleCancelEdit}
                      >
                        <Text style={[styles.footerButtonText, { color: colors.text }]}>Abbrechen</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.footerButton, { backgroundColor: colors.primary }]}
                        onPress={handleSaveEditedMatch}
                      >
                        <Text style={[styles.footerButtonText, { color: colors.primaryText }]}>Speichern</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    /* Normaler Footer */
                    <>
                      <TouchableOpacity
                        style={[styles.footerButton, { borderColor: colors.error }]}
                        onPress={handleDeleteMatch}
                      >
                        <Text style={[styles.footerButtonText, { color: colors.error }]}>Angelegtes Spiel löschen</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.footerButton, { backgroundColor: colors.primary }]}
                        onPress={handleAddPlayer}
                      >
                        <Text style={[styles.footerButtonText, { color: colors.primaryText }]}>Spieler hinzufügen</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.footerButton, { borderColor: colors.border }]}
                        onPress={handleEditMatch}
                      >
                        <Text style={[styles.footerButtonText, { color: colors.text }]}>Bearbeiten</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Spiel hinzufügen Modal */}
      <Modal
        visible={addMatchModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setAddMatchModalVisible(false);
          resetAddMatchForm();
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.addMatchModalContent, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {/* Modal Header */}
            <View style={[styles.addMatchHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.addMatchTitle, { color: colors.text }]}>
                {isEditingMatch ? 'Spiel bearbeiten' : 'Neues Spiel anlegen'}
              </Text>
              <TouchableOpacity onPress={() => {
                setAddMatchModalVisible(false);
                resetAddMatchForm();
              }}>
                <Text style={[styles.modalClose, { color: colors.textSecondary }]}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.addMatchBody} contentContainerStyle={styles.addMatchBodyContent}>
              {/* Fussball.de URL Eingabe */}
              <View style={styles.urlSection}>
                <Text style={[styles.sectionLabel, { color: colors.text }]}>
                  Von fussball.de importieren
                </Text>
                <View style={styles.urlInputRow}>
                  <TextInput
                    style={[
                      styles.urlInput,
                      {
                        backgroundColor: colors.inputBackground,
                        borderColor: colors.inputBorder,
                        color: colors.text,
                      },
                    ]}
                    value={fussballDeUrl}
                    onChangeText={setFussballDeUrl}
                    placeholder="https://www.fussball.de/spiel/..."
                    placeholderTextColor={colors.textSecondary}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <TouchableOpacity
                    style={[styles.loadUrlButton, { backgroundColor: colors.primary }]}
                    onPress={handleLoadFromUrl}
                    disabled={isLoadingUrl}
                  >
                    {isLoadingUrl ? (
                      <ActivityIndicator size="small" color={colors.primaryText} />
                    ) : (
                      <Text style={[styles.loadUrlButtonText, { color: colors.primaryText }]}>Laden</Text>
                    )}
                  </TouchableOpacity>
                </View>
                {urlError ? (
                  <Text style={[styles.errorText, { color: colors.error || '#e53e3e' }]}>{urlError}</Text>
                ) : null}
              </View>

              {/* Trennlinie */}
              <View style={styles.dividerRow}>
                <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
                <Text style={[styles.dividerText, { color: colors.textSecondary }]}>oder manuell eingeben</Text>
                <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
              </View>

              {/* Manuelle Eingabe */}
              <View style={styles.formSection}>
                {/* 1. Spielart und Altersklasse */}
                <View style={styles.formRow}>
                  <View style={styles.formField}>
                    <Dropdown
                      label="Spielart"
                      options={SPIELART_OPTIONS}
                      value={newMatchData.matchType}
                      onChange={(value) => setNewMatchData(prev => ({ ...prev, matchType: value as string }))}
                      placeholder="Spielart wählen..."
                    />
                  </View>
                  <View style={styles.formField}>
                    <Dropdown
                      label="Altersklasse"
                      options={ALTERSKLASSE_OPTIONS}
                      value={newMatchData.mannschaft}
                      onChange={(value) => setNewMatchData(prev => ({ ...prev, mannschaft: value as string }))}
                      placeholder="Altersklasse wählen..."
                    />
                  </View>
                </View>

                {/* 3. Teams */}
                <View style={styles.formRow}>
                  <View style={styles.formField}>
                    <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Heimmannschaft</Text>
                    <TextInput
                      style={[
                        styles.formInput,
                        {
                          backgroundColor: colors.inputBackground,
                          borderColor: colors.inputBorder,
                          color: colors.text,
                        },
                      ]}
                      value={newMatchData.homeTeam}
                      onChangeText={(text) => setNewMatchData(prev => ({ ...prev, homeTeam: text }))}
                      placeholder="z.B. FC Bayern München"
                      placeholderTextColor={colors.textSecondary}
                    />
                  </View>
                  <View style={styles.formField}>
                    <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Auswärtsmannschaft</Text>
                    <TextInput
                      style={[
                        styles.formInput,
                        {
                          backgroundColor: colors.inputBackground,
                          borderColor: colors.inputBorder,
                          color: colors.text,
                        },
                      ]}
                      value={newMatchData.awayTeam}
                      onChangeText={(text) => setNewMatchData(prev => ({ ...prev, awayTeam: text }))}
                      placeholder="z.B. TSV 1860 München"
                      placeholderTextColor={colors.textSecondary}
                    />
                  </View>
                </View>

                {/* 4. Datum und Zeit */}
                <View style={styles.formRow}>
                  <View style={styles.formField}>
                    <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Datum</Text>
                    <TextInput
                      style={[
                        styles.formInput,
                        {
                          backgroundColor: colors.inputBackground,
                          borderColor: colors.inputBorder,
                          color: colors.text,
                        },
                      ]}
                      value={newMatchData.date}
                      onChangeText={(text) => setNewMatchData(prev => ({ ...prev, date: text }))}
                      placeholder="TT.MM.JJJJ"
                      placeholderTextColor={colors.textSecondary}
                    />
                  </View>
                  <View style={styles.formField}>
                    <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Uhrzeit</Text>
                    <TextInput
                      style={[
                        styles.formInput,
                        {
                          backgroundColor: colors.inputBackground,
                          borderColor: colors.inputBorder,
                          color: colors.text,
                        },
                      ]}
                      value={newMatchData.time}
                      onChangeText={(text) => setNewMatchData(prev => ({ ...prev, time: text }))}
                      placeholder="HH:MM"
                      placeholderTextColor={colors.textSecondary}
                    />
                  </View>
                </View>

                {/* 5. Ort */}
                <View style={styles.formRow}>
                  <View style={[styles.formField, { flex: 1 }]}>
                    <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Ort</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <TextInput
                        style={[
                          styles.formInput,
                          {
                            backgroundColor: colors.inputBackground,
                            borderColor: colors.inputBorder,
                            color: colors.text,
                            flex: 1,
                          },
                        ]}
                        value={newMatchData.location}
                        onChangeText={(text) => setNewMatchData(prev => ({ ...prev, location: text }))}
                        placeholder="z.B. Allianz Arena, München"
                        placeholderTextColor={colors.textSecondary}
                      />
                      {/* Debug-Button wenn Ort leer und Debug-Info vorhanden */}
                      {!newMatchData.location && scrapeDebugInfo && (
                        <TouchableOpacity
                          style={{
                            backgroundColor: colors.warning,
                            paddingHorizontal: 10,
                            paddingVertical: 8,
                            borderRadius: 6,
                          }}
                          onPress={() => {
                            Alert.alert(
                              'Debug: HTML-Snippet',
                              `URL: ${scrapeDebugInfo.url}\n\nVerwendete Patterns: ${scrapeDebugInfo.foundPatterns?.join(', ') || 'keine'}\n\nHTML um location:\n${scrapeDebugInfo.locationHtml || scrapeDebugInfo.htmlSnippet || 'Kein HTML verfügbar'}`,
                              [{ text: 'OK' }]
                            );
                          }}
                        >
                          <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>🔍 HTML</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                </View>
              </View>
            </ScrollView>

            {/* Footer */}
            <View style={[styles.addMatchFooter, { borderTopColor: colors.border }]}>
              <TouchableOpacity
                style={[styles.cancelButton, { borderColor: colors.border }]}
                onPress={() => {
                  setAddMatchModalVisible(false);
                  resetAddMatchForm();
                }}
              >
                <Text style={[styles.cancelButtonText, { color: colors.text }]}>Abbrechen</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.createButton, { backgroundColor: colors.primary }]}
                onPress={handleCreateMatch}
              >
                <Text style={[styles.createButtonText, { color: colors.primaryText }]}>
                  {isEditingMatch ? 'Speichern' : 'Spiel anlegen'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* DFB-Sync Modal */}
      <Modal
        visible={showDfbSyncModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDfbSyncModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.confirmModal, { backgroundColor: colors.surface, borderColor: colors.border, maxWidth: 500 }]}>
            <Text style={[styles.confirmTitle, { color: colors.text }]}>🇩🇪 DFB-Termine laden</Text>
            <Text style={[styles.confirmText, { color: colors.textSecondary, marginBottom: 16 }]}>
              Lädt {getDFBTermineCount()} DFB-Nationalmannschaftstermine und {getHallenTermineCount()} Hallenturniere.
            </Text>
            <Text style={[{ color: colors.textSecondary, fontSize: 12, marginBottom: 16, textAlign: 'center' }]}>
              Daten: Lehrgänge, EM-Quali, Länderspiele, Sichtungen, Hallenturniere{'\n'}
              Jahrgänge: U13 - U21{'\n'}
              Stand: {getLastUpdateDisplay()}
            </Text>
            <View style={styles.confirmButtons}>
              <TouchableOpacity
                style={[styles.confirmButton, { borderColor: colors.border }]}
                onPress={() => setShowDfbSyncModal(false)}
              >
                <Text style={[styles.confirmButtonText, { color: colors.text }]}>Abbrechen</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmButton, { backgroundColor: colors.primary }]}
                onPress={handleDFBSync}
                disabled={dfbSyncLoading}
              >
                {dfbSyncLoading ? (
                  <ActivityIndicator size="small" color={colors.primaryText} />
                ) : (
                  <Text style={[styles.confirmButtonText, { color: colors.primaryText }]}>Termine laden</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Lösch-Bestätigung Modal */}
      <Modal
        visible={deleteConfirmVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteConfirmVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.confirmModal, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.confirmTitle, { color: colors.text }]}>Spiel löschen</Text>
            <Text style={[styles.confirmText, { color: colors.textSecondary }]}>
              Möchtest du das Spiel "{selectedMatch?.spiel}" wirklich löschen?
            </Text>
            <View style={styles.confirmButtons}>
              <TouchableOpacity
                style={[styles.confirmButton, { borderColor: colors.border }]}
                onPress={() => setDeleteConfirmVisible(false)}
              >
                <Text style={[styles.confirmButtonText, { color: colors.text }]}>Abbrechen</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmButton, { backgroundColor: colors.error }]}
                onPress={confirmDeleteMatch}
              >
                <Text style={[styles.confirmButtonText, { color: '#fff' }]}>Löschen</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Spieler hinzufügen Modal */}
      <Modal
        visible={addPlayerModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setAddPlayerModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.addPlayerModal, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={[styles.addPlayerHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.addPlayerTitle, { color: colors.text }]}>Spieler hinzufügen</Text>
              <TouchableOpacity onPress={() => setAddPlayerModalVisible(false)}>
                <Text style={[styles.modalClose, { color: colors.textSecondary }]}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.addPlayerBody}>
              {/* Mannschaftsauswahl */}
              <View style={styles.addPlayerField}>
                <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Mannschaft</Text>
                <View style={styles.teamSelectRow}>
                  <TouchableOpacity
                    style={[
                      styles.teamSelectButton,
                      {
                        backgroundColor: newPlayerData.team === 'home' ? colors.primary : colors.surfaceSecondary,
                        borderColor: newPlayerData.team === 'home' ? colors.primary : colors.border,
                      },
                    ]}
                    onPress={() => setNewPlayerData(prev => ({ ...prev, team: 'home' }))}
                  >
                    <Text style={[
                      styles.teamSelectText,
                      { color: newPlayerData.team === 'home' ? colors.primaryText : colors.text }
                    ]}>
                      {selectedMatch?.spiel.split(' - ')[0] || 'Heimmannschaft'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.teamSelectButton,
                      {
                        backgroundColor: newPlayerData.team === 'away' ? colors.primary : colors.surfaceSecondary,
                        borderColor: newPlayerData.team === 'away' ? colors.primary : colors.border,
                      },
                    ]}
                    onPress={() => setNewPlayerData(prev => ({ ...prev, team: 'away' }))}
                  >
                    <Text style={[
                      styles.teamSelectText,
                      { color: newPlayerData.team === 'away' ? colors.primaryText : colors.text }
                    ]}>
                      {selectedMatch?.spiel.split(' - ')[1] || 'Auswärtsmannschaft'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.addPlayerField}>
                <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Vorname</Text>
                <TextInput
                  style={[
                    styles.formInput,
                    {
                      backgroundColor: colors.inputBackground,
                      borderColor: colors.inputBorder,
                      color: colors.text,
                    },
                  ]}
                  value={newPlayerData.vorname}
                  onChangeText={(text) => setNewPlayerData(prev => ({ ...prev, vorname: text }))}
                  placeholder="Vorname"
                  placeholderTextColor={colors.textSecondary}
                />
              </View>

              <View style={styles.addPlayerField}>
                <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Nachname</Text>
                <TextInput
                  style={[
                    styles.formInput,
                    {
                      backgroundColor: colors.inputBackground,
                      borderColor: colors.inputBorder,
                      color: colors.text,
                    },
                  ]}
                  value={newPlayerData.name}
                  onChangeText={(text) => setNewPlayerData(prev => ({ ...prev, name: text }))}
                  placeholder="Nachname"
                  placeholderTextColor={colors.textSecondary}
                />
              </View>

              <View style={styles.addPlayerField}>
                <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Trikotnummer</Text>
                <TextInput
                  style={[
                    styles.formInput,
                    {
                      backgroundColor: colors.inputBackground,
                      borderColor: colors.inputBorder,
                      color: colors.text,
                    },
                  ]}
                  value={newPlayerData.nummer}
                  onChangeText={(text) => setNewPlayerData(prev => ({ ...prev, nummer: text }))}
                  placeholder="z.B. 10"
                  placeholderTextColor={colors.textSecondary}
                  keyboardType="number-pad"
                />
              </View>
            </View>

            <View style={[styles.addPlayerFooter, { borderTopColor: colors.border }]}>
              <TouchableOpacity
                style={[styles.confirmButton, { borderColor: colors.border }]}
                onPress={() => {
                  setAddPlayerModalVisible(false);
                  setNewPlayerData({ vorname: '', name: '', nummer: '', team: 'home' });
                }}
              >
                <Text style={[styles.confirmButtonText, { color: colors.text }]}>Abbrechen</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmButton, { backgroundColor: colors.primary }]}
                onPress={handleSaveNewPlayer}
              >
                <Text style={[styles.confirmButtonText, { color: colors.primaryText }]}>Hinzufügen</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Spielerprofil Modal */}
      <Modal
        visible={playerProfileModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPlayerProfileModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.playerProfileModal, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {selectedPlayerForProfile && (
              <>
                {/* Header mit Berater-Status oben rechts */}
                <View style={[styles.playerProfileHeader, { borderBottomColor: colors.border }]}>
                  <View style={styles.playerProfileHeaderLeft}>
                    <View style={[styles.playerProfileNumber, { backgroundColor: colors.primary }]}>
                      <Text style={[styles.playerProfileNumberText, { color: colors.primaryText }]}>
                        {selectedPlayerForProfile.nummer}
                      </Text>
                    </View>
                    <View>
                      <Text style={[styles.playerProfileName, { color: colors.text }]}>
                        {selectedPlayerForProfile.vorname} {selectedPlayerForProfile.name}
                      </Text>
                      <Text style={[styles.playerProfileMeta, { color: colors.textSecondary }]}>
                        {selectedPlayerForProfile.position ? `${selectedPlayerForProfile.position} • ` : ''}
                        {selectedPlayerForProfile.jahrgang ? `Jg. ${selectedPlayerForProfile.jahrgang}` : ''}
                      </Text>
                    </View>
                  </View>

                  {/* Berater-Status oben rechts */}
                  <View style={styles.playerProfileHeaderRight}>
                    {isLoadingPlayerData ? (
                      <View style={[styles.agentBadgeLoading, { backgroundColor: colors.surfaceSecondary }]}>
                        <ActivityIndicator size="small" color={colors.textSecondary} />
                      </View>
                    ) : playerAgentInfo?.hasAgent ? (
                      <View style={[styles.agentBadge, { backgroundColor: '#fef3c7', borderColor: '#f59e0b' }]}>
                        <Text style={[styles.agentBadgeLabel, { color: '#92400e' }]}>Berater</Text>
                        <Text style={[styles.agentBadgeName, { color: '#78350f' }]} numberOfLines={1}>
                          {playerAgentInfo.agentName || 'Vorhanden'}
                        </Text>
                        {playerAgentInfo.agentCompany && (
                          <Text style={[styles.agentBadgeCompany, { color: '#a16207' }]} numberOfLines={1}>
                            {playerAgentInfo.agentCompany}
                          </Text>
                        )}
                      </View>
                    ) : !isLoadingPlayerData && playerTmUrl ? (
                      <View style={[styles.agentBadge, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
                        <Text style={[styles.agentBadgeLabel, { color: colors.textSecondary }]}>Berater</Text>
                        <Text style={[styles.agentBadgeName, { color: colors.text }]}>Kein Berater</Text>
                      </View>
                    ) : null}

                    <TouchableOpacity onPress={() => setPlayerProfileModalVisible(false)}>
                      <Text style={[styles.modalClose, { color: colors.textSecondary }]}>✕</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Body */}
                <View style={styles.playerProfileBody}>
                  {/* Transfermarkt Link */}
                  <View style={styles.playerProfileSection}>
                    <Text style={[styles.playerProfileSectionTitle, { color: colors.text }]}>
                      Transfermarkt
                    </Text>

                    {isLoadingPlayerData ? (
                      <View style={[styles.tmLoadingContainer, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
                        <ActivityIndicator size="small" color={colors.primary} />
                        <Text style={[styles.tmLoadingText, { color: colors.textSecondary }]}>
                          Suche auf Transfermarkt...
                        </Text>
                      </View>
                    ) : playerTmUrl ? (
                      <TouchableOpacity
                        style={[styles.tmLinkButton, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
                        onPress={() => handleOpenTransfermarkt(playerTmUrl)}
                      >
                        <Text style={[styles.tmLinkText, { color: colors.primary }]}>
                          Transfermarkt-Profil öffnen
                        </Text>
                        <Text style={[styles.tmLinkArrow, { color: colors.primary }]}>→</Text>
                      </TouchableOpacity>
                    ) : (
                      <View style={[styles.tmNotFoundContainer, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
                        <Text style={[styles.tmNotFoundText, { color: colors.textSecondary }]}>
                          Kein Transfermarkt-Profil gefunden
                        </Text>
                        <TouchableOpacity
                          style={[styles.tmManualSearchButton, { borderColor: colors.primary }]}
                          onPress={() => {
                            const fullName = `${selectedPlayerForProfile.vorname} ${selectedPlayerForProfile.name}`;
                            Linking.openURL(getTransfermarktSearchUrl(fullName));
                          }}
                        >
                          <Text style={[styles.tmManualSearchText, { color: colors.primary }]}>
                            Manuell suchen
                          </Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>

                  {/* fussball.de Link wenn vorhanden */}
                  {selectedPlayerForProfile.fussball_de_url && (
                    <View style={styles.playerProfileSection}>
                      <Text style={[styles.playerProfileSectionTitle, { color: colors.text }]}>
                        fussball.de
                      </Text>
                      <TouchableOpacity
                        style={[styles.tmLinkButton, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
                        onPress={() => Linking.openURL(selectedPlayerForProfile.fussball_de_url!)}
                      >
                        <Text style={[styles.tmLinkText, { color: colors.primary }]}>
                          fussball.de-Profil öffnen
                        </Text>
                        <Text style={[styles.tmLinkArrow, { color: colors.primary }]}>→</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>

                {/* Footer */}
                <View style={[styles.playerProfileFooter, { borderTopColor: colors.border }]}>
                  <TouchableOpacity
                    style={[styles.playerProfileCancelButton, { borderColor: colors.border }]}
                    onPress={() => setPlayerProfileModalVisible(false)}
                  >
                    <Text style={[styles.playerProfileCancelText, { color: colors.text }]}>
                      Schließen
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.playerProfileEvaluateButton, { backgroundColor: colors.primary }]}
                    onPress={handleEvaluateFromProfile}
                  >
                    <Text style={[styles.playerProfileEvaluateText, { color: colors.primaryText }]}>
                      Spieler bewerten
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Aufstellungen laden - Quellenauswahl Modal */}
      <Modal
        visible={lineupSourceModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setLineupSourceModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.sourceModalContent, { backgroundColor: colors.surface }]}>
            <Text style={[styles.sourceModalTitle, { color: colors.text }]}>
              Aufstellungen laden
            </Text>

            {selectedMatch?.fussballDeUrl ? (
              <TouchableOpacity
                style={[styles.sourceOption, { borderColor: colors.border }]}
                onPress={() => {
                  setLineupSourceModalVisible(false);
                  handleImportLineups();
                }}
              >
                <Text style={[styles.sourceOptionText, { color: colors.text }]}>
                  Von fussball.de laden
                </Text>
                <Text style={[styles.sourceOptionSubtext, { color: colors.textSecondary }]}>
                  Automatisch aus fussball.de extrahieren
                </Text>
              </TouchableOpacity>
            ) : (
              <View style={[styles.sourceOption, { borderColor: colors.border, opacity: 0.6 }]}>
                <Text style={[styles.sourceOptionText, { color: colors.textSecondary }]}>
                  Keine fussball.de URL hinterlegt
                </Text>
                <Text style={[styles.sourceOptionSubtext, { color: colors.textSecondary }]}>
                  Beim Erstellen des Spiels die URL eingeben, oder Screenshot nutzen
                </Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.sourceOption, { borderColor: colors.border }]}
              onPress={() => handleExtractFromMedia('camera')}
            >
              <Text style={[styles.sourceOptionText, { color: colors.text }]}>
                Foto aufnehmen
              </Text>
              <Text style={[styles.sourceOptionSubtext, { color: colors.textSecondary }]}>
                Aufstellung fotografieren
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.sourceOption, { borderColor: colors.border }]}
              onPress={() => handleExtractFromMedia('gallery')}
            >
              <Text style={[styles.sourceOptionText, { color: colors.text }]}>
                Bild auswählen
              </Text>
              <Text style={[styles.sourceOptionSubtext, { color: colors.textSecondary }]}>
                Screenshot oder Foto aus Galerie
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.sourceOption, { borderColor: colors.border }]}
              onPress={() => handleExtractFromMedia('document')}
            >
              <Text style={[styles.sourceOptionText, { color: colors.text }]}>
                PDF/Dokument hochladen
              </Text>
              <Text style={[styles.sourceOptionSubtext, { color: colors.textSecondary }]}>
                PDF-Dokument mit Aufstellung
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.sourceModalCancelButton, { backgroundColor: colors.surfaceSecondary }]}
              onPress={() => setLineupSourceModalVisible(false)}
            >
              <Text style={[styles.sourceModalCancelButtonText, { color: colors.text }]}>
                Abbrechen
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    borderBottomWidth: 1,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backButtonText: {
    fontSize: 18,
    fontWeight: '500',
  },
  searchContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 36,
  },
  searchIcon: {
    marginRight: 8,
    fontSize: 14,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    height: '100%',
  },
  // Mobile Header Styles (wie KMH-App)
  mobileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  mobileMenuBtn: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mobileMenuIcon: {
    fontSize: 20,
    color: '#1a1a1a',
  },
  mobileHeaderTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  desktopTitleContainer: {
    flex: 1,
    alignItems: 'center',
  },
  desktopHeaderTitle: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  desktopHeaderSubtitle: {
    fontSize: 13,
    marginTop: 2,
    textAlign: 'center',
  },
  desktopTopHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  desktopMenuBtn: {
    width: 40,
    height: 40,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  desktopProfileBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  desktopProfileInitials: {
    fontSize: 14,
    fontWeight: '600',
  },
  mobileProfileBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mobileProfileInitials: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  mobileToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    gap: 8,
  },
  // Exakt wie KMH: mobileGamesToolbarBtn
  mobileBackBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Exakt wie KMH: mobileGamesToolbarBtnText
  mobileBackBtnText: {
    fontSize: 14,
    color: '#64748b',
    fontWeight: '500',
  },
  mobileToolbarBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mobileToolbarBtnText: {
    fontSize: 14,
    color: '#64748b',
    fontWeight: '500',
  },
  mobileIconBtn: {
    width: 40,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mobileIconBtnActive: {
    backgroundColor: '#1a1a1a',
    borderColor: '#1a1a1a',
  },
  mobileIconBtnText: {
    fontSize: 18,
    color: '#64748b',
  },
  toolbarCheckbox: {
    width: 16,
    height: 16,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#64748b',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  toolbarCheckboxSelected: {
    backgroundColor: 'transparent',
    borderColor: '#fff',
  },
  toolbarCheckmark: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
    marginTop: -1,
  },
  mobileToggle: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderRadius: 8,
    padding: 4,
    marginHorizontal: 12,
    marginTop: 12,
  },
  mobileToggleBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 6,
  },
  mobileToggleBtnActive: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  mobileToggleBtnText: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '500',
  },
  floatingExportBtn: {
    position: 'absolute',
    bottom: 80,
    left: 20,
    right: 20,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#10b981',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  floatingExportBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  floatingAddBtn: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 8,
  },
  floatingAddBtnText: {
    color: '#1a1a1a',
    fontSize: 22,
    fontWeight: '300',
  },
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
  },
  headerText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tableContainer: {
    flex: 1,
    margin: 16,
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  // Card List Styles
  cardList: {
    flex: 1,
  },
  cardListContent: {
    padding: 12,
    paddingBottom: 80,
  },
  // Match Card Styles (wie KMH-App "Weitere Termine")
  matchCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    minHeight: 80,
    justifyContent: 'space-between',
  },
  matchCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  matchCardBadges: {
    flexDirection: 'row',
    gap: 4,
    flexWrap: 'wrap',
    flex: 1,
  },
  matchCardBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  matchCardBadgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  matchCardDate: {
    fontSize: 12,
    color: '#64748b',
    marginLeft: 8,
  },
  matchCardCenter: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  matchCardTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1a1a1a',
    textAlign: 'center',
  },
  matchCardResult: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  matchCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  matchCardLocationBtn: {
    flex: 1,
    marginRight: 8,
  },
  matchCardLocation: {
    fontSize: 12,
  },
  matchCardCheckbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  matchCardCheckboxSelected: {
    backgroundColor: '#10b981',
    borderColor: '#10b981',
  },
  matchCardCheckmark: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  // Empty State
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 15,
    color: '#64748b',
    marginBottom: 16,
  },
  emptyButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  emptyButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  // Legacy (for compatibility)
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderLeftWidth: 3,
  },
  rowContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkboxCell: {
    width: 40,
    alignItems: 'center',
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmark: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  cell: {
    flex: 1,
    paddingHorizontal: 6,
  },
  cellDatum: {
    flex: 1,
    paddingHorizontal: 6,
  },
  cellMannschaft: {
    flex: 1.5,
    paddingHorizontal: 6,
  },
  cellSpiel: {
    flex: 2.5,
    paddingHorizontal: 6,
  },
  cellArt: {
    flex: 1,
    paddingHorizontal: 6,
  },
  cellOrt: {
    flex: 1.5,
    paddingHorizontal: 6,
  },
  cellText: {
    fontSize: 13,
  },
  datumText: {
    fontWeight: '500',
  },
  artBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  artBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  spielCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  ergebnisText: {
    fontSize: 12,
    fontWeight: '600',
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    width: '95%',
    maxWidth: 1200,
    maxHeight: '90%',
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  modalHeader: {
    padding: 20,
    borderBottomWidth: 1,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  modalHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalDateTime: {
    alignItems: 'flex-end',
  },
  modalDateText: {
    fontSize: 14,
    fontWeight: '600',
  },
  modalTimeText: {
    fontSize: 13,
  },
  modalArt: {
    fontSize: 13,
  },
  modalBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  modalBadgeText: {
    fontSize: 13,
    fontWeight: '700',
  },
  modalClose: {
    fontSize: 24,
    fontWeight: '300',
    padding: 4,
  },
  // Edit Mode Styles
  editHeaderCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 2,
    justifyContent: 'center',
  },
  editHeaderInput: {
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderRadius: 6,
    fontSize: 14,
    textAlign: 'center',
  },
  editHeaderVs: {
    fontSize: 16,
    fontWeight: '600',
  },
  editDateTimeContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  editDateInput: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderRadius: 4,
    fontSize: 13,
    width: 90,
    textAlign: 'center',
  },
  editTimeInput: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderRadius: 4,
    fontSize: 13,
    width: 60,
    textAlign: 'center',
  },
  lineupTitleInput: {
    fontSize: 16,
    fontWeight: '600',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: 6,
    marginBottom: 8,
    textAlign: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    flex: 2,
  },
  modalBody: {
    flex: 1,
    padding: 16,
  },
  lineupsContainer: {
    flexDirection: 'row',
    flex: 1,
  },
  lineupsContainerMobile: {
    flexDirection: 'column',
  },
  teamTabsContainer: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    marginBottom: 12,
  },
  teamTab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  teamTabActive: {
    borderBottomWidth: 2,
  },
  teamTabText: {
    fontSize: 14,
    fontWeight: '600',
  },
  lineupColumn: {
    flex: 1,
    paddingHorizontal: 8,
  },
  lineupColumnMobile: {
    paddingHorizontal: 0,
  },
  lineupDivider: {
    width: 1,
    marginHorizontal: 16,
  },
  lineupTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 12,
  },
  lineupList: {
    flex: 1,
  },
  noPlayersText: {
    fontSize: 14,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 20,
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
  },
  playerNumber: {
    width: 26,
    height: 26,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  playerNumberText: {
    fontSize: 11,
    fontWeight: '700',
  },
  playerInfo: {
    flex: 1,
  },
  playerNameDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  playerName: {
    fontSize: 13,
    fontWeight: '500',
  },
  playerJahrgang: {
    fontSize: 11,
  },
  playerAgent: {
    fontSize: 10,
    fontWeight: '500',
    marginLeft: 4,
  },
  playerPosition: {
    fontSize: 11,
    marginTop: 1,
  },
  subsTitle: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 12,
    marginBottom: 6,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.1)',
  },
  playerArrow: {
    fontSize: 16,
    fontWeight: '300',
  },
  tmBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 8,
  },
  tmBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  playerNumberInput: {
    width: 34,
    height: 26,
    borderRadius: 4,
    borderWidth: 1,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '700',
    marginRight: 8,
    paddingHorizontal: 2,
  },
  playerNameInput: {
    flex: 1,
    fontSize: 12,
    fontWeight: '500',
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderWidth: 1,
    borderRadius: 4,
  },
  playerNameRow: {
    flexDirection: 'row',
    gap: 6,
    flex: 1,
  },
  modalFooter: {
    padding: 16,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  footerButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  // Tab-Leiste Styles
  tabBar: {
    flexDirection: 'row',
    gap: 8,
  },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabActive: {
    // Active styles werden inline gesetzt
  },
  tabText: {
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
  // Import Section
  importSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 12,
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
    flexWrap: 'wrap',
  },
  importButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  importButtonText: {
    fontSize: 13,
    fontWeight: '500',
  },
  lineupStatusText: {
    fontSize: 13,
    fontStyle: 'italic',
  },
  tmSearchProgress: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 8,
  },
  tmSearchText: {
    fontSize: 12,
    fontStyle: 'italic',
  },
  resultBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    marginLeft: 'auto',
  },
  resultText: {
    fontSize: 14,
    fontWeight: '700',
  },
  // Add Match Modal Styles
  addMatchModalContent: {
    width: '95%',
    maxWidth: 700,
    maxHeight: '90%',
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  addMatchHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
  },
  addMatchTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  addMatchBody: {
    flex: 1,
  },
  addMatchBodyContent: {
    padding: 20,
    gap: 20,
  },
  urlSection: {
    gap: 10,
  },
  sectionLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  urlInputRow: {
    flexDirection: 'row',
    gap: 10,
  },
  urlInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  loadUrlButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    justifyContent: 'center',
    minWidth: 80,
    alignItems: 'center',
  },
  loadUrlButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  errorText: {
    fontSize: 13,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    fontSize: 13,
  },
  formSection: {
    gap: 16,
  },
  formRow: {
    flexDirection: 'row',
    gap: 16,
  },
  formField: {
    flex: 1,
    gap: 6,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  formInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '500',
  },
  addMatchFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    padding: 16,
    borderTopWidth: 1,
  },
  cancelButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  createButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  createButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  // Bestätigungs-Modal Styles
  confirmModal: {
    width: '90%',
    maxWidth: 400,
    borderRadius: 12,
    borderWidth: 1,
    padding: 24,
  },
  confirmTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  confirmText: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 24,
    textAlign: 'center',
  },
  confirmButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  confirmButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  confirmButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  // Spieler hinzufügen Modal Styles
  addPlayerModal: {
    width: '90%',
    maxWidth: 450,
    borderRadius: 12,
    borderWidth: 1,
  },
  addPlayerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
  },
  addPlayerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  addPlayerBody: {
    padding: 20,
    gap: 16,
  },
  addPlayerField: {
    gap: 6,
  },
  addPlayerFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    padding: 16,
    borderTopWidth: 1,
  },
  teamSelectRow: {
    flexDirection: 'row',
    gap: 12,
  },
  teamSelectButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  teamSelectText: {
    fontSize: 14,
    fontWeight: '500',
  },
  // Spielerprofil Modal Styles
  playerProfileModal: {
    width: '90%',
    maxWidth: 500,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  playerProfileHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
  },
  playerProfileHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flex: 1,
  },
  playerProfileHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  agentBadge: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    maxWidth: 160,
  },
  agentBadgeLoading: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
  },
  agentBadgeLabel: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  agentBadgeName: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },
  agentBadgeCompany: {
    fontSize: 11,
    marginTop: 1,
  },
  playerProfileNumber: {
    width: 48,
    height: 48,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playerProfileNumberText: {
    fontSize: 20,
    fontWeight: '700',
  },
  playerProfileName: {
    fontSize: 20,
    fontWeight: '700',
  },
  playerProfileMeta: {
    fontSize: 14,
    marginTop: 2,
  },
  playerProfileBody: {
    padding: 20,
    gap: 24,
  },
  playerProfileSection: {
    gap: 12,
  },
  playerProfileSectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tmLinkContainer: {
    gap: 8,
  },
  tmLinkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
  },
  tmLinkText: {
    fontSize: 15,
    fontWeight: '500',
  },
  tmLinkArrow: {
    fontSize: 18,
    fontWeight: '600',
  },
  tmLoadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 10,
    borderWidth: 1,
  },
  tmLoadingText: {
    fontSize: 14,
  },
  tmNotFoundContainer: {
    padding: 16,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    gap: 12,
  },
  tmNotFoundText: {
    fontSize: 14,
  },
  tmManualSearchButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
  },
  tmManualSearchText: {
    fontSize: 14,
    fontWeight: '500',
  },
  playerProfileFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    padding: 16,
    borderTopWidth: 1,
  },
  playerProfileCancelButton: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 1,
  },
  playerProfileCancelText: {
    fontSize: 14,
    fontWeight: '500',
  },
  playerProfileEvaluateButton: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  playerProfileEvaluateText: {
    fontSize: 14,
    fontWeight: '600',
  },
  // Aufstellungen laden - Quellenauswahl Modal Styles
  sourceModalContent: {
    width: '85%',
    maxWidth: 400,
    borderRadius: 12,
    padding: 20,
  },
  sourceModalTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
    textAlign: 'center',
  },
  sourceOption: {
    padding: 16,
    borderWidth: 1,
    borderRadius: 8,
    marginBottom: 12,
  },
  sourceOptionText: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 4,
  },
  sourceOptionSubtext: {
    fontSize: 13,
  },
  sourceModalCancelButton: {
    padding: 14,
    borderRadius: 8,
    marginTop: 4,
    alignItems: 'center',
  },
  sourceModalCancelButtonText: {
    fontSize: 16,
    fontWeight: '500',
  },
});
