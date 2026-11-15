import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { Dropdown } from './Dropdown';
import { TeamLogo } from './ClubLogo';
import { RETRO, MONO, HARD_SHADOW } from '../theme/retro';
import { SAFE_BOTTOM } from '../utils/safeArea';
import { loadTopscorers, TopscorerRow } from '../services/beraterService';
import { ColumnDef } from '../types/tableColumns';
import { useTableColumns } from '../hooks/useTableColumns';
import { TableHeader } from './table/TableHeader';
import { TableRow } from './table/TableRow';
import { WatchlistBadge } from './WatchlistBadge';
import { formatAlter } from '../utils/formatAlter';

/**
 * Topscorer-Liste (Matti 2026-11-13): Tore und Vorlagen pro Liga und Jahrgang, nur für Berater.
 * Daten: berater_player_stats (Top 25 je Liga und Statistik, jeden Montag über fetch-player-rankings).
 * Sortierung Tore zeigt nur die Torliste jeder Liga (Top 25, bei Gleichstand auf Platz 25 mehr), Vorlagen nur
 * die Vorlagenliste, Tore + Vorlagen beide (Matti 2026-11-14: Vorlagengeber haben bei den Torjägern nichts
 * verloren). Die jeweils andere Zahl und die Spiele kommen über tmapi dazu.
 * Spalten (Matti 2026-11-15): Name wie in der KMH-App (NACHNAME fett, Vorname dünn), Geburtsdatum,
 * Position, Verein, Liga, Spiele, Tore, Vorlagen, Berater. Vertrag, Marktwert und Watchlist nur im Spielerprofil.
 */

type Sort = 'goals' | 'assists' | 'both';

// Ligen für die Anzeige: U19- und U17-Gruppen (Vorrunde und Hauptrunde) laufen als eine
// "U19 Nachwuchsliga" bzw. "U17 Nachwuchsliga" (Matti 2026-11-13, Name seit 2026-11-14), Tore der Saison werden addiert.
const leagueKey = (id: string): string =>
  id.startsWith('U19') || id.startsWith('19L') ? 'U19' : id.startsWith('U17') || id.startsWith('17L') ? 'U17' : id;
const LEAGUE_LABELS: Record<string, string> = {
  L1: '1. Bundesliga', L2: '2. Bundesliga', L3: '3. Liga',
  RLN3: 'RL Nord', RLN4: 'RL Nordost', RLW3: 'RL West', RLSW: 'RL Südwest', RLB3: 'RL Bayern',
  U19: 'U19 Nachwuchsliga', U17: 'U17 Nachwuchsliga',
};
const leagueLabel = (key: string): string => LEAGUE_LABELS[key] || key;
const LEAGUE_ORDER = ['L1', 'L2', 'L3', 'RLN3', 'RLN4', 'RLW3', 'RLSW', 'RLB3', 'U19', 'U17'];

const birthYear = (d: string | null): string | null => d?.match(/(\d{4})$/)?.[1] ?? null;
// Alter wie in der Watchlist: "16 J. (08.03.10)", ohne volles Datum nur der Jahrgang (Matti 2026-11-15)
const alterLabel = (d: string | null): string => (d && /^\d{2}\.\d{2}\.\d{4}$/.test(d) ? formatAlter(d) : birthYear(d) || '–');
// Nur das Alter für die Handy-Karte: "16 J."
const ageOnly = (d: string | null): string | null => alterLabel(d).match(/^\d+ J\./)?.[0] ?? null;
// Nachname wie in der KMH-App: letztes Wort samt Namenszusatz ("van den Heuvel", "Ben Balla")
const NAME_PARTICLES = new Set(['van', 'von', 'de', 'da', 'di', 'del', 'der', 'den', 'dos', 'das', 'ter', 'ten', 'le', 'la', 'el', 'al', 'ben']);
const splitName = (full: string): { first: string; last: string } => {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return { first: '', last: full };
  let i = parts.length - 1;
  while (i > 1 && NAME_PARTICLES.has(parts[i - 1].toLowerCase())) i--;
  return { first: parts.slice(0, i).join(' '), last: parts.slice(i).join(' ') };
};
// "Sturm - Mittelstürmer" -> "Mittelstürmer"
const shortPosition = (p: string | null): string | null => (p ? p.split(' - ').pop() || p : null);

interface ScorerEntry {
  tm_player_id: string;
  player_id: string | null;
  player_name: string;
  club_name: string | null;
  club_tm_id: string | null;
  leagues: string[];
  games: number | null;
  goals: number | null;
  assists: number | null;
  year: string | null;
  position: string | null;
  agent_name: string | null;
  tm_profile_url: string | null;
  birth_date: string | null;
  inGoals: boolean;   // steht in der Torliste einer gewählten Liga
  inAssists: boolean; // steht in der Vorlagenliste einer gewählten Liga
}

const PAGE = 60;

// Spalten am Desktop: Breite ziehen und Reihenfolge per Drag tauschen wie in der KMH-App (Matti 2026-11-15),
// der Stand bleibt gespeichert. Spiele, Tore und Vorlagen sind ein Block und wandern zusammen (Matti 2026-11-15).
const COLUMNS: ColumnDef[] = [
  { key: 'rank', label: '#', defaultFlex: 0.25, minWidth: 30 },
  { key: 'name', label: 'Name', defaultFlex: 1.6, minWidth: 150 },
  { key: 'alter', label: 'Alter', defaultFlex: 0.8, minWidth: 95 },
  { key: 'pos', label: 'Position', defaultFlex: 1, minWidth: 90 },
  { key: 'verein', label: 'Verein', defaultFlex: 1.4, minWidth: 120 },
  { key: 'liga', label: 'Liga', defaultFlex: 0.9, minWidth: 80 },
  // Beschriftung kommt über renderHeaderExtra (drei Unterspalten); das unsichtbare Zeichen hält den Ziehstrich davor
  { key: 'stats', label: '\u200b', defaultFlex: 1.15, minWidth: 132 },
  { key: 'berater', label: 'Berater', defaultFlex: 1.1, minWidth: 90 },
];
const HEADER_COLORS = {
  surfaceSecondary: RETRO.headerBg, border: RETRO.headerBg, text: RETRO.yellow,
  textSecondary: RETRO.headerText, primary: RETRO.yellow,
};

export function TopscorerView({
  isMobile,
  clubLogoMap,
  watchlistIds,
  onOpenPlayer,
  onStandChange,
}: {
  isMobile: boolean;
  clubLogoMap: Map<string, string>;
  /** berater_players-IDs auf der Watchlist: grünes W hinter dem Namen */
  watchlistIds: Set<string>;
  onOpenPlayer: (tmPlayerId: string, name: string) => void;
  /** Stand der Daten ("Sa, 14.11."), steht im gelben Kopf der Suchmaschine (Matti 2026-11-14) */
  onStandChange?: (stand: string | null) => void;
}) {
  const [rows, setRows] = useState<TopscorerRow[] | null>(null);
  const [leagueFilter, setLeagueFilter] = useState<string[]>([]);
  const [sort, setSort] = useState<Sort>('goals');
  const [visible, setVisible] = useState(PAGE);
  const [tableWidth, setTableWidth] = useState(0);
  const table = useTableColumns(COLUMNS, tableWidth, 'topscorer_v3');

  useEffect(() => {
    loadTopscorers().then(setRows).catch(() => setRows([]));
  }, []);
  useEffect(() => setVisible(PAGE), [leagueFilter, sort]);

  const leagueKeys = useMemo(() => {
    const keys = Array.from(new Set((rows || []).map((r) => leagueKey(r.league_id))));
    const rank = (k: string) => (LEAGUE_ORDER.indexOf(k) + 1 || 99);
    return keys.sort((a, b) => rank(a) - rank(b));
  }, [rows]);

  // Regionalligen als aufklappbare Gruppe: Häkchen wählt alle, Pfeil zeigt die einzelnen (Matti 2026-11-14)
  const leagueOptions = useMemo(() => {
    const opts: { value: string; label: string; isGroup?: boolean; group?: string }[] =
      leagueKeys.map((k) => ({ value: k, label: leagueLabel(k), group: k.startsWith('RL') ? 'grp:rl' : undefined }));
    const firstRl = opts.findIndex((o) => o.value.startsWith('RL'));
    if (firstRl >= 0) opts.splice(firstRl, 0, { value: 'grp:rl', label: 'Alle Regionalligen', isGroup: true });
    return opts;
  }, [leagueKeys]);

  // Spieler zusammenfassen (Tore und Vorlagen, mehrere Ligen z. B. Vorrunde + Hauptrunde)
  const entries = useMemo(() => {
    if (!rows) return [];
    const inLeague = (key: string) =>
      leagueFilter.length === 0 || leagueFilter.includes(key);
    // Schwelle je Liste = Wert auf dem letzten Listenplatz. Wer gleich viel hat, gehört mit in die Liste,
    // auch wenn er nur über die andere Liste bei uns ist (TM schneidet nach Platz 25 ab).
    const cut = new Map<string, number>();
    for (const r of rows) {
      if (r.rank_in_league == null) continue;
      const k = `${r.league_id}|${r.stat_type}`;
      cut.set(k, Math.min(cut.get(k) ?? Infinity, r.stat_value));
    }
    const inList = (r: TopscorerRow) => r.stat_value > 0 && r.stat_value >= (cut.get(`${r.league_id}|${r.stat_type}`) ?? Infinity);
    const map = new Map<string, ScorerEntry & { gamesByLeague: Map<string, number> }>();
    for (const r of rows) {
      const key = leagueKey(r.league_id);
      if (!inLeague(key)) continue;
      let e = map.get(r.tm_player_id);
      if (!e) {
        e = {
          tm_player_id: r.tm_player_id, player_id: r.player_id, player_name: r.player_name,
          club_name: r.club_name, club_tm_id: r.club_tm_id, leagues: [], games: null, goals: null, assists: null,
          year: birthYear(r.birth_date), position: shortPosition(r.position), agent_name: r.agent_name,
          tm_profile_url: r.tm_profile_url, birth_date: r.birth_date, gamesByLeague: new Map(),
          inGoals: false, inAssists: false,
        };
        map.set(r.tm_player_id, e);
      }
      if (!e.leagues.includes(key)) e.leagues.push(key);
      if (r.games_played != null) e.gamesByLeague.set(r.league_id, r.games_played);
      if (r.stat_type === 'goals') e.goals = (e.goals ?? 0) + r.stat_value;
      else e.assists = (e.assists ?? 0) + r.stat_value;
      if (inList(r)) {
        if (r.stat_type === 'goals') e.inGoals = true;
        else e.inAssists = true;
      }
      e.player_id = e.player_id || r.player_id;
      e.year = e.year || birthYear(r.birth_date);
      e.position = e.position || shortPosition(r.position);
      e.agent_name = e.agent_name || r.agent_name;
    }
    const value = (e: ScorerEntry) =>
      sort === 'goals' ? e.goals ?? -1 : sort === 'assists' ? e.assists ?? -1 : (e.goals ?? 0) + (e.assists ?? 0);
    return Array.from(map.values())
      .map((e) => ({ ...e, games: e.gamesByLeague.size ? Array.from(e.gamesByLeague.values()).reduce((a, b) => a + b, 0) : null }))
      .filter((e) => (sort === 'goals' ? e.inGoals : sort === 'assists' ? e.inAssists : e.inGoals || e.inAssists))
      .sort((a, b) => value(b) - value(a) || (b.goals ?? 0) + (b.assists ?? 0) - ((a.goals ?? 0) + (a.assists ?? 0)) || a.player_name.localeCompare(b.player_name));
  }, [rows, leagueFilter, sort]);

  const lastUpdate = useMemo(() => {
    const max = (rows || []).reduce((m, r) => (r.updated_at > m ? r.updated_at : m), '');
    return max ? new Date(max).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }) : null;
  }, [rows]);
  useEffect(() => onStandChange?.(lastUpdate), [lastUpdate, onStandChange]);

  const sortLabel = sort === 'goals' ? 'TORE' : sort === 'assists' ? 'VORL.' : 'T+V';
  const num = (v: number | null) => (v == null ? '–' : String(v));

  const SORT_LABELS: Record<Sort, string> = { goals: 'TORE', assists: 'VORLAGEN', both: 'TORE + VORLAGEN' };
  const SORTS: Sort[] = ['goals', 'assists', 'both'];

  // Reiter Tore / Vorlagen / Tore + Vorlagen als Chips (Matti 2026-11-14): Desktop auf der Tabellenkante,
  // Handy als Reihe über den Karten
  const sortChips = (mobile: boolean) => (
    <View style={mobile ? s.chipsMobile : s.chips}>
      {SORTS.map((k) => (
        <TouchableOpacity key={k} onPress={() => setSort(k)} style={[s.chip, mobile && s.chipMobile, HARD_SHADOW, sort === k && s.chipOn]} activeOpacity={0.7}>
          <Text style={[s.chipText, sort === k && s.chipTextOn]} numberOfLines={1}>{SORT_LABELS[k]}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  const filters = (
    <View style={[s.filters, isMobile && s.filtersMobile]}>
      <View style={isMobile ? s.filterFull : s.filterBox}>
        <Dropdown options={leagueOptions} value={leagueFilter} onChange={(v) => setLeagueFilter(v as string[])} placeholder="Alle Wettbewerbe" multiSelect compact alignRight />
      </View>
    </View>
  );

  if (!rows) {
    return <View style={s.loading}><ActivityIndicator size="large" color={RETRO.headerBg} /></View>;
  }

  const shown = entries.slice(0, visible);
  const onScroll = (ev: any) => {
    const { layoutMeasurement, contentOffset, contentSize } = ev.nativeEvent;
    if (layoutMeasurement.height + contentOffset.y > contentSize.height - 400 && visible < entries.length) {
      setVisible((v) => v + PAGE);
    }
  };
  const empty = <Text style={s.empty}>Keine Spieler für diese Auswahl.</Text>;


  // Name wie in der KMH-App: NACHNAME groß und fett, Vorname dünn in Grau dahinter (Matti 2026-11-15)
  const nameText = (e: ScorerEntry, mobile = false) => {
    const { first, last } = splitName(e.player_name);
    return (
      <View style={[s.nameRow, { flexShrink: 1 }]}>
        <Text style={[s.name, mobile && s.nameMobile, { flexShrink: 1 }]} numberOfLines={1}>
          {last.toUpperCase()}
          {!!first && <Text style={[s.first, mobile && s.firstMobile]}> {first}</Text>}
        </Text>
        {!!e.player_id && watchlistIds.has(e.player_id) && <WatchlistBadge />}
      </View>
    );
  };

  if (isMobile) {
    return (
      <View style={{ flex: 1 }}>
        {filters}
        {sortChips(true)}
        <ScrollView onScroll={onScroll} scrollEventThrottle={200} contentContainerStyle={{ paddingBottom: 24 + SAFE_BOTTOM }}>
          {shown.length === 0 && empty}
          {shown.map((e) => {
            const main = sort === 'goals' ? e.goals : sort === 'assists' ? e.assists : (e.goals ?? 0) + (e.assists ?? 0);
            const extra = sort === 'goals' ? (e.assists != null ? `${e.assists} Vorl.` : null) : sort === 'assists' ? (e.goals != null ? `${e.goals} Tore` : null) : null;
            return (
              <View key={e.tm_player_id} style={s.card}>
                <View style={s.cardLeft}>
                  <Text style={s.cardBig}>{num(main)}</Text>
                  <Text style={s.cardLbl}>{sortLabel}</Text>
                </View>
                <View style={s.cardRight}>
                  <TouchableOpacity onPress={() => onOpenPlayer(e.tm_player_id, e.player_name)} activeOpacity={0.7} style={s.nameRow}>
                    {nameText(e, true)}
                    {!!ageOnly(e.birth_date) && <Text style={s.ageMeta}>{`(${ageOnly(e.birth_date)})`}</Text>}
                  </TouchableOpacity>
                  {!!e.position && <Text style={s.meta} numberOfLines={1}>{e.position}</Text>}
                  <Text style={s.club} numberOfLines={1}>
                    {[e.club_name, e.leagues.map(leagueLabel).join(' / ')].filter(Boolean).join(' · ')}
                  </Text>
                  <Text style={s.meta} numberOfLines={1}>
                    {[
                      e.games != null ? `${e.games} Sp.` : null,
                      extra,
                      e.agent_name,
                    ].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              </View>
            );
          })}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {filters}
      <View style={[s.panel, HARD_SHADOW]}>
        {sortChips(false)}
        <View onLayout={(ev) => setTableWidth(ev.nativeEvent.layout.width - 24)}>
          {tableWidth > 0 && (
            <TableHeader
              columnDefs={COLUMNS}
              columnOrder={table.columnOrder}
              getColumnWidth={table.getColumnWidth}
              onResizeStart={table.onResizeStart}
              onDragStart={table.onDragStart}
              resizingKey={table.resizingKey}
              draggingKey={table.draggingKey}
              dragOverKey={table.dragOverKey}
              colors={HEADER_COLORS}
              setHeaderRef={table.setHeaderRef}
              style={s.thead}
              textStyle={s.th}
              lineColor="rgba(255,255,255,0.5)"
              renderHeaderExtra={(key) =>
                key === 'stats' ? (
                  <View style={s.statsRow}>
                    {['SP', 'TORE', 'VORL.'].map((l) => <Text key={l} style={[s.th, s.statsHead]} numberOfLines={1}>{l}</Text>)}
                  </View>
                ) : null
              }
            />
          )}
        </View>
        <ScrollView onScroll={onScroll} scrollEventThrottle={200} style={{ flex: 1 }}>
          {shown.length === 0 && empty}
          {tableWidth > 0 && shown.map((e, i) => (
            <TableRow
              key={e.tm_player_id}
              columnOrder={table.columnOrder}
              getColumnWidth={table.getColumnWidth}
              style={s.tr}
              renderCell={(key) => {
                switch (key) {
                  case 'rank': return <Text style={s.rank}>{i + 1}</Text>;
                  case 'name':
                    return (
                      <TouchableOpacity style={s.full} onPress={() => onOpenPlayer(e.tm_player_id, e.player_name)} activeOpacity={0.7}>
                        {nameText(e)}
                      </TouchableOpacity>
                    );
                  case 'alter': return <Text style={s.cell} numberOfLines={1}>{alterLabel(e.birth_date)}</Text>;
                  case 'pos': return <Text style={s.cell} numberOfLines={1}>{e.position || '–'}</Text>;
                  case 'verein':
                    return (
                      <View style={[s.full, s.clubCell]}>
                        {!!e.club_name && <TeamLogo name={e.club_name} map={clubLogoMap} size={16} teamId={e.club_tm_id} />}
                        <Text style={s.cell} numberOfLines={1}>{e.club_name || ''}</Text>
                      </View>
                    );
                  case 'liga': return <Text style={s.cell} numberOfLines={1}>{e.leagues.map(leagueLabel).join(' / ')}</Text>;
                  case 'stats':
                    return (
                      <View style={s.statsRow}>
                        <Text style={[s.numCell, s.statsCell, s.muted]}>{num(e.games)}</Text>
                        <Text style={[s.numCell, s.statsCell, sort !== 'assists' && s.hi, e.goals == null && s.muted]}>{num(e.goals)}</Text>
                        <Text style={[s.numCell, s.statsCell, sort !== 'goals' && s.hi, e.assists == null && s.muted]}>{num(e.assists)}</Text>
                      </View>
                    );
                  case 'berater': return <Text style={s.agent} numberOfLines={1}>{e.agent_name || ''}</Text>;
                  default: return null;
                }
              }}
            />
          ))}
        </ScrollView>
        <Text style={s.foot}>Tore: die 25 besten Torschützen jeder Liga, Vorlagen: die 25 besten Vorlagengeber, bei Gleichstand auf Platz 25 auch mehr. Klick auf den Namen öffnet das Spielerprofil.</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12 },
  filtersMobile: { paddingHorizontal: 12, paddingTop: 12, gap: 8 },
  filterBox: { width: 200 },
  filterFull: { flex: 1 },
  chips: { position: 'absolute', top: -11, left: 10, flexDirection: 'row', gap: 6, zIndex: 2 },
  chipsMobile: { flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingBottom: 10 },
  chipMobile: { flexGrow: 1, alignItems: 'center', paddingVertical: 7 },
  chip: { backgroundColor: RETRO.face, borderRadius: 2, paddingHorizontal: 9, paddingVertical: 4 },
  chipOn: { backgroundColor: RETRO.headerBg },
  chipText: { fontFamily: MONO, fontSize: 10, fontWeight: '700', letterSpacing: 1.5, color: RETRO.textMuted },
  chipTextOn: { color: RETRO.white },
  panel: { flex: 1, backgroundColor: RETRO.white, marginHorizontal: 16, marginTop: 16, marginBottom: 16, paddingTop: 14 },
  thead: { height: 32, paddingVertical: 0, paddingHorizontal: 12, borderBottomWidth: 0 },
  th: { fontSize: 11, fontWeight: '600', letterSpacing: 0.3, color: RETRO.headerText },
  tr: { minHeight: 48, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: RETRO.rowBorder },
  full: { alignSelf: 'stretch', minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  statsRow: { flex: 1, alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 4 },
  statsHead: { flex: 1, textAlign: 'center' },
  statsCell: { flex: 1, alignSelf: 'auto' },
  clubCell: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rank: { fontSize: 13, fontFamily: MONO, color: RETRO.textMuted },
  name: { fontSize: 13, fontWeight: '700', color: RETRO.text, lineHeight: 17 },
  first: { fontSize: 13, fontWeight: '400', color: RETRO.textMuted },
  nameMobile: { fontSize: 14, fontWeight: '600', lineHeight: 18 },
  firstMobile: { fontSize: 14 },
  ageMeta: { fontSize: 11, fontFamily: MONO, fontWeight: '600', color: RETRO.textMuted, flexShrink: 0 },
  club: { fontSize: 13, color: RETRO.text },
  cell: { fontSize: 13, color: RETRO.text, flexShrink: 1 },
  muted: { color: RETRO.textMuted },
  numCell: { alignSelf: 'stretch', textAlign: 'center', fontSize: 13, fontFamily: MONO, color: RETRO.text, fontVariant: ['tabular-nums'] },
  hi: { backgroundColor: RETRO.yellow, paddingVertical: 3, fontWeight: '700' },
  agent: { fontSize: 13, color: RETRO.text },
  foot: { fontFamily: MONO, fontSize: 11, color: RETRO.textMuted, padding: 10 },
  empty: { padding: 24, textAlign: 'center', color: RETRO.textMuted },
  card: { flexDirection: 'row', backgroundColor: RETRO.white, borderBottomWidth: 1, borderBottomColor: RETRO.rowBorder },
  cardLeft: { width: 64, backgroundColor: RETRO.yellow, alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
  cardBig: { fontSize: 24, fontWeight: '800', color: RETRO.text, lineHeight: 30 },
  cardLbl: { fontFamily: MONO, fontSize: 9, letterSpacing: 1, color: RETRO.text },
  cardRight: { flex: 1, minWidth: 0, paddingVertical: 9, paddingHorizontal: 12, gap: 3 },
  meta: { fontSize: 12, color: RETRO.textMuted },
});
