import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { Dropdown } from './Dropdown';
import { TeamLogo } from './ClubLogo';
import { RETRO, MONO, HARD_SHADOW, RETRO_CHIP, RETRO_CHIP_TEXT } from '../theme/retro';
import { SAFE_BOTTOM } from '../utils/safeArea';
import { loadTopscorers, addStatPlayerToWatchlist, TopscorerRow, PlayerStat } from '../services/beraterService';

/**
 * Topscorer-Liste (Matti 2026-11-13): Tore und Vorlagen pro Liga und Jahrgang, nur für Berater.
 * Daten: berater_player_stats (Top 25 je Liga und Statistik, jeden Montag über fetch-player-rankings).
 * Sortierung Tore zeigt nur die Torliste jeder Liga (Top 25, bei Gleichstand auf Platz 25 mehr), Vorlagen nur
 * die Vorlagenliste, Tore + Vorlagen beide (Matti 2026-11-14: Vorlagengeber haben bei den Torjägern nichts
 * verloren). Die jeweils andere Zahl und die Spiele kommen über tmapi dazu.
 */

type Sort = 'goals' | 'assists' | 'both';

// Ligen für die Anzeige: U19- und U17-Gruppen (Vorrunde und Hauptrunde) laufen als eine
// "U19 Bundesliga" bzw. "U17 Bundesliga" (Matti 2026-11-13), Tore der Saison werden addiert.
const leagueKey = (id: string): string =>
  id.startsWith('U19') || id.startsWith('19L') ? 'U19' : id.startsWith('U17') || id.startsWith('17L') ? 'U17' : id;
const LEAGUE_LABELS: Record<string, string> = {
  L1: '1. Bundesliga', L2: '2. Bundesliga', L3: '3. Liga',
  RLN3: 'RL Nord', RLN4: 'RL Nordost', RLW3: 'RL West', RLSW: 'RL Südwest', RLB3: 'RL Bayern',
  U19: 'U19 Bundesliga', U17: 'U17 Bundesliga',
};
const leagueLabel = (key: string): string => LEAGUE_LABELS[key] || key;
// Sammel-Eintrag im Liga-Dropdown
const LEAGUE_GROUPS: Record<string, (key: string) => boolean> = {
  'grp:rl': (key) => key.startsWith('RL'),
};
const LEAGUE_ORDER = ['L1', 'L2', 'L3', 'RLN3', 'RLN4', 'RLW3', 'RLSW', 'RLB3', 'U19', 'U17'];

const birthYear = (d: string | null): string | null => d?.match(/(\d{4})$/)?.[1] ?? null;
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

export function TopscorerView({
  isMobile,
  clubLogoMap,
  watchlistIds,
  onOpenPlayer,
  onAddedToWatchlist,
}: {
  isMobile: boolean;
  clubLogoMap: Map<string, string>;
  watchlistIds: Set<string>;
  onOpenPlayer: (tmPlayerId: string, name: string) => void;
  onAddedToWatchlist: (playerId: string | null) => void;
}) {
  const [rows, setRows] = useState<TopscorerRow[] | null>(null);
  const [leagueFilter, setLeagueFilter] = useState<string[]>([]);
  const [yearFilter, setYearFilter] = useState<string[]>([]);
  const [onlyFree, setOnlyFree] = useState(false);
  const [sort, setSort] = useState<Sort>('goals');
  const [visible, setVisible] = useState(PAGE);
  const [addedTm, setAddedTm] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<string | null>(null);

  useEffect(() => {
    loadTopscorers().then(setRows).catch(() => setRows([]));
  }, []);
  useEffect(() => setVisible(PAGE), [leagueFilter, yearFilter, onlyFree, sort]);

  const leagueKeys = useMemo(() => {
    const keys = Array.from(new Set((rows || []).map((r) => leagueKey(r.league_id))));
    const rank = (k: string) => (LEAGUE_ORDER.indexOf(k) + 1 || 99);
    return keys.sort((a, b) => rank(a) - rank(b));
  }, [rows]);

  const leagueOptions = useMemo(() => {
    const opts = leagueKeys.map((k) => ({ value: k, label: leagueLabel(k) }));
    const firstRl = opts.findIndex((o) => o.value.startsWith('RL'));
    if (firstRl >= 0) opts.splice(firstRl, 0, { value: 'grp:rl', label: 'Alle Regionalligen' });
    return opts;
  }, [leagueKeys]);

  // Spieler zusammenfassen (Tore und Vorlagen, mehrere Ligen z. B. Vorrunde + Hauptrunde)
  const entries = useMemo(() => {
    if (!rows) return [];
    const inLeague = (key: string) =>
      leagueFilter.length === 0 ||
      leagueFilter.some((f) => (LEAGUE_GROUPS[f] ? LEAGUE_GROUPS[f](key) : f === key));
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
      .filter((e) => yearFilter.length === 0 || (e.year != null && yearFilter.includes(e.year)))
      .filter((e) => !onlyFree || !e.agent_name || /kein beratereintrag|familie/i.test(e.agent_name))
      .filter((e) => (sort === 'goals' ? e.inGoals : sort === 'assists' ? e.inAssists : e.inGoals || e.inAssists))
      .sort((a, b) => value(b) - value(a) || (b.goals ?? 0) + (b.assists ?? 0) - ((a.goals ?? 0) + (a.assists ?? 0)) || a.player_name.localeCompare(b.player_name));
  }, [rows, leagueFilter, yearFilter, onlyFree, sort]);

  const yearOptions = useMemo(() => {
    const years = Array.from(new Set((rows || []).map((r) => birthYear(r.birth_date)).filter(Boolean) as string[]));
    return years.sort((a, b) => b.localeCompare(a)).map((y) => ({ value: y, label: y }));
  }, [rows]);

  const lastUpdate = useMemo(() => {
    const max = (rows || []).reduce((m, r) => (r.updated_at > m ? r.updated_at : m), '');
    return max ? new Date(max).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }) : null;
  }, [rows]);

  const onWatchlist = (e: ScorerEntry) => addedTm.has(e.tm_player_id) || (!!e.player_id && watchlistIds.has(e.player_id));

  const addToWatchlist = async (e: ScorerEntry) => {
    if (adding) return;
    setAdding(e.tm_player_id);
    const stat: PlayerStat = {
      id: '', player_id: e.player_id, tm_player_id: e.tm_player_id, player_name: e.player_name,
      league_id: e.leagues[0], club_name: e.club_name, stat_type: 'goals', stat_value: e.goals ?? 0,
      games_played: e.games, rank_in_league: null, season: null, tm_profile_url: e.tm_profile_url,
      birth_date: e.birth_date, position: e.position, updated_at: '',
    };
    const ok = await addStatPlayerToWatchlist(stat);
    if (ok) {
      setAddedTm((prev) => new Set(prev).add(e.tm_player_id));
      onAddedToWatchlist(e.player_id);
    }
    setAdding(null);
  };

  const sortLabel = sort === 'goals' ? 'TORE' : sort === 'assists' ? 'VORL.' : 'T+V';
  const num = (v: number | null) => (v == null ? '–' : String(v));

  const filters = (
    <View style={[s.filters, isMobile && s.filtersMobile]}>
      <View style={isMobile ? s.filterHalf : s.filterBox}>
        <Dropdown options={leagueOptions} value={leagueFilter} onChange={(v) => setLeagueFilter(v as string[])} placeholder="Alle Ligen" multiSelect compact />
      </View>
      <View style={isMobile ? s.filterHalf : s.filterBox}>
        <Dropdown options={yearOptions} value={yearFilter} onChange={(v) => setYearFilter(v as string[])} placeholder="Alle Jahrgänge" multiSelect compact />
      </View>
      <View style={[s.seg, HARD_SHADOW, isMobile && { width: '100%' }]}>
        {(['goals', 'assists', 'both'] as Sort[]).map((k) => (
          <TouchableOpacity key={k} onPress={() => setSort(k)} style={[s.segBtn, isMobile && { flex: 1 }, sort === k && s.segBtnOn]} activeOpacity={0.7}>
            <Text style={[s.segText, sort === k && s.segTextOn]}>{k === 'goals' ? 'TORE' : k === 'assists' ? 'VORLAGEN' : 'T+V'}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TouchableOpacity onPress={() => setOnlyFree((v) => !v)} style={[s.check, HARD_SHADOW, isMobile && { flex: 1 }]} activeOpacity={0.7}>
        <Text style={s.checkText}>{onlyFree ? '☑' : '☐'} nur ohne Berater</Text>
      </TouchableOpacity>
      {lastUpdate && <Text style={[s.stand, isMobile && { alignSelf: 'center' }]}>{`STAND ${lastUpdate.toUpperCase()}`}</Text>}
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

  const watchBtn = (e: ScorerEntry, short: boolean) =>
    onWatchlist(e) ? (
      <View style={[s.btn, s.btnDone]}><Text style={[s.btnText, s.btnTextDone]}>{short ? '✓' : '✓ AUF WATCHLIST'}</Text></View>
    ) : (
      <TouchableOpacity style={[s.btn, HARD_SHADOW]} onPress={() => addToWatchlist(e)} disabled={adding === e.tm_player_id} activeOpacity={0.7}>
        <Text style={s.btnText}>{adding === e.tm_player_id ? '…' : short ? '+ WL' : '+ WATCHLIST'}</Text>
      </TouchableOpacity>
    );

  if (isMobile) {
    return (
      <View style={{ flex: 1 }}>
        {filters}
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
                  <TouchableOpacity onPress={() => onOpenPlayer(e.tm_player_id, e.player_name)} activeOpacity={0.7}>
                    <Text style={s.name} numberOfLines={1}>{e.player_name}</Text>
                  </TouchableOpacity>
                  <Text style={s.meta} numberOfLines={1}>
                    {[e.year, e.club_name, e.leagues.map(leagueLabel).join(' / ')].filter(Boolean).join(' · ')}
                  </Text>
                  <View style={s.cardRow}>
                    <Text style={[s.meta, { flex: 1 }]} numberOfLines={1}>
                      {[e.games != null ? `${e.games} Sp.` : null, extra, e.agent_name].filter(Boolean).join(' · ')}
                    </Text>
                    {watchBtn(e, true)}
                  </View>
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
        <View style={RETRO_CHIP as any}><Text style={RETRO_CHIP_TEXT as any}>{`TOPSCORER (${entries.length})`}</Text></View>
        <View style={s.thead}>
          <Text style={[s.th, s.cRank]}>#</Text>
          <Text style={[s.th, s.cName]}>SPIELER</Text>
          <Text style={[s.th, s.cClub]}>VEREIN</Text>
          <Text style={[s.th, s.cLeague]}>LIGA</Text>
          <Text style={[s.th, s.cNum]}>SP</Text>
          <Text style={[s.th, s.cNum]}>TORE</Text>
          <Text style={[s.th, s.cNum]}>VORL.</Text>
          <Text style={[s.th, s.cAgent]}>BERATER</Text>
          <View style={s.cBtn} />
        </View>
        <ScrollView onScroll={onScroll} scrollEventThrottle={200} style={{ flex: 1 }}>
          {shown.length === 0 && empty}
          {shown.map((e, i) => (
            <View key={e.tm_player_id} style={s.tr}>
              <Text style={[s.rank, s.cRank]}>{i + 1}</Text>
              <TouchableOpacity style={s.cName} onPress={() => onOpenPlayer(e.tm_player_id, e.player_name)} activeOpacity={0.7}>
                <Text style={s.name} numberOfLines={1}>{e.player_name}</Text>
                <Text style={s.sub} numberOfLines={1}>{[e.year, e.position].filter(Boolean).join(' · ') || ' '}</Text>
              </TouchableOpacity>
              <View style={[s.cClub, s.clubCell]}>
                {!!e.club_name && <TeamLogo name={e.club_name} map={clubLogoMap} size={16} teamId={e.club_tm_id} />}
                <Text style={s.cell} numberOfLines={1}>{e.club_name || ''}</Text>
              </View>
              <Text style={[s.cell, s.muted, s.cLeague]} numberOfLines={1}>{e.leagues.map(leagueLabel).join(' / ')}</Text>
              <Text style={[s.numCell, s.muted, s.cNum]}>{num(e.games)}</Text>
              <Text style={[s.numCell, s.cNum, sort !== 'assists' && s.hi, e.goals == null && s.muted]}>{num(e.goals)}</Text>
              <Text style={[s.numCell, s.cNum, sort !== 'goals' && s.hi, e.assists == null && s.muted]}>{num(e.assists)}</Text>
              <Text style={[s.agent, s.cAgent]} numberOfLines={1}>{e.agent_name || ''}</Text>
              <View style={s.cBtn}>{watchBtn(e, false)}</View>
            </View>
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
  filterHalf: { flexBasis: '45%', flexGrow: 1 },
  seg: { flexDirection: 'row' },
  segBtn: { backgroundColor: RETRO.face, paddingVertical: 7, paddingHorizontal: 12, alignItems: 'center' },
  segBtnOn: { backgroundColor: RETRO.headerBg },
  segText: { fontFamily: MONO, fontSize: 12, fontWeight: '700', letterSpacing: 1, color: RETRO.text },
  segTextOn: { color: RETRO.white },
  check: { backgroundColor: RETRO.white, paddingVertical: 7, paddingHorizontal: 10 },
  checkText: { fontSize: 13, color: RETRO.text },
  stand: { marginLeft: 'auto', fontFamily: MONO, fontSize: 11, color: RETRO.textMuted, letterSpacing: 1 },
  panel: { flex: 1, backgroundColor: RETRO.white, marginHorizontal: 16, marginTop: 10, marginBottom: 16, paddingTop: 14 },
  thead: { flexDirection: 'row', alignItems: 'center', backgroundColor: RETRO.headerBg, height: 32, paddingHorizontal: 12, gap: 8 },
  th: { fontFamily: MONO, fontSize: 11, fontWeight: '700', letterSpacing: 1.5, color: RETRO.headerText },
  tr: { flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: 12, gap: 8, borderBottomWidth: 1, borderBottomColor: RETRO.rowBorder },
  cRank: { width: 34 },
  cName: { flex: 1.4, minWidth: 0 },
  cClub: { flex: 1.2, minWidth: 0 },
  cLeague: { width: 110 },
  cNum: { width: 50, textAlign: 'center' },
  cAgent: { flex: 1, minWidth: 0 },
  cBtn: { width: 128, alignItems: 'flex-end' },
  clubCell: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rank: { fontFamily: MONO, fontWeight: '700', color: RETRO.textMuted },
  name: { fontSize: 14, fontWeight: '700', color: RETRO.text, lineHeight: 18 },
  sub: { fontFamily: MONO, fontSize: 11, color: RETRO.textMuted },
  cell: { fontSize: 13, color: RETRO.text, flexShrink: 1 },
  muted: { color: RETRO.textMuted },
  numCell: { fontSize: 14, fontWeight: '700', color: RETRO.text, fontVariant: ['tabular-nums'] },
  hi: { backgroundColor: RETRO.yellow, paddingVertical: 3 },
  agent: { fontSize: 12, color: RETRO.textMuted },
  btn: { backgroundColor: RETRO.face, paddingVertical: 6, paddingHorizontal: 8 },
  btnDone: { backgroundColor: '#e3efe4' },
  btnText: { fontFamily: MONO, fontSize: 11, fontWeight: '700', letterSpacing: 1, color: RETRO.text },
  btnTextDone: { color: '#1a5f2a' },
  foot: { fontFamily: MONO, fontSize: 11, color: RETRO.textMuted, padding: 10 },
  empty: { padding: 24, textAlign: 'center', color: RETRO.textMuted },
  card: { flexDirection: 'row', backgroundColor: RETRO.white, borderBottomWidth: 1, borderBottomColor: RETRO.rowBorder },
  cardLeft: { width: 64, backgroundColor: RETRO.yellow, alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
  cardBig: { fontSize: 24, fontWeight: '800', color: RETRO.text, lineHeight: 30 },
  cardLbl: { fontFamily: MONO, fontSize: 9, letterSpacing: 1, color: RETRO.text },
  cardRight: { flex: 1, minWidth: 0, paddingVertical: 9, paddingHorizontal: 12, gap: 3 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  meta: { fontSize: 12, color: RETRO.textMuted },
});
