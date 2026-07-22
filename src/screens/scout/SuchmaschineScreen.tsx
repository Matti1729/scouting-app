import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  ActivityIndicator,
  Linking,
  Platform,
  Modal,
  ScrollView,
  TouchableWithoutFeedback,
  useWindowDimensions,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import {
  StipendiumEntry,
  StipendiumSearchPlayer,
  PlayerTmDetails,
  loadStipendiumEntries,
  addStipendiumEntry,
  searchStipendiumPlayers,
  fetchPlayerTmDetails,
} from '../../services/stipendiumService';
import { loadLeagues, loadWatchlist, addToWatchlist } from '../../services/beraterService';
import { ColumnDef } from '../../types/tableColumns';
import { useTableColumns } from '../../hooks/useTableColumns';
import { TableHeader } from '../../components/table/TableHeader';
import { TableRow } from '../../components/table/TableRow';

// Ergebnistabelle: Spalten sind per Drag tauschbar und per Klick sortierbar
const RESULT_COLUMNS: ColumnDef[] = [
  { key: 'nachname', label: 'Nachname', defaultFlex: 1.1, minWidth: 90 },
  { key: 'vorname', label: 'Vorname', defaultFlex: 1, minWidth: 80 },
  { key: 'alter', label: 'Alter', defaultFlex: 0.4, minWidth: 50 },
  { key: 'verein', label: 'Verein', defaultFlex: 1.8, minWidth: 140 },
  { key: 'liga', label: 'Liga', defaultFlex: 1.1, minWidth: 100 },
];

type ResultSortKey = 'nachname' | 'vorname' | 'alter' | 'verein' | 'liga';

// Namenszusätze, die zum Nachnamen gehören ("Patrick Van Aanholt" -> "Van Aanholt, Patrick")
const NAME_PARTICLES = new Set([
  'van', 'von', 'de', 'der', 'den', 'del', 'della', 'di', 'da', 'dos', 'das',
  'du', 'la', 'le', 'el', 'al', 'ten', 'ter', 'te', 'op', 'zu', 'zur', 'vom',
  'mac', 'mc', 'bin', 'ibn', "'t", 'sint', 'st.',
]);

/** "Antek Wrebiakowski" -> { first: "Antek", last: "Wrebiakowski" };
 *  "Patrick Van Aanholt" -> { first: "Patrick", last: "Van Aanholt" } */
function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length <= 1) return { first: '', last: parts[0] || '' };
  // Frühester Namenszusatz (nicht am Anfang): ab dort beginnt der Nachname
  for (let i = 1; i < parts.length - 1; i++) {
    if (NAME_PARTICLES.has(parts[i].toLowerCase())) {
      return { first: parts.slice(0, i).join(' '), last: parts.slice(i).join(' ') };
    }
  }
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

// Retro-Farbschema (Anstoss-3-Optik, unabhängig vom App-Theme)
// ANSTOSS-3-Palette: Papier-Hintergrund, Royalblau-Balken mit hartem
// Versatz-Schatten, erhabene Grau-Buttons, Gelb-Akzente (Spielerinfo)
const RETRO = {
  page: '#e9e5dd',          // Papier-Hintergrund der ganzen Seite
  titleBar: 'rgba(210, 206, 198, 0.92)', // Fenster-Titelleiste
  panel: 'rgba(228, 224, 216, 0.68)', // Panelfläche (Bild schimmert durch)
  face: 'rgba(230, 226, 218, 0.80)',  // Button-Fläche (leicht durchscheinend)
  faceSelected: 'rgba(169, 187, 223, 0.92)', // gedrückt: helles Blau
  light: '#ffffff',
  shadow: '#8a867e',
  shadowDark: '#55524e',
  dropShadow: 'rgba(20, 20, 45, 0.55)', // harter Schlagschatten
  text: '#14141e',
  textMuted: '#4a4a55',
  headerBg: '#2b3f96',      // Royalblau der Abschnittsbalken
  headerText: '#ffffff',
  inputBg: 'rgba(255, 255, 255, 0.92)',
  yellow: '#f2c230',        // Anstoss-Gelb (Spielerinfo-Balken)
  yellowText: '#14141e',
  rowBorder: '#c6c2ba',
  white: '#ffffff',
};

// Weicher Versatz-Schatten ("verwischt", wie im Original)
const HARD_SHADOW = Platform.OS === 'web'
  ? ({ boxShadow: '2px 2px 3px rgba(20, 20, 45, 0.45)' } as any)
  : { shadowColor: '#14142d', shadowOffset: { width: 2, height: 2 }, shadowOpacity: 0.45, shadowRadius: 2, elevation: 3 };

const HARD_SHADOW_LG = Platform.OS === 'web'
  ? ({ boxShadow: '3px 4px 9px rgba(10, 10, 45, 0.5)' } as any)
  : { shadowColor: '#0a0a2d', shadowOffset: { width: 3, height: 4 }, shadowOpacity: 0.5, shadowRadius: 5, elevation: 4 };

// Helle Farbwerte für die geteilten Tabellen-Komponenten (Anstoss-Look)
const TABLE_COLORS = {
  surface: RETRO.page,
  surfaceSecondary: 'rgba(222, 218, 210, 0.85)',
  background: RETRO.page,
  border: RETRO.rowBorder,
  text: RETRO.text,
  textSecondary: RETRO.textMuted,
  primary: RETRO.headerBg,
  primaryText: '#ffffff',
};

/** Saison-Kurzlabel aus TM-Saisonstartjahr: 2026 -> "26/27" */
function seasonLabel(startYear: number): string {
  const a = String(startYear).slice(-2);
  const b = String(startYear + 1).slice(-2);
  return `${a}/${b}`;
}

/** Saison, in der ein Datum "DD.MM.YYYY" liegt (minus 1 Tag, damit der 01.07. noch zur Vorsaison zählt) */
function seasonOfDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const m = dateStr.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!m) return null;
  const d = new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
  d.setDate(d.getDate() - 1);
  const startYear = d.getMonth() + 1 >= 7 ? d.getFullYear() : d.getFullYear() - 1;
  return seasonLabel(startYear);
}

// Alter-Buttons: 16..34 plus "34+"
const AGE_OPTIONS: number[] = Array.from({ length: 19 }, (_, i) => 16 + i);

// Positions-Buttons (TM-Kürzel)
const POSITION_OPTIONS: { code: string; label: string }[] = [
  { code: 'TW', label: 'TW' },
  { code: 'IV', label: 'IV' },
  { code: 'LV', label: 'LV' },
  { code: 'RV', label: 'RV' },
  { code: 'DM', label: 'DM' },
  { code: 'ZM', label: 'ZM' },
  { code: 'OM', label: 'OM' },
  { code: 'LM', label: 'LM' },
  { code: 'RM', label: 'RM' },
  { code: 'LA', label: 'LA' },
  { code: 'RA', label: 'RA' },
  { code: 'ST', label: 'ST' },
];


const COUNTRY_FLAGS: Record<string, string> = {
  DE: '🇩🇪',
  AT: '🇦🇹',
  CH: '🇨🇭',
  NL: '🇳🇱',
};

interface LeagueOption {
  key: string;
  label: string;
  ids: string[];             // alle League-IDs dieser Option (inkl. Kinder)
  children?: LeagueOption[]; // aufklappbare Einzel-Staffeln (Regionalliga/Oberliga)
}

// Aufklappbares Liga-Dropdown mit Gruppen (Regionalliga/Oberliga) und "Leeren"
function LeagueDropdown({
  options,
  selected,
  onChange,
}: {
  options: LeagueOption[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const btnRef = useRef<View>(null);

  const openModal = () => {
    btnRef.current?.measureInWindow((x, y, w, h) => {
      setPos({ top: y + h + 4, left: x, width: w });
      setOpen(true);
    });
  };

  const isChecked = (o: LeagueOption) => o.ids.length > 0 && o.ids.every((id) => selected.has(id));
  const isPartial = (o: LeagueOption) => !isChecked(o) && o.ids.some((id) => selected.has(id));

  const toggle = (o: LeagueOption) => {
    const next = new Set(selected);
    if (isChecked(o)) o.ids.forEach((id) => next.delete(id));
    else o.ids.forEach((id) => next.add(id));
    onChange(next);
  };

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Anzeigetext: "Alle", einzelne Namen oder "N Ligen"
  const displayText = useMemo(() => {
    if (selected.size === 0) return 'Alle';
    const labels: string[] = [];
    for (const o of options) {
      if (isChecked(o)) {
        labels.push(o.label);
      } else if (o.children && isPartial(o)) {
        for (const c of o.children) {
          if (isChecked(c)) labels.push(c.label);
        }
      }
    }
    if (labels.length === 0) return 'Alle';
    if (labels.length <= 2) return labels.join(', ');
    return `${labels.length} Ligen ausgewählt`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, options]);

  const renderRow = (o: LeagueOption, depth: number) => {
    const checked = isChecked(o);
    const partial = isPartial(o);
    const hasChildren = !!o.children?.length;
    const isExpanded = expanded.has(o.key);
    return (
      <View key={o.key}>
        <View style={[ldStyles.row, { paddingLeft: 12 + depth * 24 }]}>
          <TouchableOpacity style={ldStyles.rowMain} onPress={() => toggle(o)}>
            <View
              style={[
                ldStyles.checkbox,
                { borderColor: RETRO.shadowDark },
                (checked || partial) && { backgroundColor: RETRO.headerBg, borderColor: RETRO.headerBg },
              ]}
            >
              {checked && <Text style={[ldStyles.checkmark, { color: RETRO.white }]}>✓</Text>}
              {partial && <Text style={[ldStyles.checkmark, { color: RETRO.white }]}>−</Text>}
            </View>
            <Text style={[ldStyles.rowLabel, { color: RETRO.text }]} numberOfLines={1}>
              {o.label}
            </Text>
          </TouchableOpacity>
          {hasChildren && (
            <TouchableOpacity onPress={() => toggleExpand(o.key)} style={ldStyles.chevronButton} hitSlop={8}>
              <Text style={[ldStyles.chevron, { color: RETRO.textMuted }]}>
                {isExpanded ? '▾' : '▸'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
        {hasChildren && isExpanded && o.children!.map((c) => renderRow(c, depth + 1))}
      </View>
    );
  };

  return (
    <View>
      <TouchableOpacity
        ref={btnRef as any}
        style={[ldStyles.button, { backgroundColor: RETRO.inputBg, borderColor: RETRO.shadowDark }, HARD_SHADOW]}
        onPress={openModal}
      >
        <Text style={[ldStyles.buttonText, { color: RETRO.text }]} numberOfLines={1}>
          {displayText}
        </Text>
        <Text style={[ldStyles.buttonChevron, { color: RETRO.textMuted }]}>▼</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="none" onRequestClose={() => setOpen(false)}>
        <TouchableWithoutFeedback onPress={() => setOpen(false)}>
          <View style={ldStyles.overlay}>
            <TouchableWithoutFeedback>
              <View
                style={[
                  ldStyles.dropdown,
                  {
                    backgroundColor: RETRO.white,
                    borderColor: RETRO.shadowDark,
                    top: pos.top,
                    left: pos.left,
                    minWidth: Math.max(pos.width, 260),
                  },
                ]}
              >
                {/* Leeren */}
                <TouchableOpacity
                  style={[ldStyles.clearRow, { borderBottomColor: RETRO.rowBorder }]}
                  onPress={() => onChange(new Set())}
                >
                  <Text style={[ldStyles.clearText, { color: selected.size > 0 ? '#b02020' : RETRO.textMuted }]}>
                    Leeren — alle Häkchen entfernen
                  </Text>
                </TouchableOpacity>

                <ScrollView style={ldStyles.list}>
                  {options.map((o) => renderRow(o, 0))}
                </ScrollView>

                <TouchableOpacity
                  style={[ldStyles.doneButton, { backgroundColor: RETRO.headerBg }]}
                  onPress={() => setOpen(false)}
                >
                  <Text style={[ldStyles.doneText, { color: RETRO.white }]}>
                    Fertig{selected.size > 0 ? ` (${selected.size})` : ''}
                  </Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
}

const ldStyles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 0,
    paddingHorizontal: 8,
    paddingVertical: 6,
    minHeight: 28,
  },
  buttonText: {
    fontSize: 14,
    flex: 1,
  },
  buttonChevron: {
    fontSize: 10,
    marginLeft: 8,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  dropdown: {
    position: 'absolute',
    borderWidth: 1,
    borderRadius: 0,
    overflow: 'hidden',
    ...(Platform.OS === 'web'
      ? ({ boxShadow: '3px 3px 0px rgba(20, 20, 45, 0.55)' } as any)
      : { shadowColor: '#14142d', shadowOffset: { width: 3, height: 3 }, shadowOpacity: 0.55, shadowRadius: 0, elevation: 5 }),
  },
  list: {
    maxHeight: 320,
    ...(Platform.OS === 'web' ? ({ overflowY: 'auto' } as any) : {}),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 12,
  },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  rowLabel: {
    fontSize: 13,
    fontWeight: '500',
    flexShrink: 1,
  },
  checkbox: {
    width: 16,
    height: 16,
    borderRadius: 0,
    borderWidth: 1,
    marginRight: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmark: {
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 15,
  },
  chevronButton: {
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  chevron: {
    fontSize: 13,
  },
  clearRow: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  clearText: {
    fontSize: 13,
    fontWeight: '600',
  },
  doneButton: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  doneText: {
    fontSize: 14,
    fontWeight: '600',
  },
});

function RetroButton({
  label,
  selected,
  onPress,
  minWidth,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  minWidth?: number;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        retro.button,
        minWidth ? { minWidth } : null,
        selected ? retro.buttonSelected : null,
      ]}
    >
      <Text style={[retro.buttonText, selected && retro.buttonTextSelected]}>{label}</Text>
    </TouchableOpacity>
  );
}

function RetroHeaderBar({ title }: { title: string }) {
  return (
    <View style={retro.headerBar}>
      <Text style={retro.headerBarText}>{title}</Text>
    </View>
  );
}

// Gelb-Markierung für Spieler, die bereits im Sportstipendium sind
const STIPENDIUM_YELLOW = '#facc15';

export function SuchmaschineScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const isMobile = width < 768;

  // Ergebnistabelle (Desktop)
  const [tableWidth, setTableWidth] = useState(0);
  const table = useTableColumns(RESULT_COLUMNS, tableWidth, 'suchmaschine_results');
  const [sortKey, setSortKey] = useState<ResultSortKey>('nachname');
  const [sortAsc, setSortAsc] = useState(true);

  const [entries, setEntries] = useState<StipendiumEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Suchfilter
  const [searchName, setSearchName] = useState('');
  const [selectedAges, setSelectedAges] = useState<Set<number>>(new Set());
  const [agePlus, setAgePlus] = useState(false);
  const [selectedPositions, setSelectedPositions] = useState<Set<string>>(new Set());
  const [selectedLeagueIds, setSelectedLeagueIds] = useState<Set<string>>(new Set());
  const [vereinslos, setVereinslos] = useState(false);
  const [contractExpiring, setContractExpiring] = useState(false);

  // Suchergebnisse
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<StipendiumSearchPlayer[] | null>(null);
  const [hiddenNoPosition, setHiddenNoPosition] = useState(0);
  const [addingId, setAddingId] = useState<string | null>(null);

  // Ligen aus DB
  const [leagueOptions, setLeagueOptions] = useState<LeagueOption[]>([]);

  // Spieler-Detail-Modal
  const [detailPlayer, setDetailPlayer] = useState<StipendiumSearchPlayer | null>(null);
  const [tmDetails, setTmDetails] = useState<PlayerTmDetails | null>(null);
  const [tmLoading, setTmLoading] = useState(false);

  // Watchlist-Mitgliedschaft (für den Button im Modal)
  const [watchlistIds, setWatchlistIds] = useState<Set<string>>(new Set());
  const [addingWatchlist, setAddingWatchlist] = useState(false);

  useEffect(() => {
    loadData();
    loadLeagueOptions();
    loadWatchlist().then((wl) => {
      setWatchlistIds(new Set(wl.map((w) => w.player_id).filter(Boolean) as string[]));
    });
  }, []);

  const openPlayerDetail = (player: StipendiumSearchPlayer) => {
    setDetailPlayer(player);
    setTmDetails(null);
    if (player.tm_player_id) {
      setTmLoading(true);
      fetchPlayerTmDetails(player.tm_player_id).then((d) => {
        setTmDetails(d);
        setTmLoading(false);
      });
    }
  };

  const handleAddToWatchlist = async (player: StipendiumSearchPlayer) => {
    if (addingWatchlist) return;
    setAddingWatchlist(true);
    const success = await addToWatchlist(player.id);
    if (success) {
      setWatchlistIds((prev) => new Set(prev).add(player.id));
    }
    setAddingWatchlist(false);
  };

  const loadData = async () => {
    setLoading(true);
    const result = await loadStipendiumEntries();
    setEntries(result);
    setLoading(false);
  };

  const loadLeagueOptions = async () => {
    const leagues = await loadLeagues();
    const opts: LeagueOption[] = [];
    const buckets = new Map<string, LeagueOption>();

    for (const l of leagues.filter((l) => l.is_active)) {
      const flag = COUNTRY_FLAGS[l.country] || l.country;

      // Regionalligen (Tier 4) und Oberligen (Tier 5) als aufklappbare Gruppe
      const groupKey =
        l.country === 'DE' && l.tier === 4 ? 'DE|Regionalliga'
        : l.country === 'DE' && l.tier === 5 ? 'DE|Oberliga'
        : null;

      if (groupKey) {
        let g = buckets.get(groupKey);
        if (!g) {
          g = {
            key: groupKey,
            label: `${flag} ${groupKey === 'DE|Regionalliga' ? 'Regionalliga (alle)' : 'Oberliga (alle)'}`,
            ids: [],
            children: [],
          };
          buckets.set(groupKey, g);
          opts.push(g);
        }
        g.ids.push(l.id);
        g.children!.push({ key: l.id, label: l.name, ids: [l.id] });
        continue;
      }

      // Gleichnamige Ligen (z.B. 4x "U19 Nachwuchsliga") zu einer Option zusammenfassen
      const key = `${l.country}|${l.name}`;
      let g = buckets.get(key);
      if (!g) {
        g = { key, label: `${flag} ${l.name}`, ids: [] };
        buckets.set(key, g);
        opts.push(g);
      }
      g.ids.push(l.id);
    }

    setLeagueOptions(opts);
  };

  const toggleAge = (age: number) => {
    setSelectedAges((prev) => {
      const next = new Set(prev);
      if (next.has(age)) next.delete(age);
      else next.add(age);
      return next;
    });
  };

  const togglePosition = (code: string) => {
    setSelectedPositions((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const handleSearch = async () => {
    if (searching) return;
    setSearching(true);
    const leagueIds = Array.from(selectedLeagueIds);
    const result = await searchStipendiumPlayers({
      name: searchName,
      ages: Array.from(selectedAges),
      agePlus,
      positions: Array.from(selectedPositions),
      leagueIds,
      vereinslos,
      contractExpiring,
    });
    setSearchResults(result.players);
    setHiddenNoPosition(result.hiddenNoPosition);
    setSearching(false);
  };

  const handleReset = () => {
    setSearchName('');
    setSelectedAges(new Set());
    setAgePlus(false);
    setSelectedPositions(new Set());
    setSelectedLeagueIds(new Set());
    setVereinslos(false);
    setContractExpiring(false);
    setSearchResults(null);
  };

  const addedTmIds = useMemo(
    () => new Set(entries.map((e) => e.tm_player_id).filter(Boolean)),
    [entries]
  );

  const clubDisplay = (p: StipendiumSearchPlayer) =>
    p.is_vereinslos ? `vereinslos (zuletzt ${p.club_name || '?'})` : p.club_name || '';

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortAsc((v) => !v);
    } else {
      setSortKey(key as ResultSortKey);
      setSortAsc(true);
    }
  };

  const sortedResults = useMemo(() => {
    if (!searchResults) return null;
    const dir = sortAsc ? 1 : -1;
    return [...searchResults].sort((a, b) => {
      switch (sortKey) {
        case 'nachname':
          return dir * splitName(a.player_name).last.localeCompare(splitName(b.player_name).last, 'de');
        case 'vorname':
          return dir * splitName(a.player_name).first.localeCompare(splitName(b.player_name).first, 'de');
        case 'alter':
          return dir * ((a.age ?? 999) - (b.age ?? 999));
        case 'verein':
          return dir * clubDisplay(a).localeCompare(clubDisplay(b), 'de');
        case 'liga':
          return dir * (a.league_name || '').localeCompare(b.league_name || '', 'de');
        default:
          return 0;
      }
    });
  }, [searchResults, sortKey, sortAsc]);

  // Spieler ins Sportstipendium aufnehmen (landet bei "Interessante Spieler")
  const handleAddToStipendium = async (player: StipendiumSearchPlayer) => {
    if (addingId) return;
    setAddingId(player.id);
    const entry = await addStipendiumEntry({
      player_name: player.player_name,
      birth_date: player.birth_date,
      club_name: player.is_vereinslos ? `vereinslos (zuletzt ${player.club_name || '?'})` : player.club_name,
      position: player.position,
      tm_player_id: player.tm_player_id,
      tm_profile_url: player.tm_profile_url,
      market_value: player.market_value,
      status: 'interessant',
    });
    if (entry) {
      setEntries((prev) => [entry, ...prev]);
    }
    setAddingId(null);
  };

  const openProfile = (url: string | null) => {
    if (!url) return;
    if (Platform.OS === 'web') {
      window.open(url, '_blank');
    } else {
      Linking.openURL(url);
    }
  };

  const formatContract = (iso: string | null) => {
    if (!iso) return null;
    const parts = iso.split('-');
    if (parts.length !== 3) return iso;
    return `${parts[2]}.${parts[1]}.${parts[0]}`;
  };

  // ==========================================================================
  // Renderer: Suchergebnis-Zeile
  // ==========================================================================

  const renderSearchResult = useCallback(
    ({ item }: { item: StipendiumSearchPlayer }) => {
      const added = !!(item.tm_player_id && addedTmIds.has(item.tm_player_id));
      const contract = formatContract(item.contract_until);
      const details = [
        item.age !== null ? `${item.age} J.` : null,
        item.position,
        item.is_vereinslos ? `vereinslos (zuletzt ${item.club_name || '?'})` : item.club_name,
        item.league_name,
        item.market_value,
        contract ? `Vertrag bis ${contract}` : null,
      ]
        .filter(Boolean)
        .join(' · ');

      return (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => openPlayerDetail(item)}
          style={[
            styles.entryCard,
            { backgroundColor: RETRO.white, borderColor: RETRO.rowBorder },
            HARD_SHADOW,
            added && {
              backgroundColor: STIPENDIUM_YELLOW + '55',
              borderColor: RETRO.yellow,
            },
          ]}
        >
          <View style={styles.entryInfo}>
            <View style={styles.entryNameRow}>
              <Text style={[styles.entryName, { color: RETRO.text }]} numberOfLines={1}>
                {item.player_name}
              </Text>
              {item.tm_profile_url && (
                <TouchableOpacity onPress={() => openProfile(item.tm_profile_url)} hitSlop={8}>
                  <Ionicons name="open-outline" size={15} color={RETRO.textMuted} />
                </TouchableOpacity>
              )}
            </View>
            <Text style={[styles.entryDetails, { color: RETRO.textMuted }]} numberOfLines={1}>
              {details}
            </Text>
          </View>
          {added && (
            <View style={[styles.addedBadge, { backgroundColor: RETRO.yellow }, HARD_SHADOW]}>
              <Text style={styles.addedBadgeIcon}>🎓</Text>
              <Text style={[styles.addedBadgeText, { color: RETRO.yellowText }]}>Sportstipendium</Text>
            </View>
          )}
        </TouchableOpacity>
      );
    },
    [addedTmIds, addingId, colors]
  );

  // ==========================================================================
  // Renderer: Tabellenzeile (Desktop)
  // ==========================================================================

  const renderTableRow = useCallback(
    ({ item }: { item: StipendiumSearchPlayer }) => {
      const added = !!(item.tm_player_id && addedTmIds.has(item.tm_player_id));
      const { first, last } = splitName(item.player_name);

      return (
        <TableRow
          columnOrder={table.columnOrder}
          getColumnWidth={table.getColumnWidth}
          onPress={() => openPlayerDetail(item)}
          style={[
            styles.tableRow,
            { borderBottomColor: RETRO.rowBorder },
            added && { backgroundColor: STIPENDIUM_YELLOW + '55' },
          ]}
          renderCell={(key) => {
            switch (key) {
              case 'nachname':
                return (
                  <Text style={[styles.tableCellBold, { color: RETRO.text }]} numberOfLines={1}>
                    {last}
                  </Text>
                );
              case 'vorname':
                return (
                  <Text style={[styles.tableCell, { color: RETRO.text }]} numberOfLines={1}>
                    {first}
                  </Text>
                );
              case 'alter':
                return (
                  <Text style={[styles.tableCell, { color: RETRO.text }]} numberOfLines={1}>
                    {item.age !== null ? item.age : ''}
                  </Text>
                );
              case 'verein':
                return (
                  <Text
                    style={[
                      styles.tableCell,
                      { color: RETRO.text, fontStyle: item.is_vereinslos ? 'italic' : 'normal' },
                    ]}
                    numberOfLines={1}
                  >
                    {clubDisplay(item)}
                  </Text>
                );
              case 'liga':
                return (
                  <Text style={[styles.tableCell, { color: RETRO.textMuted }]} numberOfLines={1}>
                    {item.league_name || ''}
                  </Text>
                );
              default:
                return null;
            }
          }}
        />
      );
    },
    [addedTmIds, addingId, colors, table.columnOrder, table.getColumnWidth]
  );

  const renderEmpty = (text: string, hint: string) => (
    <View style={styles.emptyState}>
      <Text style={styles.emptyIcon}>🎓</Text>
      <Text style={[styles.emptyText, { color: RETRO.text }]}>{text}</Text>
      <Text style={[styles.emptyHint, { color: RETRO.textMuted }]}>{hint}</Text>
    </View>
  );

  // ==========================================================================
  // Suchmaschine (Anstoss-3-Optik)
  // ==========================================================================

  const renderSearchPanel = () => (
    <View style={retro.panel}>
      <RetroHeaderBar title="Bitte tragen Sie die gewünschten Eigenschaften ein!" />

      {/* Name */}
      <View style={retro.row}>
        <Text style={retro.rowLabel}>Name / Verein</Text>
        <TextInput
          style={retro.input}
          value={searchName}
          onChangeText={setSearchName}
          onSubmitEditing={handleSearch}
          returnKeyType="search"
          placeholder=""
        />
      </View>

      {/* Alter */}
      <View style={retro.row}>
        <Text style={retro.rowLabel}>Alter</Text>
        <View style={retro.buttonWrap}>
          {AGE_OPTIONS.map((age) => (
            <RetroButton
              key={age}
              label={String(age)}
              selected={selectedAges.has(age)}
              onPress={() => toggleAge(age)}
              minWidth={40}
            />
          ))}
          <RetroButton label="34+" selected={agePlus} onPress={() => setAgePlus((v) => !v)} minWidth={48} />
        </View>
      </View>

      {/* Position */}
      <View style={retro.row}>
        <Text style={retro.rowLabel}>Position</Text>
        <View style={retro.buttonWrap}>
          {POSITION_OPTIONS.map((pos) => (
            <RetroButton
              key={pos.code}
              label={pos.label}
              selected={selectedPositions.has(pos.code)}
              onPress={() => togglePosition(pos.code)}
              minWidth={44}
            />
          ))}
        </View>
      </View>

      <RetroHeaderBar title="Bitte wählen Sie die sonstigen Besonderheiten des Spielers!" />

      {/* Ligen / letzte Liga */}
      <View style={retro.row}>
        <Text style={retro.rowLabel}>{vereinslos ? 'Letzte Liga' : 'Ligen'}</Text>
        <View style={retro.dropdownWrap}>
          <LeagueDropdown
            options={leagueOptions}
            selected={selectedLeagueIds}
            onChange={setSelectedLeagueIds}
          />
        </View>
      </View>

      {/* Besonderheiten */}
      <View style={retro.row}>
        <Text style={retro.rowLabel} />
        <View style={retro.buttonWrap}>
          <RetroButton
            label="vereinslos"
            selected={vereinslos}
            onPress={() => setVereinslos((v) => !v)}
            minWidth={110}
          />
          <RetroButton
            label="Vertrag muß auslaufen"
            selected={contractExpiring}
            onPress={() => setContractExpiring((v) => !v)}
            minWidth={180}
          />
        </View>
      </View>

      {/* Aktionen */}
      <View style={[retro.row, { justifyContent: 'flex-end' }]}>
        <View style={retro.buttonWrap}>
          <RetroButton label="Zurücksetzen" selected={false} onPress={handleReset} minWidth={110} />
          <TouchableOpacity onPress={handleSearch} style={[retro.button, retro.searchButton]} disabled={searching}>
            {searching ? (
              <ActivityIndicator size="small" color={RETRO.text} />
            ) : (
              <Text style={[retro.buttonText, retro.searchButtonText]}>Suchen</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  const renderContent = () => {
    const showResults = sortedResults !== null;
    const useTable = showResults && !isMobile;

    return (
      <FlatList
        style={styles.tabContent}
        data={(showResults ? sortedResults : []) as any[]}
        renderItem={(useTable ? renderTableRow : renderSearchResult) as any}
        keyExtractor={(item: any) => item.id}
        ListHeaderComponent={
          <View>
            {renderSearchPanel()}
            {showResults && (
              <Text style={[styles.sectionLabel, { color: RETRO.textMuted }]}>
                {`${sortedResults!.length} Spieler gefunden` +
                  (hiddenNoPosition > 0
                    ? ` · ${hiddenNoPosition} weitere ohne Positionsangabe ausgeblendet`
                    : '')}
              </Text>
            )}
            {useTable && (
              <View onLayout={(e) => setTableWidth(e.nativeEvent.layout.width)}>
                {tableWidth > 0 && (
                  <TableHeader
                    columnDefs={RESULT_COLUMNS}
                    columnOrder={table.columnOrder}
                    getColumnWidth={table.getColumnWidth}
                    onResizeStart={table.onResizeStart}
                    onDragStart={table.onDragStart}
                    resizingKey={table.resizingKey}
                    draggingKey={table.draggingKey}
                    dragOverKey={table.dragOverKey}
                    onSort={handleSort}
                    sortKey={sortKey}
                    sortAsc={sortAsc}
                    colors={TABLE_COLORS}
                    setHeaderRef={table.setHeaderRef}
                  />
                )}
              </View>
            )}
          </View>
        }
        ListEmptyComponent={
          !loading && !searching && showResults
            ? renderEmpty('Keine Spieler gefunden', 'Passe die Filter an und suche erneut.')
            : null
        }
        initialNumToRender={20}
        maxToRenderPerBatch={30}
        windowSize={10}
      />
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: RETRO.page }]}>
      {/* Verwaschenes Hintergrundfoto (schimmert durch die Flächen) */}
      <Image
        source={require('../../../assets/retro-bg.jpg')}
        style={styles.bgImage as any}
        resizeMode="cover"
      />
      {/* Header */}
      <View style={[styles.header, { backgroundColor: RETRO.titleBar, borderBottomColor: RETRO.shadowDark }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={[styles.backArrow, { color: RETRO.text }]}>{'←'}</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: RETRO.text }]}>Suchmaschine</Text>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={RETRO.headerBg} />
        </View>
      ) : (
        renderContent()
      )}

      {/* Spieler-Detail-Modal */}
      {detailPlayer && (() => {
        const p = detailPlayer;
        const added = !!(p.tm_player_id && addedTmIds.has(p.tm_player_id));
        const onWatchlist = watchlistIds.has(p.id);
        const contract = formatContract(p.contract_until);
        const vereinslosTransfer = tmDetails?.transfers?.find(
          (t) => t.to && /vereinslos|ohne verein|career break/i.test(t.to)
        );
        const lastClubSeason = p.is_vereinslos ? seasonOfDate(vereinslosTransfer?.date || null) : null;
        const infoRow = (label: string, value: React.ReactNode) => (
          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: RETRO.text }]}>{label}</Text>
            {typeof value === 'string' ? (
              <Text style={[styles.detailValue, { color: RETRO.text }]}>{value}</Text>
            ) : (
              value
            )}
          </View>
        );
        // Gelber Abschnittsbalken wie in der Anstoss-Spielerinfo
        const sectionBar = (title: string) => (
          <View style={[styles.detailSectionBar, HARD_SHADOW]}>
            <Text style={styles.detailSectionBarText}>{title}</Text>
          </View>
        );

        return (
          <Modal visible transparent animationType="fade" onRequestClose={() => setDetailPlayer(null)}>
            <TouchableWithoutFeedback onPress={() => setDetailPlayer(null)}>
              <View style={styles.detailOverlay}>
                <TouchableWithoutFeedback>
                  <View style={[styles.detailModal, HARD_SHADOW_LG]}>
                    {/* Namens-Balken (gelb): Name links, TM-Link rechtsbündig */}
                    <View style={[styles.detailNameBar, HARD_SHADOW]}>
                      <Text style={styles.detailName} numberOfLines={1}>
                        {(() => {
                          const n = splitName(p.player_name);
                          return n.first ? `${n.last}, ${n.first}` : n.last;
                        })()}
                      </Text>
                      {p.tm_profile_url && (
                        <TouchableOpacity onPress={() => openProfile(p.tm_profile_url)} hitSlop={8}>
                          <Image source={require('../../../assets/tm-icon.png')} style={styles.tmIcon} />
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity onPress={() => setDetailPlayer(null)} hitSlop={8}>
                        <Ionicons name="close" size={20} color={RETRO.text} />
                      </TouchableOpacity>
                    </View>
                    <View style={{ height: 6 }} />
                    {infoRow(
                      'Alter',
                      p.age !== null
                        ? `${p.age} Jahre${p.birth_date ? ` (${p.birth_date})` : ''}`
                        : p.birth_date || '—'
                    )}
                    {p.position ? infoRow('Position', p.position) : null}
                    {infoRow(
                      'Berater',
                      p.current_agent_name && p.current_agent_name !== 'kein Beratereintrag'
                        ? p.current_agent_name
                        : 'kein Beratereintrag'
                    )}

                    {/* Aktueller Verein */}
                    {sectionBar('Aktueller Verein')}
                    {p.is_vereinslos ? (
                      <>
                        {infoRow('Verein', 'vereinslos')}
                        {infoRow(
                          'Letzter Verein',
                          <View style={styles.detailClubValue}>
                            {p.club_tm_id && (
                              <Image
                                source={{ uri: `https://tmssl.akamaized.net/images/wappen/head/${p.club_tm_id}.png` }}
                                style={styles.detailClubLogo}
                                resizeMode="contain"
                              />
                            )}
                            <Text style={styles.detailClubText}>
                              {`${p.club_name || '?'}${lastClubSeason ? ` (${lastClubSeason})` : ''}`}
                            </Text>
                          </View>
                        )}
                      </>
                    ) : (
                      infoRow(
                        'Verein',
                        <View style={styles.detailClubValue}>
                          {p.club_tm_id && (
                            <Image
                              source={{ uri: `https://tmssl.akamaized.net/images/wappen/head/${p.club_tm_id}.png` }}
                              style={styles.detailClubLogo}
                              resizeMode="contain"
                            />
                          )}
                          <Text style={styles.detailClubText}>
                            {p.club_name || '—'}
                          </Text>
                        </View>
                      )
                    )}
                    {infoRow('Liga', p.league_name || '—')}

                    {/* Vertrag */}
                    {sectionBar('Vertrag')}
                    {infoRow('Vertrag bis', contract || '—')}
                    {infoRow('Marktwert', p.market_value || '—')}

                    {/* Spiele */}
                    {sectionBar('Einsätze')}
                    {infoRow(
                      `Saison ${tmDetails ? seasonLabel(tmDetails.seasonYear) : 'aktuell'}`,
                      tmLoading ? (
                        <ActivityIndicator size="small" color={RETRO.headerBg} />
                      ) : (
                        `${tmDetails?.gamesCurrentSeason ?? '—'} Spiele`
                      )
                    )}
                    {infoRow(
                      `Saison ${tmDetails ? seasonLabel(tmDetails.seasonYear - 1) : 'letzte'}`,
                      tmLoading ? ' ' : `${tmDetails?.gamesLastSeason ?? '—'} Spiele`
                    )}

                    {/* Aktionen */}
                    <View style={styles.detailActions}>
                      {added ? (
                        <View style={[styles.detailActionButton, { backgroundColor: RETRO.yellow }, HARD_SHADOW]}>
                          <Text style={[styles.detailActionText, { color: RETRO.yellowText }]}>🎓 im Sportstipendium</Text>
                        </View>
                      ) : (
                        <TouchableOpacity
                          style={[retro.button, styles.detailActionButton]}
                          onPress={() => handleAddToStipendium(p)}
                          disabled={addingId === p.id}
                        >
                          {addingId === p.id ? (
                            <ActivityIndicator size="small" color={RETRO.text} />
                          ) : (
                            <Text style={[styles.detailActionText, { color: RETRO.text }]}>+ Sportstipendium</Text>
                          )}
                        </TouchableOpacity>
                      )}
                      {onWatchlist ? (
                        <View style={[styles.detailActionButton, { backgroundColor: RETRO.faceSelected }, HARD_SHADOW]}>
                          <Text style={[styles.detailActionText, { color: RETRO.text }]}>⭐ auf der Watchlist</Text>
                        </View>
                      ) : (
                        <TouchableOpacity
                          style={[retro.button, styles.detailActionButton]}
                          onPress={() => handleAddToWatchlist(p)}
                          disabled={addingWatchlist}
                        >
                          {addingWatchlist ? (
                            <ActivityIndicator size="small" color={RETRO.text} />
                          ) : (
                            <Text style={[styles.detailActionText, { color: RETRO.text }]}>+ Watchlist (Beratung)</Text>
                          )}
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                </TouchableWithoutFeedback>
              </View>
            </TouchableWithoutFeedback>
          </Modal>
        );
      })()}
    </SafeAreaView>
  );
}

// ============================================================================
// Retro-Styles (Anstoss-3-Optik)
// ============================================================================

const retro = StyleSheet.create({
  panel: {
    backgroundColor: RETRO.panel,
    marginBottom: 14,
    paddingBottom: 10,
  },
  headerBar: {
    backgroundColor: RETRO.headerBg,
    paddingVertical: 7,
    paddingHorizontal: 12,
    marginTop: 10,
    marginBottom: 8,
    marginRight: 48,
    ...HARD_SHADOW_LG,
    ...(Platform.OS === 'web'
      ? ({ backgroundImage: 'linear-gradient(180deg, #4058b6 0%, #2b3f96 55%, #223077 100%)' } as any)
      : {}),
  },
  headerBarText: {
    color: RETRO.headerText,
    fontWeight: '700',
    fontSize: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    marginVertical: 6,
  },
  rowLabel: {
    width: 90,
    fontSize: 14,
    color: RETRO.text,
    fontWeight: '500',
  },
  input: {
    flex: 1,
    maxWidth: 320,
    backgroundColor: RETRO.inputBg,
    borderWidth: 1,
    borderColor: RETRO.shadowDark,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 14,
    color: RETRO.text,
    ...HARD_SHADOW,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  buttonWrap: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    alignItems: 'center',
  },
  button: {
    backgroundColor: RETRO.face,
    borderWidth: 2,
    borderTopColor: RETRO.light,
    borderLeftColor: RETRO.light,
    borderBottomColor: RETRO.shadowDark,
    borderRightColor: RETRO.shadowDark,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
    ...HARD_SHADOW,
  },
  buttonSelected: {
    backgroundColor: RETRO.faceSelected,
    borderTopColor: RETRO.shadowDark,
    borderLeftColor: RETRO.shadowDark,
    borderBottomColor: RETRO.light,
    borderRightColor: RETRO.light,
    ...(Platform.OS === 'web' ? ({ boxShadow: 'none' } as any) : { shadowOpacity: 0, elevation: 0 }),
  },
  buttonText: {
    fontSize: 13,
    color: RETRO.text,
    fontWeight: '600',
  },
  buttonTextSelected: {
    color: '#0d1e4d',
  },
  dropdownWrap: {
    flex: 1,
    maxWidth: 320,
  },
  searchButton: {
    minWidth: 110,
    backgroundColor: '#b7cdb7',
  },
  searchButtonText: {
    fontWeight: '700',
  },
});

// ============================================================================
// App-Styles
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // RN-Web braucht für absolute BG-Images explizite 100%-Maße plus
  // objectFit/Position UND backgroundSize/Position für zuverlässiges Cover
  bgImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    opacity: 0.55,
    ...(Platform.OS === 'web'
      ? ({
          objectFit: 'cover',
          objectPosition: 'center',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        } as any)
      : {}),
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
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  tabLabelActive: {
    fontWeight: '700',
  },
  tabContent: {
    flex: 1,
    padding: 12,
  },
  tabContentPadded: {
    flex: 1,
    padding: 12,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // Einträge
  entryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    gap: 8,
  },
  entryInfo: {
    flex: 1,
    minWidth: 150,
  },
  entryNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  entryName: {
    fontSize: 15,
    fontWeight: '600',
    flexShrink: 1,
  },
  entryDetails: {
    fontSize: 13,
    marginTop: 2,
  },
  entryActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  moveButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  moveButtonText: {
    fontSize: 12,
    fontWeight: '600',
  },
  removeButton: {
    width: 30,
    height: 30,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: 100,
    alignItems: 'center',
  },
  addButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  addedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  addedBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  addedBadgeIcon: {
    fontSize: 13,
  },

  // Ergebnistabelle (Desktop)
  tableRow: {
    borderBottomWidth: 1,
    paddingVertical: 6,
  },
  tableCell: {
    fontSize: 13,
  },
  tableCellBold: {
    fontSize: 13,
    fontWeight: '600',
  },
  tableActionCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tableAddButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    minWidth: 96,
    alignItems: 'center',
  },
  tableAddButtonText: {
    fontSize: 12,
    fontWeight: '600',
  },
  tableAddedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 7,
  },

  // Spieler-Detail-Modal
  detailOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  detailModal: {
    width: '100%',
    maxWidth: 480,
    borderWidth: 1,
    borderColor: RETRO.shadowDark,
    borderRadius: 2,
    padding: 16,
    backgroundColor: 'rgba(238, 234, 226, 0.97)',
  },
  detailNameBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: RETRO.yellow,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginRight: 40,
    marginBottom: 6,
    gap: 8,
  },
  detailName: {
    fontSize: 17,
    fontWeight: '700',
    color: RETRO.text,
    flex: 1,
  },
  tmIcon: {
    width: 22,
    height: 22,
    borderRadius: 4,
    marginRight: 4,
  },
  detailClubValue: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  detailClubLogo: {
    width: 20,
    height: 20,
  },
  detailClubText: {
    fontSize: 14,
    fontWeight: '600',
    color: RETRO.text,
    textAlign: 'right',
    flexShrink: 1,
  },
  detailSectionBar: {
    backgroundColor: RETRO.yellow,
    paddingVertical: 4,
    paddingHorizontal: 10,
    marginTop: 10,
    marginBottom: 8,
    marginRight: 120,
  },
  detailSectionBarText: {
    fontSize: 13,
    fontWeight: '700',
    color: RETRO.text,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    gap: 10,
    paddingHorizontal: 4,
  },
  detailLabel: {
    width: 110,
    fontSize: 13,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
    textAlign: 'right',
  },
  detailTmLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    marginBottom: 4,
  },
  detailTmLinkText: {
    fontSize: 13,
    fontWeight: '600',
  },
  detailActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  detailActionButton: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 160,
  },
  detailActionText: {
    fontSize: 13,
    fontWeight: '600',
  },

  // Empty State
  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
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
    maxWidth: 280,
  },
});
