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
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import {
  StipendiumEntry,
  StipendiumSearchPlayer,
  ClubOption,
  loadStipendiumEntries,
  addStipendiumEntry,
  searchStipendiumPlayers,
  loadAllClubs,
  loadReportTeams,
  normalizeSearch,
  agentDisplayName,
  baseClubName,
} from '../../services/stipendiumService';
import { PlayerDetailModal } from '../../components/PlayerDetailModal';
import { RatingBar } from '../../components/evaluation/RatingBar';
import { RetroHeader } from '../../components/RetroHeader';
import { loadLeagues, loadWatchlist, addToWatchlist, loadAllEvaluations, loadAlertSubscriptionIds } from '../../services/beraterService';
import { MONO, RETRO_CHIP, RETRO_CHIP_TEXT } from '../../theme/retro';
import { ColumnDef } from '../../types/tableColumns';
import { useTableColumns } from '../../hooks/useTableColumns';
import { TableHeader } from '../../components/table/TableHeader';
import { TableRow } from '../../components/table/TableRow';

// Ergebnistabelle: Spalten sind per Drag tauschbar und per Klick sortierbar
const RESULT_COLUMNS: ColumnDef[] = [
  { key: 'name', label: 'Name', defaultFlex: 1.6, minWidth: 140 },
  { key: 'pos', label: 'Pos', defaultFlex: 0.4, minWidth: 44 },
  { key: 'verein', label: 'Verein', defaultFlex: 1.6, minWidth: 140 },
  { key: 'alter', label: 'Alter', defaultFlex: 0.5, minWidth: 50 },
  { key: 'mv', label: 'Marktwert', defaultFlex: 0.8, minWidth: 80 },
  { key: 'berater', label: 'Berater', defaultFlex: 1.1, minWidth: 100 },
  { key: 'potential', label: 'Pot.', defaultFlex: 0.4, minWidth: 48 },
];

// Bei aktivem Beraterwechsel-Filter: Wechsel + Datum statt Marktwert/Berater
const WECHSEL_COLUMNS: ColumnDef[] = [
  { key: 'name', label: 'Name', defaultFlex: 1.4, minWidth: 130 },
  { key: 'pos', label: 'Pos', defaultFlex: 0.4, minWidth: 44 },
  { key: 'verein', label: 'Verein', defaultFlex: 1.2, minWidth: 110 },
  { key: 'alter', label: 'Alter', defaultFlex: 0.5, minWidth: 50 },
  { key: 'mv', label: 'Marktwert', defaultFlex: 0.7, minWidth: 80 },
  { key: 'wvorher', label: 'Berater vorher', defaultFlex: 1.1, minWidth: 100 },
  { key: 'wneu', label: 'Berater neu', defaultFlex: 1.1, minWidth: 100 },
  { key: 'wdatum', label: 'Datum', defaultFlex: 0.7, minWidth: 80 },
  { key: 'potential', label: 'Pot.', defaultFlex: 0.4, minWidth: 48 },
];

type ResultSortKey = 'name' | 'pos' | 'verein' | 'alter' | 'mv' | 'berater' | 'potential' | 'wdatum' | 'wvorher' | 'wneu';

/** "750 Tsd. €" / "1,50 Mio. €" -> Zahl (für die Sortierung) */
function parseMvNumber(mv: string | null): number {
  if (!mv) return 0;
  const num = parseFloat(mv.replace(/[^\d.,]/g, ' ').trim().replace(',', '.'));
  if (isNaN(num)) return 0;
  if (mv.includes('Mrd')) return num * 1000000000;
  if (mv.includes('Mio')) return num * 1000000;
  if (mv.includes('Tsd')) return num * 1000;
  return num;
}

// Marktwert-Korridor: Euro-Zahl -> Anzeige "750 Tsd. €" / "1,5 Mio. €"
function formatMvStep(v: number): string {
  if (v >= 1_000_000) return `${String(Math.round((v / 1_000_000) * 100) / 100).replace('.', ',')} Mio. €`;
  if (v >= 1_000) return `${String(Math.round(v / 10) / 100).replace('.', ',')} Tsd. €`;
  return `${v} €`;
}

// Farbe wie im Potential-Schiebebalken (1-3 rot, 4-6 orange, 7-9 grün, 10 gold)
function potentialColor(v: number): string {
  if (v === 10) return '#F0C040';
  if (v >= 7) return '#22c55e';
  if (v >= 4) return '#e8930c';
  return '#dc2626';
}

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

// Alter-Buttons: ≤14, 15..32, ≥33
const AGE_OPTIONS: number[] = Array.from({ length: 19 }, (_, i) => 14 + i);

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

const COUNTRY_NAMES: Record<string, string> = {
  DE: 'Deutschland',
  AT: 'Österreich',
  CH: 'Schweiz',
  NL: 'Niederlande',
};

// Potential-Buttons (1..10) — filtert auf das Scouting-Rating
const POTENTIAL_OPTIONS: number[] = Array.from({ length: 10 }, (_, i) => i + 1);

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
        style={[ldStyles.button, { backgroundColor: RETRO.inputBg }, HARD_SHADOW]}
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
  // randlos — Tiefe kommt vom HARD_SHADOW (Retro-Regel)
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
    fontSize: 11,
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
  searchInput: {
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: 1,
  },
  clubLogo: {
    width: 18,
    height: 18,
    marginRight: 6,
  },
  moreHint: {
    fontSize: 11,
    fontFamily: MONO,
    padding: 10,
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

// Vereins-Dropdown: alle Vereine mit ihren Mannschaften, Suchfeld oben,
// Mehrfachauswahl einzelner Mannschaften oder ganzer Vereine
interface ClubGroup {
  key: string;
  label: string;             // Vereinsname (Basis, z.B. "Borussia Dortmund")
  ids: string[];             // alle Mannschafts-IDs des Vereins
  children: ClubOption[];    // die einzelnen Mannschaften (voller Name)
}

/** Sortierung der Mannschaften im Verein: 1. Mannschaft, II, III, dann U-Teams absteigend (U23, U19, U17 ...) */
function teamRank(name: string, base: string): number {
  const suffix = name.slice(base.length).trim().toLowerCase();
  if (!suffix) return 0; // 1. Mannschaft
  if (suffix === 'ii' || suffix === '2') return 1;
  if (suffix === 'iii') return 2;
  if (suffix === 'iv') return 3;
  const m = suffix.match(/^u-?(\d{1,2})$/);
  if (m) return 100 - parseInt(m[1], 10); // U23 vor U19 vor U17 ...
  return 10; // Sonstiges (Amateure, B, Jugend) zwischen Reserven und U-Teams
}

function ClubDropdown({
  clubs,
  selected,
  onChange,
}: {
  clubs: ClubOption[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const btnRef = useRef<View>(null);

  const openModal = () => {
    btnRef.current?.measureInWindow((x, y, w, h) => {
      setPos({ top: y + h + 4, left: x, width: w });
      setSearch('');
      setOpen(true);
    });
  };

  // Mannschaften zu Vereinen gruppieren
  const groups = useMemo<ClubGroup[]>(() => {
    const byBase = new Map<string, ClubOption[]>();
    for (const c of clubs) {
      const base = baseClubName(c.name);
      const list = byBase.get(base);
      if (list) list.push(c);
      else byBase.set(base, [c]);
    }
    return Array.from(byBase.entries())
      .map(([base, teams]) => {
        const sorted = [...teams].sort(
          (a, b) => teamRank(a.name, base) - teamRank(b.name, base) || a.name.localeCompare(b.name, 'de')
        );
        return {
          key: base,
          label: base,
          ids: sorted.map((t) => t.id),
          children: sorted,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label, 'de'));
  }, [clubs]);

  // Suche: Verein ODER einzelne Mannschaft matcht; alle Treffer scrollbar
  const visible = useMemo(() => {
    const needle = normalizeSearch(search.trim());
    if (!needle) return groups;
    return groups.filter(
      (g) =>
        normalizeSearch(g.label).includes(needle) ||
        g.children.some((c) => normalizeSearch(c.name).includes(needle))
    );
  }, [groups, search]);

  const isChecked = (ids: string[]) => ids.length > 0 && ids.every((id) => selected.has(id));
  const isPartial = (ids: string[]) => !isChecked(ids) && ids.some((id) => selected.has(id));

  const toggleIds = (ids: string[]) => {
    const next = new Set(selected);
    if (isChecked(ids)) ids.forEach((id) => next.delete(id));
    else ids.forEach((id) => next.add(id));
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

  const displayText = useMemo(() => {
    if (selected.size === 0) return 'Alle';
    const names = clubs.filter((c) => selected.has(c.id)).map((c) => c.name);
    if (names.length <= 2) return names.join(', ');
    return `${names.length} Mannschaften ausgewählt`;
  }, [selected, clubs]);

  const renderCheckbox = (checked: boolean, partial: boolean) => (
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
  );

  return (
    <View>
      <TouchableOpacity
        ref={btnRef as any}
        style={[ldStyles.button, { backgroundColor: RETRO.inputBg }, HARD_SHADOW]}
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
                    minWidth: Math.max(pos.width, 280),
                  },
                ]}
              >
                {/* Suchfeld oben: tippen -> Vorschläge */}
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Verein suchen …"
                  placeholderTextColor={RETRO.textMuted}
                  autoFocus
                  style={[
                    ldStyles.searchInput,
                    { color: RETRO.text, borderBottomColor: RETRO.rowBorder },
                    Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null,
                  ]}
                />

                {/* Leeren */}
                <TouchableOpacity
                  style={[ldStyles.clearRow, { borderBottomColor: RETRO.rowBorder }]}
                  onPress={() => onChange(new Set())}
                >
                  <Text style={[ldStyles.clearText, { color: selected.size > 0 ? '#b02020' : RETRO.textMuted }]}>
                    Leeren — alle Häkchen entfernen
                  </Text>
                </TouchableOpacity>

                <ScrollView style={ldStyles.list} keyboardShouldPersistTaps="handled">
                  {visible.map((g) => {
                    const single = g.children.length === 1;
                    const isExpanded = expanded.has(g.key) || !!search.trim();
                    // Wappen nur in der Vereinszeile (nicht bei den Mannschaften)
                    const logoId = g.children.find((c) => c.tm_club_id)?.tm_club_id;
                    return (
                      <View key={g.key}>
                        <View style={[ldStyles.row, { paddingLeft: 12 }]}>
                          <TouchableOpacity style={ldStyles.rowMain} onPress={() => toggleIds(g.ids)}>
                            {renderCheckbox(isChecked(g.ids), isPartial(g.ids))}
                            {logoId ? (
                              <Image
                                source={{ uri: `https://tmssl.akamaized.net/images/wappen/head/${logoId}.png` }}
                                style={ldStyles.clubLogo}
                                resizeMode="contain"
                              />
                            ) : null}
                            <Text style={[ldStyles.rowLabel, { color: RETRO.text }]} numberOfLines={1}>
                              {single ? g.children[0].name : g.label}
                            </Text>
                          </TouchableOpacity>
                          {!single && (
                            <TouchableOpacity onPress={() => toggleExpand(g.key)} style={ldStyles.chevronButton} hitSlop={8}>
                              <Text style={[ldStyles.chevron, { color: RETRO.textMuted }]}>
                                {isExpanded ? '▾' : '▸'}
                              </Text>
                            </TouchableOpacity>
                          )}
                        </View>
                        {!single && isExpanded && g.children.map((c) => (
                          <View key={c.id} style={[ldStyles.row, { paddingLeft: 36 }]}>
                            <TouchableOpacity style={ldStyles.rowMain} onPress={() => toggleIds([c.id])}>
                              {renderCheckbox(selected.has(c.id), false)}
                              <Text style={[ldStyles.rowLabel, { color: RETRO.text }]} numberOfLines={1}>
                                {c.name}
                              </Text>
                            </TouchableOpacity>
                          </View>
                        ))}
                      </View>
                    );
                  })}
                  {visible.length === 0 && (
                    <Text style={[ldStyles.moreHint, { color: RETRO.textMuted }]}>Kein Verein gefunden</Text>
                  )}
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

// Länder-Dropdown mit Häkchen (Mehrfachauswahl, wie das Liga-Dropdown)
function NationDropdown({
  countries,
  selected,
  onChange,
}: {
  countries: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const btnRef = useRef<View>(null);

  const openModal = () => {
    btnRef.current?.measureInWindow((x, y, w, h) => {
      setPos({ top: y + h + 4, left: x, width: w });
      setOpen(true);
    });
  };

  const label = (code: string) =>
    `${COUNTRY_FLAGS[code] || ''} ${COUNTRY_NAMES[code] || code}`.trim();

  const toggle = (code: string) => {
    const next = new Set(selected);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    onChange(next);
  };

  const displayText =
    selected.size === 0
      ? 'Alle'
      : selected.size <= 2
        ? [...selected].map((c) => COUNTRY_NAMES[c] || c).join(', ')
        : `${selected.size} Länder ausgewählt`;

  return (
    <View>
      <TouchableOpacity
        ref={btnRef as any}
        style={[ldStyles.button, { backgroundColor: RETRO.inputBg }, HARD_SHADOW]}
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
                    minWidth: Math.max(pos.width, 200),
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

                {countries.map((code) => {
                  const checked = selected.has(code);
                  return (
                    <TouchableOpacity
                      key={code}
                      style={[ldStyles.rowMain, { paddingHorizontal: 12 }]}
                      onPress={() => toggle(code)}
                    >
                      <View
                        style={[
                          ldStyles.checkbox,
                          { borderColor: RETRO.shadowDark },
                          checked && { backgroundColor: RETRO.headerBg, borderColor: RETRO.headerBg },
                        ]}
                      >
                        {checked && <Text style={[ldStyles.checkmark, { color: RETRO.white }]}>✓</Text>}
                      </View>
                      <Text style={[ldStyles.rowLabel, { color: RETRO.text }]} numberOfLines={1}>
                        {label(code)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}

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

// Marktwert-Feld (von/bis): Zahl frei eintippen (Komma oder Punkt egal),
// dahinter ein kleines Einheiten-Dropdown "Tsd. €" / "Mio. €"
const MV_UNITS: { factor: number; label: string }[] = [
  { factor: 1_000, label: 'Tsd. €' },
  { factor: 1_000_000, label: 'Mio. €' },
];

function MvField({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (next: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const [text, setText] = useState('');
  const [factor, setFactor] = useState(1_000_000);
  const btnRef = useRef<View>(null);
  // zuletzt selbst gemeldeter Wert, damit der Sync von außen das Tippen nicht
  // überschreibt; undefined = noch nie synchronisiert (beim Mount befüllen)
  const emitted = useRef<number | null | undefined>(undefined);

  // Wert von außen (Zurücksetzen) ins Feld spiegeln
  useEffect(() => {
    if (value === emitted.current) return;
    emitted.current = value;
    if (value == null) {
      setText('');
      return;
    }
    const f = value >= 1_000_000 ? 1_000_000 : 1_000;
    setFactor(f);
    setText(String(value / f).replace('.', ','));
  }, [value]);

  const emit = (t: string, f: number) => {
    const num = parseFloat(t.replace(',', '.'));
    const next = t.trim() === '' || isNaN(num) || num < 0 ? null : num * f;
    emitted.current = next;
    onChange(next);
  };

  const openModal = () => {
    btnRef.current?.measureInWindow((x, y, w, h) => {
      setPos({ top: y + h + 4, left: x, width: w });
      setOpen(true);
    });
  };

  const unitLabel = MV_UNITS.find((u) => u.factor === factor)?.label || 'Mio. €';

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
      <TextInput
        value={text}
        onChangeText={(t) => {
          setText(t);
          emit(t, factor);
        }}
        placeholder="Egal"
        placeholderTextColor={RETRO.textMuted}
        keyboardType="decimal-pad"
        style={[
          ldStyles.button,
          { backgroundColor: RETRO.inputBg, flex: 1, minWidth: 0, fontSize: 14, color: RETRO.text },
          HARD_SHADOW,
          Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null,
        ]}
      />
      <TouchableOpacity
        ref={btnRef as any}
        style={[ldStyles.button, { backgroundColor: RETRO.inputBg, flexShrink: 0, width: 92 }, HARD_SHADOW]}
        onPress={openModal}
      >
        <Text style={{ fontSize: 14, color: RETRO.text }} numberOfLines={1}>
          {unitLabel}
        </Text>
        <Text style={[ldStyles.buttonChevron, { color: RETRO.textMuted, marginLeft: 5 }]}>▼</Text>
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
                    minWidth: Math.max(pos.width, 90),
                  },
                ]}
              >
                {MV_UNITS.map((u) => (
                  <TouchableOpacity
                    key={u.factor}
                    style={[ldStyles.rowMain, { paddingHorizontal: 12 }]}
                    onPress={() => {
                      setFactor(u.factor);
                      setOpen(false);
                      emit(text, u.factor);
                    }}
                  >
                    <Text
                      style={[
                        ldStyles.rowLabel,
                        { color: RETRO.text },
                        u.factor === factor && { fontWeight: '700', color: RETRO.headerBg },
                      ]}
                    >
                      {u.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
}

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
  // Ergebnisse mit aktivem Wechsel-Filter? (steuert Spalten + Standard-Sortierung)
  const [resultsWechsel, setResultsWechsel] = useState(false);
  const activeColumns = resultsWechsel ? WECHSEL_COLUMNS : RESULT_COLUMNS;
  const tableStandard = useTableColumns(RESULT_COLUMNS, tableWidth, 'suchmaschine_results_v6');
  const tableWechsel = useTableColumns(WECHSEL_COLUMNS, tableWidth, 'suchmaschine_results_wechsel_v3');
  const table = resultsWechsel ? tableWechsel : tableStandard;
  const [sortKey, setSortKey] = useState<ResultSortKey>('name');
  const [sortAsc, setSortAsc] = useState(true);

  const [entries, setEntries] = useState<StipendiumEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Suchfilter
  const [searchName, setSearchName] = useState('');
  const [selectedAges, setSelectedAges] = useState<Set<number>>(new Set());
  const [agePlus, setAgePlus] = useState(false);
  const [selectedPositions, setSelectedPositions] = useState<Set<string>>(new Set());
  const [selectedPotentials, setSelectedPotentials] = useState<Set<number>>(new Set());
  const [selectedLeagueIds, setSelectedLeagueIds] = useState<Set<string>>(new Set());
  const [nations, setNations] = useState<Set<string>>(new Set());
  // Vereins-Filter: konkrete Mannschaften (berater_clubs.id) oder
  // Berichts-Mannschaften (synthetische "report:"-Einträge, z.B. Dortmund U15)
  const [selectedClubIds, setSelectedClubIds] = useState<Set<string>>(new Set());
  const [clubOptions, setClubOptions] = useState<ClubOption[]>([]);
  const [reportTeamLabels, setReportTeamLabels] = useState<string[]>([]);
  // Berichts-Mannschaften als Dropdown-Einträge ergänzen (Land vom TM-Schwesterteam erben)
  const clubOptionsMerged = useMemo<ClubOption[]>(() => {
    if (reportTeamLabels.length === 0) return clubOptions;
    const merged = [...clubOptions];
    for (const label of reportTeamLabels) {
      if (clubOptions.some((c) => c.name === label)) continue; // gibt es schon als TM-Team
      const base = baseClubName(label);
      const sibling = clubOptions.find((c) => baseClubName(c.name) === base);
      merged.push({
        id: `report:${label}`,
        name: label,
        league_id: null,
        country: sibling?.country ?? null,
        tm_club_id: null,
      });
    }
    return merged;
  }, [clubOptions, reportTeamLabels]);
  // Kaskade: Land-/Liga-Auswahl schränkt die Vereinsliste im Dropdown ein
  const clubsForDropdown = useMemo(() => {
    let list = clubOptionsMerged;
    if (nations.size > 0) list = list.filter((c) => c.country && nations.has(c.country));
    if (selectedLeagueIds.size > 0) list = list.filter((c) => c.league_id && selectedLeagueIds.has(c.league_id));
    return list;
  }, [clubOptionsMerged, nations, selectedLeagueIds]);
  const [vereinslos, setVereinslos] = useState(false);
  const [contractExpiring, setContractExpiring] = useState(false);
  // Marktwert-Korridor (null = offen)
  const [mvMin, setMvMin] = useState<number | null>(null);
  const [mvMax, setMvMax] = useState<number | null>(null);
  const [ohneBerater, setOhneBerater] = useState(false);
  const [aufWatchlist, setAufWatchlist] = useState(false);

  // Scouting-Ratings (für den Potential-Filter): Bewertung vor Watchlist-Rating
  const [ratingsMap, setRatingsMap] = useState<Map<string, number>>(new Map());
  // Bewertungsstatus je Spieler (nicht_interessant/top_ziel) fürs Ausgrauen
  const [statusMap, setStatusMap] = useState<Map<string, string>>(new Map());
  // Beraterwechsel-Filter (Tracker-Integration): letzte N Tage, 0 = aus
  const [wechselTage, setWechselTage] = useState(0);
  // Glocken-Filter: nur Spieler mit aktivem Benachrichtigungs-Abo
  const [nurGlocke, setNurGlocke] = useState(false);
  const [alertIds, setAlertIds] = useState<Set<string>>(new Set());

  // Suchergebnisse
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<StipendiumSearchPlayer[] | null>(null);
  const [hiddenNoPosition, setHiddenNoPosition] = useState(0);
  const [addingId, setAddingId] = useState<string | null>(null);

  // Ligen aus DB
  const [leagueOptions, setLeagueOptions] = useState<LeagueOption[]>([]);
  // Nationen (Länder der aktiven Ligen)
  const [nationOptions, setNationOptions] = useState<string[]>([]);
  // Kaskade: Land-Auswahl schränkt auch die Ligen ein (Options-Key beginnt mit dem Länderkürzel)
  const leaguesForDropdown = useMemo(() => {
    if (nations.size === 0) return leagueOptions;
    return leagueOptions.filter((o) => nations.has(o.key.split('|')[0]));
  }, [leagueOptions, nations]);

  // Spieler-Detail-Modal
  const [detailPlayer, setDetailPlayer] = useState<StipendiumSearchPlayer | null>(null);
  // Nach Schließen der Spielbewertung zurück ins Spielerprofil
  const returnToPlayerRef = useRef<StipendiumSearchPlayer | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (returnToPlayerRef.current) {
        const player = returnToPlayerRef.current;
        returnToPlayerRef.current = null;
        setTimeout(() => setDetailPlayer(player), 100);
      }
    }, [])
  );

  // Watchlist-Mitgliedschaft (für den Button im Modal)
  const [watchlistIds, setWatchlistIds] = useState<Set<string>>(new Set());
  const [addingWatchlist, setAddingWatchlist] = useState(false);

  useEffect(() => {
    loadData();
    loadLeagueOptions();
    loadAllClubs().then(setClubOptions).catch(() => {});
    loadReportTeams().then(setReportTeamLabels).catch(() => {});
    loadAlertSubscriptionIds().then(setAlertIds).catch(() => {});
    Promise.all([loadWatchlist(), loadAllEvaluations()]).then(([wl, evals]) => {
      setWatchlistIds(new Set(wl.map((w) => w.player_id).filter(Boolean) as string[]));
      // Rating aus Bewertung, sonst aus Watchlist-Eintrag
      const map = new Map<string, number>();
      for (const w of wl) {
        if (w.player_id && w.rating != null) map.set(w.player_id, w.rating);
      }
      const statuses = new Map<string, string>();
      for (const [pid, ev] of evals) {
        if (ev.rating != null) map.set(pid, ev.rating);
        statuses.set(pid, ev.status);
      }
      setRatingsMap(map);
      setStatusMap(statuses);
    });
  }, []);

  // TM-Details (Einsätze/Transfers) lädt das Modal selbst nach
  const openPlayerDetail = (player: StipendiumSearchPlayer) => {
    setDetailPlayer(player);
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
    setNationOptions(
      Array.from(new Set(leagues.filter((l) => l.is_active).map((l) => l.country))).sort()
    );
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
      nations: nations.size > 0 ? Array.from(nations) : undefined,
      // Echte TM-Mannschaften vs. Berichts-Mannschaften (synthetische Einträge)
      clubIds: (() => {
        const real = Array.from(selectedClubIds).filter((id) => !id.startsWith('report:'));
        return real.length > 0 ? real : undefined;
      })(),
      reportTeams: (() => {
        const labels = Array.from(selectedClubIds)
          .filter((id) => id.startsWith('report:'))
          .map((id) => id.slice(7));
        return labels.length > 0 ? labels : undefined;
      })(),
      // Basisnamen der gewählten TM-Vereine: findet auch Bericht-Spieler (U15/U16)
      clubBaseNames: (() => {
        const real = clubOptions.filter((c) => selectedClubIds.has(c.id));
        return real.length > 0
          ? Array.from(new Set(real.map((c) => baseClubName(c.name))))
          : undefined;
      })(),
      vereinslos,
      contractExpiring,
      wechselTage: wechselTage || undefined,
    });
    // Filter, die nur der Screen kennt (Ratings/Watchlist), client-seitig
    let players = result.players;
    if (selectedPotentials.size > 0) {
      players = players.filter((p) => {
        const r = ratingsMap.get(p.id);
        return r != null && selectedPotentials.has(r);
      });
    }
    if (mvMin != null || mvMax != null) {
      // Bei vertauschten Grenzen (von > bis) einfach beide Richtungen zulassen
      const lo = mvMin != null && mvMax != null ? Math.min(mvMin, mvMax) : mvMin;
      const hi = mvMin != null && mvMax != null ? Math.max(mvMin, mvMax) : mvMax;
      players = players.filter((p) => {
        const mv = parseMvNumber(p.market_value);
        if (lo != null && mv < lo) return false;
        if (hi != null && mv > hi) return false;
        return true;
      });
    }
    if (ohneBerater) {
      players = players.filter(
        (p) => countsAsNoAgent(p.current_agent_name) && countsAsNoAgent(p.current_agent_company)
      );
    }
    if (aufWatchlist) {
      players = players.filter((p) => watchlistIds.has(p.id));
    }
    if (nurGlocke) {
      players = players.filter((p) => alertIds.has(p.id));
    }
    setResultsWechsel(wechselTage > 0);
    if (wechselTage > 0) {
      setSortKey('wdatum');
      setSortAsc(false);
    }
    setSearchResults(players);
    setHiddenNoPosition(result.hiddenNoPosition);
    setSearching(false);
  };

  const handleReset = () => {
    setSearchName('');
    setSelectedAges(new Set());
    setAgePlus(false);
    setSelectedPositions(new Set());
    setSelectedPotentials(new Set());
    setSelectedLeagueIds(new Set());
    setNations(new Set());
    setSelectedClubIds(new Set());
    setVereinslos(false);
    setContractExpiring(false);
    setMvMin(null);
    setMvMax(null);
    setOhneBerater(false);
    setAufWatchlist(false);
    setNurGlocke(false);
    setWechselTage(0);
    setSearchResults(null);
  };

  // Zusammenfassung der aktiven Filter für die Statuszeile
  const filterSummary = useMemo(() => {
    const parts: string[] = [];
    if (searchName.trim()) parts.push(`Name: ${searchName.trim()}`);
    if (selectedAges.size > 0 || agePlus) {
      const ages = Array.from(selectedAges).sort((a, b) => a - b).map((a) => (a === 14 ? '≤14' : String(a)));
      if (agePlus) ages.push('≥33');
      parts.push(`Alter: ${ages.join(', ')}`);
    }
    if (selectedPositions.size > 0) parts.push(`Position: ${Array.from(selectedPositions).join(', ')}`);
    if (selectedPotentials.size > 0) {
      parts.push(`Potential: ${Array.from(selectedPotentials).sort((a, b) => a - b).join(', ')}`);
    }
    if (selectedLeagueIds.size > 0) parts.push(`${selectedLeagueIds.size} Ligen`);
    if (nations.size > 0) parts.push([...nations].map((n) => COUNTRY_NAMES[n] || n).join(', '));
    if (selectedClubIds.size > 0) {
      const names = clubOptionsMerged.filter((c) => selectedClubIds.has(c.id)).map((c) => c.name);
      parts.push(names.length <= 2 ? names.join(', ') : `${names.length} Mannschaften`);
    }
    if (vereinslos) parts.push('vereinslos');
    if (contractExpiring) parts.push('Vertrag läuft aus');
    if (mvMin != null || mvMax != null) {
      if (mvMin != null && mvMax != null) parts.push(`Marktwert ${formatMvStep(mvMin)} - ${formatMvStep(mvMax)}`);
      else if (mvMin != null) parts.push(`Marktwert ab ${formatMvStep(mvMin)}`);
      else parts.push(`Marktwert bis ${formatMvStep(mvMax!)}`);
    }
    if (ohneBerater) parts.push('ohne Berater');
    if (aufWatchlist) parts.push('auf der Watchlist');
    if (nurGlocke) parts.push('Glocke aktiv');
    if (wechselTage > 0) parts.push(`Neuer Berater seit ${wechselTage} ${wechselTage === 1 ? 'Tag' : 'Tagen'}`);
    return parts.length > 0 ? parts.join(' · ') : 'Keine Filter gesetzt';
  }, [searchName, selectedAges, agePlus, selectedPositions, selectedPotentials, selectedLeagueIds, nations, selectedClubIds, clubOptionsMerged, vereinslos, contractExpiring, mvMin, mvMax, ohneBerater, aufWatchlist, nurGlocke, wechselTage]);

  const togglePotential = (val: number) => {
    setSelectedPotentials((prev) => {
      const next = new Set(prev);
      if (next.has(val)) next.delete(val);
      else next.add(val);
      return next;
    });
  };

  const addedTmIds = useMemo(
    () => new Set(entries.map((e) => e.tm_player_id).filter(Boolean)),
    [entries]
  );

  const clubDisplay = (p: StipendiumSearchPlayer) =>
    p.is_vereinslos ? `vereinslos (zuletzt ${p.club_name || '?'})` : p.club_name || '';

  // DB speichert teils "kein Beratereintrag" als Text — als leer behandeln
  const isNoAgentValue = (name: string | null) => {
    const n = (name || '').trim().toLowerCase();
    return n === '' || n === 'kein beratereintrag' || n === 'kein eintrag' || n === '-' || n === '—';
  };
  // "ohne Berater"-Filter: kein Eintrag, "ohne Berater", Familienangehörige, k.A.
  const countsAsNoAgent = (val: string | null) => {
    const n = (val || '').trim().toLowerCase();
    return (
      isNoAgentValue(val) ||
      n === 'ohne berater' ||
      n.replace(/\s/g, '') === 'k.a.' ||
      n.includes('familienangehörige')
    );
  };
  // Zentrale Berater-Anzeige-Regel: Agentur vor Person, Platzhalter
  // (Familienangehörige, k.A., ohne Berater ...) zählen als kein Eintrag
  const agentDisplay = (p: StipendiumSearchPlayer) =>
    agentDisplayName(p.current_agent_name, p.current_agent_company) || '';

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
        case 'name':
          return dir * splitName(a.player_name).last.localeCompare(splitName(b.player_name).last, 'de');
        case 'pos':
          return dir * (a.position || 'zz').localeCompare(b.position || 'zz', 'de');
        case 'alter':
          return dir * ((a.age ?? 999) - (b.age ?? 999));
        case 'mv':
          return dir * (parseMvNumber(a.market_value) - parseMvNumber(b.market_value));
        case 'verein':
          return dir * clubDisplay(a).localeCompare(clubDisplay(b), 'de');
        case 'berater':
          return dir * (agentDisplay(a) || 'zzz').localeCompare(agentDisplay(b) || 'zzz', 'de');
        case 'potential':
          return dir * ((ratingsMap.get(a.id) ?? -1) - (ratingsMap.get(b.id) ?? -1));
        case 'wdatum':
          return dir * (a.last_change?.date || '').localeCompare(b.last_change?.date || '');
        case 'wvorher':
          return dir * (a.last_change?.from || 'zzz').localeCompare(b.last_change?.from || 'zzz', 'de');
        case 'wneu':
          return dir * (a.last_change?.to || 'zzz').localeCompare(b.last_change?.to || 'zzz', 'de');
        default:
          return 0;
      }
    });
  }, [searchResults, sortKey, sortAsc, ratingsMap]);

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
            statusMap.get(item.id) === 'nicht_interessant' && { opacity: 0.4 },
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
    [addedTmIds, addingId, colors, statusMap]
  );

  // ==========================================================================
  // Renderer: Tabellenzeile (Desktop)
  // ==========================================================================

  const renderTableRow = useCallback(
    ({ item }: { item: StipendiumSearchPlayer }) => {
      const added = !!(item.tm_player_id && addedTmIds.has(item.tm_player_id));
      const { first, last } = splitName(item.player_name);
      const uninteresting = statusMap.get(item.id) === 'nicht_interessant';

      return (
        <TableRow
          columnOrder={table.columnOrder}
          getColumnWidth={table.getColumnWidth}
          onPress={() => openPlayerDetail(item)}
          style={[
            styles.tableRow,
            { borderBottomColor: RETRO.rowBorder },
            added && { backgroundColor: STIPENDIUM_YELLOW + '55' },
            uninteresting && { opacity: 0.4 },
          ]}
          renderCell={(key) => {
            switch (key) {
              case 'name':
                return (
                  <Text style={[styles.tableCellBold, { color: RETRO.text }]} numberOfLines={1}>
                    {first ? `${last}, ${first}` : last}
                  </Text>
                );
              case 'pos':
                return (
                  <Text style={[styles.tableCell, { color: RETRO.text }]} numberOfLines={1}>
                    {item.position || ''}
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
                    {item.is_vereinslos ? 'vereinslos' : item.club_name || ''}
                  </Text>
                );
              case 'alter':
                return (
                  <Text style={[styles.tableCell, { color: RETRO.text }]} numberOfLines={1}>
                    {item.age !== null ? item.age : ''}
                  </Text>
                );
              case 'mv':
                return (
                  <Text style={[styles.tableCell, { color: RETRO.text }]} numberOfLines={1}>
                    {item.market_value || '–'}
                  </Text>
                );
              case 'berater':
                return (
                  <Text style={[styles.tableCell, { color: RETRO.text }]} numberOfLines={1}>
                    {agentDisplay(item) || 'kein Beratereintrag'}
                  </Text>
                );
              case 'wvorher':
                // alter Zustand ausgegraut — der Blick fällt auf "Berater neu"
                return item.last_change ? (
                  <Text style={[styles.tableCell, { color: RETRO.textMuted }]} numberOfLines={1}>
                    {item.last_change.from || 'kein Beratereintrag'}
                  </Text>
                ) : null;
              case 'wneu':
                // neuer Zustand fett; "kein Berater" grün = freier Spieler (Chance)
                return item.last_change ? (
                  <Text
                    style={[
                      styles.tableCellBold,
                      { color: item.last_change.to ? RETRO.text : '#15803d' },
                    ]}
                    numberOfLines={1}
                  >
                    {item.last_change.to || 'kein Beratereintrag'}
                  </Text>
                ) : null;
              case 'wdatum':
                return (
                  <Text style={[styles.tableCell, { color: RETRO.text }]} numberOfLines={1}>
                    {item.last_change ? item.last_change.date.slice(0, 10).split('-').reverse().join('.') : ''}
                  </Text>
                );
              case 'potential': {
                const rating = ratingsMap.get(item.id);
                if (rating == null) return <Text style={styles.tableCell}> </Text>;
                return (
                  <View style={[nc.potBadge, { backgroundColor: potentialColor(rating) }]}>
                    <Text style={nc.potBadgeText}>{rating}</Text>
                  </View>
                );
              }
              default:
                return null;
            }
          }}
        />
      );
    },
    [addedTmIds, addingId, colors, table.columnOrder, table.getColumnWidth, ratingsMap, statusMap]
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

  // Kleiner Auswahl-Button (grau auf weißer Karte, ausgewählt grün)
  const filterBtn = (label: string, selected: boolean, onPress: () => void, minWidth = 34) => (
    <TouchableOpacity
      key={label}
      onPress={onPress}
      style={[nc.filterBtn, { minWidth }, HARD_SHADOW, selected && nc.filterBtnSelected]}
      activeOpacity={0.7}
    >
      <Text style={[nc.filterBtnText, selected && nc.filterBtnTextSelected]}>{label}</Text>
    </TouchableOpacity>
  );

  // Retro-Checkbox (Kasten + Label)
  const checkbox = (label: string, checked: boolean, onToggle: () => void) => (
    <TouchableOpacity key={label} style={nc.checkRow} onPress={onToggle} activeOpacity={0.7}>
      <View style={[nc.checkBox, checked && nc.checkBoxChecked]}>
        {checked && <Text style={nc.checkMark}>✓</Text>}
      </View>
      <Text style={nc.checkLabel}>{label}</Text>
    </TouchableOpacity>
  );

  const renderSearchPanel = () => (
    <View>
      <View style={nc.filterRow}>
        {/* Karte SPIELER */}
        <View style={[nc.card, nc.cardSpieler, HARD_SHADOW]}>
          <View style={nc.chip}><Text style={RETRO_CHIP_TEXT as any}>SPIELER</Text></View>
          <View style={nc.row}>
            <Text style={nc.rowLabel}>NAME</Text>
            <TextInput
              style={[nc.input, HARD_SHADOW]}
              value={searchName}
              onChangeText={setSearchName}
              onSubmitEditing={handleSearch}
              returnKeyType="search"
              placeholder="Spieler oder Verein eingeben …"
              placeholderTextColor={RETRO.textMuted}
            />
          </View>
          <View style={nc.row}>
            <Text style={nc.rowLabel}>ALTER</Text>
            <View style={nc.btnWrap}>
              {AGE_OPTIONS.map((age) =>
                filterBtn(age === 14 ? '≤14' : String(age), selectedAges.has(age), () => toggleAge(age))
              )}
              {filterBtn('≥33', agePlus, () => setAgePlus((v) => !v))}
            </View>
          </View>
          <View style={nc.row}>
            <Text style={nc.rowLabel}>POSITION</Text>
            <View style={nc.btnWrap}>
              {POSITION_OPTIONS.map((pos) =>
                filterBtn(pos.label, selectedPositions.has(pos.code), () => togglePosition(pos.code))
              )}
            </View>
          </View>
          <View style={[nc.row, { marginBottom: 4 }]}>
            <Text style={nc.rowLabel}>POTENTIAL</Text>
            <View style={nc.btnWrap}>
              {POTENTIAL_OPTIONS.map((v) =>
                filterBtn(String(v), selectedPotentials.has(v), () => togglePotential(v))
              )}
            </View>
          </View>
        </View>

        {/* Karte VEREIN & STATUS */}
        <View style={[nc.card, nc.cardVerein, HARD_SHADOW]}>
          <View style={nc.chip}><Text style={RETRO_CHIP_TEXT as any}>VEREIN & STATUS</Text></View>
          <View style={nc.row}>
            <Text style={nc.rowLabel}>LAND</Text>
            <View style={nc.dropdownWrap}>
              <NationDropdown countries={nationOptions} selected={nations} onChange={setNations} />
            </View>
          </View>
          <View style={nc.row}>
            <Text style={nc.rowLabel}>{vereinslos ? 'LETZTE LIGA' : 'LIGA'}</Text>
            <View style={nc.dropdownWrap}>
              <LeagueDropdown
                options={leaguesForDropdown}
                selected={selectedLeagueIds}
                onChange={setSelectedLeagueIds}
              />
            </View>
          </View>
          {/* Vereins-Filter: alle Vereine mit ihren Mannschaften, suchbar, Mehrfachauswahl */}
          <View style={nc.row}>
            <Text style={nc.rowLabel}>VEREIN</Text>
            <View style={nc.dropdownWrap}>
              <ClubDropdown clubs={clubsForDropdown} selected={selectedClubIds} onChange={setSelectedClubIds} />
            </View>
          </View>
          {/* Marktwert-Korridor: von/bis mit festen Stufen (25 Tsd. bis 200 Mio.) */}
          <View style={nc.row}>
            <Text style={nc.rowLabel}>MARKTWERT</Text>
            <View style={[nc.dropdownWrap, nc.mvRange]}>
              <MvField value={mvMin} onChange={setMvMin} />
              <Text style={nc.mvRangeDash}>-</Text>
              <MvField value={mvMax} onChange={setMvMax} />
            </View>
          </View>
          <View style={nc.checkGroupCols}>
            <View style={nc.checkCol}>
              {checkbox('vereinslos', vereinslos, () => setVereinslos((v) => !v))}
              {checkbox('Vertrag läuft aus', contractExpiring, () => setContractExpiring((v) => !v))}
            </View>
            <View style={nc.checkCol}>
              {checkbox('auf der Watchlist', aufWatchlist, () => setAufWatchlist((v) => !v))}
            </View>
          </View>
        </View>

        {/* Karte BERATER: alle beraterbezogenen Filter; bei aktivem Wechsel-Filter
            zeigt die Ergebnistabelle "wer -> wohin" + Datum */}
        <View style={[nc.card, nc.cardBerater, HARD_SHADOW]}>
          <View style={nc.chip}><Text style={RETRO_CHIP_TEXT as any}>BERATER</Text></View>
          {/* Zeitraum-Regler wie beim Potential: −/+ Kästchen + schmale Linie, 0 (aus) bis 30 Tage */}
          <View style={nc.row}>
            <Text style={[nc.rowLabel, nc.wechselLabel]}>NEUER BERATER SEIT</Text>
            <View style={nc.wechselSliderRow}>
              <TouchableOpacity
                style={[nc.stepBtn, HARD_SHADOW]}
                onPress={() => setWechselTage((v) => Math.max(0, v - 1))}
                activeOpacity={0.7}
                hitSlop={4}
              >
                <Text style={nc.stepBtnText}>−</Text>
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <RatingBar value={wechselTage} onChange={setWechselTage} bare noThumb max={30} />
              </View>
              <TouchableOpacity
                style={[nc.stepBtn, HARD_SHADOW]}
                onPress={() => setWechselTage((v) => Math.min(30, v + 1))}
                activeOpacity={0.7}
                hitSlop={4}
              >
                <Text style={nc.stepBtnText}>+</Text>
              </TouchableOpacity>
              <Text style={nc.wechselValue}>{wechselTage > 0 ? `${wechselTage} ${wechselTage === 1 ? 'Tag' : 'Tagen'}` : 'aus'}</Text>
            </View>
          </View>
          <View style={nc.checkGroup}>
            {checkbox('ohne Berater', ohneBerater, () => setOhneBerater((v) => !v))}
            {checkbox('Glocke aktiv (Beraterstatus-Alarm)', nurGlocke, () => setNurGlocke((v) => !v))}
          </View>
        </View>
      </View>

      {/* Statuszeile: aktive Filter + Aktionen */}
      <View style={nc.actionStrip}>
        <Text style={nc.summaryText} numberOfLines={1}>{filterSummary}</Text>
        <View style={{ flex: 1 }} />
        <TouchableOpacity style={[nc.stripBtn, HARD_SHADOW]} onPress={handleReset} activeOpacity={0.7}>
          <Text style={nc.stripBtnText}>Zurücksetzen</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[nc.stripBtn, nc.stripBtnGreen, HARD_SHADOW]}
          onPress={handleSearch}
          disabled={searching}
          activeOpacity={0.7}
        >
          {searching ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Text style={[nc.stripBtnText, nc.stripBtnTextGreen]}>Suchen</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderContent = () => {
    const showResults = sortedResults !== null;

    // Desktop: Filterkarten oben fest, Ergebnisse als eigene Karte mit interner Liste
    if (!isMobile) {
      return (
        <View style={styles.tabContent}>
          {renderSearchPanel()}
          {showResults && (
            <View style={[nc.resultCard, HARD_SHADOW]}>
              <View style={[nc.chip, nc.chipGreen]}>
                <Text style={RETRO_CHIP_TEXT as any}>{`ERGEBNISSE (${sortedResults!.length})`}</Text>
              </View>
              {hiddenNoPosition > 0 && (
                <Text style={nc.resultHint}>
                  {`${hiddenNoPosition} weitere ohne Positionsangabe ausgeblendet`}
                </Text>
              )}
              <View onLayout={(e) => setTableWidth(e.nativeEvent.layout.width)}>
                {tableWidth > 0 && (
                  <TableHeader
                    columnDefs={activeColumns}
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
              <FlatList
                style={nc.resultList}
                data={sortedResults as any[]}
                renderItem={renderTableRow as any}
                keyExtractor={(item: any) => item.id}
                ListEmptyComponent={
                  !loading && !searching
                    ? renderEmpty('Keine Spieler gefunden', 'Passe die Filter an und suche erneut.')
                    : null
                }
                initialNumToRender={20}
                maxToRenderPerBatch={30}
                windowSize={10}
              />
            </View>
          )}
        </View>
      );
    }

    // Mobile: eine Liste, Filter als Header, Treffer als Karten
    return (
      <FlatList
        style={styles.tabContent}
        data={(showResults ? sortedResults : []) as any[]}
        renderItem={renderSearchResult as any}
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
      {/* Header (gelber Titelbalken wie im Dashboard) */}
      <RetroHeader
        title="Suchmaschine"
        subtitle="Spielerdatenbank durchsuchen"
        onBack={() => navigation.goBack()}
      />

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={RETRO.headerBg} />
        </View>
      ) : (
        renderContent()
      )}

      {/* Spieler-Detail-Modal (geteilte Komponente, identisch im Sportstipendium-Board) */}
      {detailPlayer && (() => {
        const p = detailPlayer;
        const added = !!(p.tm_player_id && addedTmIds.has(p.tm_player_id));
        return (
          <PlayerDetailModal
            player={p}
            onClose={() => setDetailPlayer(null)}
            onStatusChanged={(s) => {
              setWatchlistIds((prev) => {
                const next = new Set(prev);
                if (s === 'watchlist' || s === 'top_ziel') next.add(p.id);
                else next.delete(p.id);
                return next;
              });
              setStatusMap((prev) => {
                const next = new Map(prev);
                if (s === 'uninteressant') next.set(p.id, 'nicht_interessant');
                else if (s === 'top_ziel') next.set(p.id, 'top_ziel');
                else next.set(p.id, 'interessant');
                return next;
              });
            }}
            onCreateReport={(navParams) => {
              returnToPlayerRef.current = p;
              setDetailPlayer(null);
              (navigation as any).navigate('PlayerEvaluation', navParams);
            }}
            onOpenEvaluation={(ev) => {
              returnToPlayerRef.current = p;
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
                beraterPlayerId: p.id,
              });
            }}
            actions={
              <>
                {added ? (
                  <View style={[styles.detailActionButton, { backgroundColor: '#1a5f2a' }]}>
                    <Text style={[styles.detailActionText, { color: '#ffffff' }]}>im Sportstipendium</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={[styles.detailActionButton, { backgroundColor: '#ffffff' }, HARD_SHADOW]}
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
              </>
            }
          />
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
    paddingVertical: 12,
    paddingHorizontal: 20,
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
    fontSize: 14,
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
    fontSize: 11,
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
    fontSize: 11,
    fontWeight: '600',
  },
  addedBadgeIcon: {
    fontSize: 13,
  },

  // Ergebnistabelle (Desktop)
  tableRow: {
    borderBottomWidth: 1,
    paddingVertical: 6,
    // gleiche Einrückung wie der Tabellenkopf (headerRow paddingHorizontal 10)
    paddingHorizontal: 10,
  },
  tableCell: {
    fontSize: 13,
  },
  tableCellBold: {
    fontSize: 13,
    fontWeight: '600',
  },
  tableCellMono: {
    fontSize: 13,
    fontFamily: MONO,
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
    fontSize: 11,
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
    fontSize: 16,
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
    borderWidth: 0, // randlos, nur Schatten
    backgroundColor: '#ffffff', // weiße Fläche — hebt sich vom Papier-Hintergrund ab
    paddingHorizontal: 10,
    paddingVertical: 5,
    minHeight: 24,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 160,
    ...HARD_SHADOW, // gleicher Versatz-Schatten (unten + rechts) wie alle Flächen
  },
  detailActionText: {
    fontSize: 11,
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

// ============================================================================
// Neue Karten-Optik (weiße Karten + blaue Chips, wie Dashboard/Spielerprofil)
// ============================================================================

const nc = StyleSheet.create({
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    marginTop: 12,
    marginBottom: 4,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 2,
    paddingHorizontal: 12,
    paddingTop: 16,
    paddingBottom: 10,
  },
  // Spieler-Karte schmaler (Alter bricht früher um), dafür Karte 2+3 breiter
  cardSpieler: {
    flexGrow: 1.2,
    flexShrink: 1,
    flexBasis: 400,
    minWidth: 320,
  },
  cardVerein: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 300,
    minWidth: 260,
  },
  cardBerater: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 300,
    minWidth: 260,
  },
  chip: {
    ...RETRO_CHIP,
  },
  chipGreen: {
    backgroundColor: '#1a5f2a',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 7,
  },
  rowLabel: {
    width: 92,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1.5,
    fontFamily: MONO,
    color: RETRO.textMuted,
  },
  input: {
    flex: 1,
    maxWidth: 560,
    backgroundColor: RETRO.inputBg,
    borderRadius: 0,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 13,
    color: RETRO.text,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  btnWrap: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
    paddingVertical: 2,
  },
  filterBtn: {
    backgroundColor: RETRO.face,
    borderRadius: 0,
    paddingHorizontal: 6,
    paddingVertical: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Auswahl blau (Retro-Blau), nicht grün
  filterBtnSelected: {
    backgroundColor: RETRO.headerBg,
  },
  filterBtnText: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: MONO,
    color: RETRO.text,
  },
  filterBtnTextSelected: {
    color: '#ffffff',
  },
  dropdownWrap: {
    flex: 1,
    maxWidth: 320,
  },
  mvRange: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mvRangeDash: {
    fontSize: 13,
    fontWeight: '600',
    color: RETRO.textMuted,
  },
  checkGroup: {
    marginTop: 6,
    marginBottom: 2,
    gap: 8,
  },
  wechselSliderRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  wechselLabel: {
    width: 148,
  },
  wechselValue: {
    fontSize: 13,
    fontWeight: '700',
    color: RETRO.text,
    minWidth: 62,
    textAlign: 'right',
  },
  // −/+ Kästchen wie beim Potential-Regler (grau, randlos, harter Schatten)
  stepBtn: {
    width: 22,
    height: 22,
    borderRadius: 0,
    backgroundColor: '#e6e2da',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#14141e',
    lineHeight: 16,
  },
  // Checkboxen zweispaltig (3 + 3), spart Höhe
  checkGroupCols: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 6,
    marginBottom: 2,
  },
  checkCol: {
    flex: 1,
    gap: 8,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  checkBox: {
    width: 15,
    height: 15,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: RETRO.shadowDark,
    backgroundColor: RETRO.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBoxChecked: {
    backgroundColor: '#1a5f2a',
    borderColor: '#1a5f2a',
  },
  checkMark: {
    fontSize: 10,
    fontWeight: '700',
    color: '#ffffff',
    lineHeight: 13,
  },
  checkLabel: {
    fontSize: 13,
    color: RETRO.text,
  },
  actionStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
    marginBottom: 14,
    paddingHorizontal: 2,
  },
  summaryText: {
    fontSize: 11,
    fontFamily: MONO,
    color: RETRO.textMuted,
    flexShrink: 1,
  },
  // Buttons auf Papier-Hintergrund: weiße Fläche (Retro-Regel)
  stripBtn: {
    backgroundColor: '#ffffff',
    borderRadius: 0,
    paddingHorizontal: 16,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 110,
  },
  stripBtnGreen: {
    backgroundColor: '#1a5f2a',
  },
  stripBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: RETRO.text,
  },
  stripBtnTextGreen: {
    color: '#ffffff',
  },
  resultCard: {
    backgroundColor: '#ffffff',
    borderRadius: 2,
    paddingHorizontal: 12,
    paddingTop: 16,
    paddingBottom: 8,
    marginBottom: 14,
    flexShrink: 1,
    minHeight: 120,
  },
  resultHint: {
    fontSize: 11,
    fontFamily: MONO,
    color: RETRO.textMuted,
    marginBottom: 4,
  },
  resultList: {
    flexGrow: 0,
    flexShrink: 1,
  },
  potBadge: {
    minWidth: 26,
    height: 22,
    paddingHorizontal: 5,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  potBadgeText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#ffffff',
  },
  headerBox: {
    backgroundColor: '#ffffff',
    borderRadius: 2,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  headerBoxText: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: MONO,
    color: RETRO.text,
  },
});
