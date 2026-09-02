// DashboardScreen — Startseite im Anstoss-3-Retro-Stil.
// Oben Kennzahlen-Karten, unten "Heute" (nur heutige Spiele) und die zuletzt
// zur Watchlist hinzugefügten Spieler.
import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Pressable,
  Image,
  Platform,
  Linking,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { RootStackParamList } from '../../navigation/types';
import { RETRO, HARD_SHADOW, HARD_SHADOW_LG, MONO } from '../../theme/retro';
import { loadScanStatus, BeraterStats, loadWatchlist, WatchlistEntry, loadAllEvaluations, PlayerEvaluation, loadUnseenAlerts, markAlertSeen, AgentAlertNotification, findAmbiguousMergeCandidates, AmbiguousMerge, mergeScoutedInto } from '../../services/beraterService';
import { areaAge, areaArt, shortVenueName, stripAge, loadClubLogoMap, clubLogoUriFor } from '../../services/areaGamesService';
import { createMatch, deleteMatch } from '../../services/matchService';
import { PlayerDetailModal } from '../../components/PlayerDetailModal';
import { TeamLogo } from '../../components/ClubLogo';
import { fetchSearchPlayer, StipendiumSearchPlayer, positionCode, ageFromBirthDate, agentDisplayName } from '../../services/stipendiumService';
import { BLUE_GRADIENT } from '../../theme/retro';
import { supabase } from '../../config/supabase';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

interface TodayGame {
  key: string;
  matchId: string; // Match-ID im Spiele-Screen ("area:<match_key>" bzw. eigene ID)
  zeit: string | null;
  begegnung: string;
  home: string;
  away: string;
  liga: string;
  art: string;
  ort: string | null;
  fussballDeUrl: string | null;
  isOwn: boolean;
  /** automatisch von dfb.de gesynct (kein "Ich bin dabei"-Marker) */
  isDfb?: boolean;
  matchDate?: string | null;
  matchDateEnd?: string | null;
}

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

/** "Do, 27.08.26" für die Kopfzeile */
function todayHeader(): string {
  const d = new Date();
  return `${WEEKDAYS[d.getDay()]}, ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getFullYear()).slice(-2)}`;
}

/** "Vorname Nachname" -> "Nachname, Vorname" */
// "2026-09-14" → "14.09.26"
function fmtShort(iso?: string | null): string {
  if (!iso) return '-';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return y && m && d ? `${d}.${m}.${y.slice(-2)}` : String(iso);
}

function nameLastFirst(fullName: string): string {
  const parts = (fullName || '').trim().split(/\s+/);
  if (parts.length <= 1) return fullName;
  return `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(' ')}`;
}

export function DashboardScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { signOut } = useAuth();
  const { width } = useWindowDimensions();
  const isMobile = width < 768;

  const [upcomingMatches, setUpcomingMatches] = useState(0);
  const [stipendiumCount, setStipendiumCount] = useState(0);
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);
  const [evaluations, setEvaluations] = useState<Map<string, PlayerEvaluation>>(new Map());
  const [beraterStats, setBeraterStats] = useState<BeraterStats | null>(null);
  const [todayGames, setTodayGames] = useState<TodayGame[]>([]);
  // Wappen-Lookup: normalisierte Vereins-Basis -> tm_club_id
  const [clubLogoMap, setClubLogoMap] = useState<Map<string, string>>(new Map());
  const clubLogoUri = (teamName: string): string | null => clubLogoUriFor(clubLogoMap, teamName);
  const [gameDetail, setGameDetail] = useState<TodayGame | null>(null);
  // Glocken-Benachrichtigungen (Beraterstatus-Änderungen abonnierter Spieler)
  const [alerts, setAlerts] = useState<AgentAlertNotification[]>([]);
  // Unklare TM-Zuordnungen (mehrere Kandidaten) — Zuordnung von Hand
  const [ambiguous, setAmbiguous] = useState<AmbiguousMerge[]>([]);
  const [mergeHidden, setMergeHidden] = useState<Set<string>>(new Set());
  const [assigning, setAssigning] = useState(false);
  // Benachrichtigungs-Glocke im Titelbalken: Liste klappt unter der Glocke auf
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef<View>(null);
  const [bellPos, setBellPos] = useState({ top: 0, right: 0 });
  const openBell = () => {
    (bellRef.current as any)?.measureInWindow((x: number, y: number, w: number, h: number) => {
      setBellPos({ top: y + h + 6, right: Math.max(10, (typeof window !== 'undefined' ? window.innerWidth : 1400) - (x + w)) });
      setBellDetail(null);
      setBellOpen(true);
    });
  };
  const [bellDetail, setBellDetail] = useState<
    | { type: 'alert'; alert: AgentAlertNotification }
    | { type: 'merge'; item: AmbiguousMerge }
    | null
  >(null);
  // Im Merge-Dialog angehaktes TM-Profil
  const [mergeChoice, setMergeChoice] = useState<string | null>(null);
  // Alter/neuer Berater zum geöffneten Beraterstatus-Alarm (aus berater_changes)
  const [alertChange, setAlertChange] = useState<{ from: string | null; fromKnown: boolean; to: string | null } | null>(null);
  const openAlertDetail = async (a: AgentAlertNotification) => {
    setAlertChange(null);
    setBellDetail({ type: 'alert', alert: a });
    if (!a.player_id) return;
    const { data } = await supabase
      .from('berater_changes')
      .select('previous_agent_name, previous_agent_company, new_agent_name, new_agent_company')
      .eq('player_id', a.player_id)
      .order('detected_at', { ascending: false })
      .limit(1);
    const c = (data || [])[0] as any;
    if (c) {
      setAlertChange({
        from: agentDisplayName(c.previous_agent_name, c.previous_agent_company),
        fromKnown: true,
        to: agentDisplayName(c.new_agent_name, c.new_agent_company),
      });
      return;
    }
    // Kein Wechsel-Datensatz (sollte bei echten Alarmen nicht vorkommen):
    // wenigstens den aktuellen Berater zeigen
    const { data: pl } = await supabase
      .from('berater_players')
      .select('current_agent_name, current_agent_company')
      .eq('id', a.player_id)
      .maybeSingle();
    setAlertChange({
      from: null,
      fromKnown: false,
      to: agentDisplayName((pl as any)?.current_agent_name, (pl as any)?.current_agent_company),
    });
  };

  const dismissAlert = (a: AgentAlertNotification) => {
    markAlertSeen(a.id);
    setAlerts((prev) => prev.filter((x) => x.id !== a.id));
  };

  const openAlertProfile = async (a: AgentAlertNotification) => {
    dismissAlert(a);
    if (!a.player_id) return;
    const { data } = await supabase
      .from('berater_players')
      .select('tm_player_id, player_name')
      .eq('id', a.player_id)
      .maybeSingle();
    const sp = await fetchSearchPlayer(data?.tm_player_id || null, data?.player_name || a.player_name);
    if (sp) setDetailPlayer(sp);
  };
  // Offene Benachrichtigungen: Beraterstatus-Alarme + unklare Zuordnungen
  const openMerges = ambiguous.filter((a) => !mergeHidden.has(a.scouted.id));
  const bellCount = alerts.length + openMerges.length;

  // Manuelle Zuordnung aus dem Benachrichtigungs-Detail
  const handleAssign = async (scoutedId: string, keeperId: string) => {
    if (assigning) return;
    setAssigning(true);
    const ok = await mergeScoutedInto(scoutedId, keeperId);
    setAssigning(false);
    if (ok) {
      setBellDetail(null);
      findAmbiguousMergeCandidates().then(setAmbiguous).catch(() => {});
    }
  };

  const [addingGame, setAddingGame] = useState(false);
  // Spielerprofil-Modal (identisch zur Suchmaschine)
  const [detailPlayer, setDetailPlayer] = useState<StipendiumSearchPlayer | null>(null);
  const returnToPlayerRef = useRef<StipendiumSearchPlayer | null>(null);
  const [initials, setInitials] = useState('');

  useFocusEffect(
    useCallback(() => {
      loadData();
      // Nach Schließen einer Spielbewertung zurück ins Spielerprofil
      if (returnToPlayerRef.current) {
        const player = returnToPlayerRef.current;
        returnToPlayerRef.current = null;
        setTimeout(() => setDetailPlayer(player), 100);
      }
    }, [])
  );

  const loadData = async () => {
    // Kennzahlen + Listen parallel laden; Einzelfehler still schlucken
    const today = new Date().toISOString().slice(0, 10);

    supabase
      .from('scouting_matches')
      .select('*', { count: 'exact', head: true })
      .eq('is_archived', false)
      .then(({ count }) => setUpcomingMatches(count || 0));

    loadWatchlist().then(setWatchlist).catch(() => {});
    loadAllEvaluations().then(setEvaluations).catch(() => {});

    // Vereinswappen: alle bekannten Vereine einmal laden (Lookup über Namensbasis)
    loadClubLogoMap().then(setClubLogoMap).catch(() => {});
    loadUnseenAlerts().then(setAlerts).catch(() => {});
    findAmbiguousMergeCandidates().then(setAmbiguous).catch(() => {});

    supabase
      .from('stipendium_entries')
      .select('*', { count: 'exact', head: true })
      .then(({ count }) => setStipendiumCount(count || 0));

    loadScanStatus()
      .then((result) => setBeraterStats(result.stats))
      .catch(() => {});

    supabase.auth.getUser().then(({ data }) => {
      const email = data?.user?.email || '';
      setInitials(email.slice(0, 2).toUpperCase());
    });

    // Heutige Spiele: eigene (scouting_matches) + Umgebungs-Spiele (area_games)
    try {
      const [ownRes, areaRes, leaguesRes] = await Promise.all([
        supabase
          .from('scouting_matches')
          .select('id, home_team, away_team, match_date, match_date_end, match_time, age_group, match_type, location, fussball_de_url, source')
          .eq('is_archived', false)
          // heute beginnend ODER mehrtägig und heute laufend (DFB-Lehrgänge)
          .or(`match_date.eq.${today},and(match_date.lte.${today},match_date_end.gte.${today})`)
          .limit(30),
        supabase
          .from('area_games')
          .select('match_key, league_key, kickoff_time, home_name, away_name, wettbewerb, venue, venue_address, game_url')
          .eq('kickoff_date', today)
          .order('kickoff_time')
          .limit(60),
        supabase.from('area_leagues').select('league_key, name'),
      ]);
      const leagueNames = new Map<string, string>(
        ((leaguesRes.data as any[]) || []).map((l) => [l.league_key, l.name])
      );
      const own: TodayGame[] = ((ownRes.data as any[]) || []).map((m) => ({
        key: `own-${m.id}`,
        matchId: String(m.id),
        zeit: m.match_time ? String(m.match_time).slice(0, 5) : null,
        begegnung: m.away_team ? `${m.home_team} - ${m.away_team}` : m.home_team,
        home: stripAge(m.home_team),
        away: m.away_team ? stripAge(m.away_team) : '',
        liga: m.age_group || '—',
        art: m.match_type || 'Punktspiel',
        ort: m.location || null,
        fussballDeUrl: m.fussball_de_url || null,
        isOwn: true,
        isDfb: m.source === 'dfb',
        matchDate: m.match_date || null,
        matchDateEnd: m.match_date_end || null,
      }));
      const ownNames = new Set(own.map((g) => g.begegnung));
      const area: TodayGame[] = ((areaRes.data as any[]) || [])
        .map((g) => ({
          key: `area-${g.match_key}`,
          matchId: `area:${g.match_key}`,
          zeit: g.kickoff_time ? String(g.kickoff_time).slice(0, 5) : null,
          begegnung: `${g.home_name} - ${g.away_name}`,
          home: stripAge(g.home_name),
          away: stripAge(g.away_name),
          liga: areaAge(g, leagueNames.get(g.league_key) || ''),
          art: areaArt(g),
          ort: g.venue_address ? `${g.venue ? `${g.venue}, ` : ''}${g.venue_address}` : g.venue || null,
          fussballDeUrl: g.game_url || null,
          isOwn: false,
        }))
        .filter((g) => !ownNames.has(g.begegnung));
      const all = [...own, ...area].sort((a, b) => (a.zeit || '99').localeCompare(b.zeit || '99'));
      setTodayGames(all);
    } catch { /* Karte bleibt leer */ }
  };

  // Watchlist-Spieler mit dem höchsten Potential (Bewertung aus dem
  // Watchlist-System: Status-Eintrag vor Watchlist-Feld)
  const watchlistRating = (w: WatchlistEntry): number | null =>
    evaluations.get(w.player_id)?.rating ?? w.rating ?? null;
  // Zielspieler-Panel: alle Spieler mit Zielspieler-Status, höchstes Potential zuerst
  const topWatchlist = [...watchlist]
    .map((w) => ({
      entry: w,
      rating: watchlistRating(w),
      topZiel: evaluations.get(w.player_id)?.status === 'top_ziel',
    }))
    .filter((x) => x.topZiel)
    .sort((a, b) => (b.rating || 0) - (a.rating || 0))
    .slice(0, 6);

  // Farbe wie im Potential-Schiebebalken
  const potentialColor = (v: number): string => {
    if (v === 10) return '#F0C040';
    if (v >= 7) return '#22c55e';
    if (v >= 4) return '#e8930c';
    return '#dc2626';
  };

  // Spiel aus dem Popup zu "Meine Spiele" übernehmen (Aufstellung lädt der
  // Spiele-Screen beim Öffnen automatisch nach)
  const handleAddToMyGames = async () => {
    if (!gameDetail || gameDetail.isOwn || addingGame) return;
    setAddingGame(true);
    const today = new Date().toISOString().slice(0, 10);
    const [home, ...rest] = gameDetail.begegnung.split(' - ');
    // Duplikat-Schutz: gleiches Spiel (Teams + Datum) existiert schon als eigenes?
    const { data: dupe } = await supabase
      .from('scouting_matches')
      .select('id')
      .eq('home_team', home?.trim() || gameDetail.begegnung)
      .eq('away_team', rest.join(' - ').trim())
      .eq('match_date', today)
      .limit(1);
    if (dupe && dupe.length > 0) {
      setAddingGame(false);
      setGameDetail({ ...gameDetail, isOwn: true });
      loadData();
      return;
    }
    const result = await createMatch({
      home_team: home?.trim() || gameDetail.begegnung,
      away_team: rest.join(' - ').trim(),
      match_date: today,
      match_time: gameDetail.zeit || null,
      age_group: gameDetail.liga || null,
      match_type: gameDetail.art || 'Punktspiel',
      location: gameDetail.ort || null,
      fussball_de_url: gameDetail.fussballDeUrl || null,
    } as any);
    setAddingGame(false);
    if (result.success) {
      setGameDetail({ ...gameDetail, isOwn: true });
      loadData();
    }
  };

  // Nachfrage vor dem Entfernen aus "Meine Spiele"
  const [confirmRemoveGame, setConfirmRemoveGame] = useState(false);
  const [removingGame, setRemovingGame] = useState(false);
  const handleRemoveFromMyGames = async () => {
    if (!gameDetail || removingGame) return;
    setRemovingGame(true);
    let matchId: string | null = null;
    if (gameDetail.key.startsWith('own-')) {
      matchId = gameDetail.matchId;
    } else {
      // Über das Popup übernommen: eigenes Spiel über Teams + Datum finden
      const today = new Date().toISOString().slice(0, 10);
      const [home, ...rest] = gameDetail.begegnung.split(' - ');
      const { data } = await supabase
        .from('scouting_matches')
        .select('id')
        .eq('home_team', home?.trim() || gameDetail.begegnung)
        .eq('away_team', rest.join(' - ').trim())
        .eq('match_date', today)
        .limit(1);
      matchId = (data || [])[0]?.id || null;
    }
    if (matchId) {
      await deleteMatch(matchId);
      setGameDetail({ ...gameDetail, isOwn: false });
      loadData();
    }
    setRemovingGame(false);
    setConfirmRemoveGame(false);
  };

  const openPlayerProfile = async (w: WatchlistEntry) => {
    const p = w.player;
    if (!p) return;
    const sp = await fetchSearchPlayer(p.tm_player_id || null, p.player_name);
    setDetailPlayer(
      sp || {
        id: p.id,
        player_name: p.player_name,
        birth_date: p.birth_date,
        age: ageFromBirthDate(p.birth_date),
        position: positionCode(p.position),
        current_agent_name: p.current_agent_name,
        current_agent_company: (p as any).current_agent_company ?? null,
        agent_url: p.agent_url ?? null,
        tm_player_id: p.tm_player_id || null,
        tm_profile_url: p.tm_profile_url || null,
        market_value: p.market_value ?? null,
        contract_until: (p as any).contract_until ?? null,
        is_vereinslos: !!p.is_vereinslos,
        club_name: p.club_name || null,
        club_tm_id: null,
        league_name: p.league_name || null,
      }
    );
  };

  const openMaps = (q: string) => {
    const url = `https://www.google.de/maps?q=${encodeURIComponent(q)}`;
    if (Platform.OS === 'web') window.open(url, '_blank');
    else Linking.openURL(url);
  };

  const openFussballDe = (url: string) => {
    if (Platform.OS === 'web') window.open(url, '_blank');
    else Linking.openURL(url);
  };

  const chip = (title: string, green?: boolean) => (
    <View style={[styles.chip, green && styles.chipGreen, HARD_SHADOW]}>
      <Text style={styles.chipText}>{title}</Text>
    </View>
  );

  const statCard = (
    title: string,
    value: string,
    label: string,
    linkLabel: string,
    onPress: () => void,
    extra?: string
  ) => (
    <TouchableOpacity key={title} style={[styles.statCard, HARD_SHADOW]} onPress={onPress} activeOpacity={0.7}>
      {chip(title)}
      <Text style={styles.statNumber}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      {extra ? <Text style={styles.statExtra}>{extra}</Text> : null}
      <View style={styles.statFooter}>
        <Text style={styles.statFooterText}>{linkLabel} →</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Gelber Titelbalken */}
      <View style={[styles.headerBar, HARD_SHADOW_LG]}>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>Scouting Dashboard</Text>
          <Text style={styles.headerSubtitle}>Spieler & Spiele im Blick</Text>
        </View>
        {/* Glocke wie im Spielerprofil: leer = keine Meldungen, rot = neue */}
        <TouchableOpacity
          ref={bellRef as any}
          style={[styles.headerBox, HARD_SHADOW, { position: 'relative' }, bellCount > 0 && { backgroundColor: '#dc2626' }]}
          onPress={openBell}
          activeOpacity={0.7}
        >
          <Ionicons
            name={bellCount > 0 ? 'notifications' : 'notifications-outline'}
            size={14}
            color={bellCount > 0 ? '#ffffff' : RETRO.text}
          />
          {bellCount > 0 && (
            <View style={styles.bellBadge}>
              <Text style={styles.bellBadgeText}>{bellCount}</Text>
            </View>
          )}
        </TouchableOpacity>
        <View style={[styles.headerBox, HARD_SHADOW]}>
          <Text style={styles.headerBoxText}>{todayHeader()}</Text>
        </View>
        <TouchableOpacity style={[styles.headerBox, HARD_SHADOW]} onPress={signOut} activeOpacity={0.7}>
          <Text style={styles.headerBoxText}>{initials || '⎋'}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {/* Kennzahlen-Karten */}
        <View style={styles.statRow}>
          {statCard('SPIELE', String(upcomingMatches), 'Eigene Spiele & Termine', 'ALLE SPIELE', () => navigation.navigate('MatchList'))}
          {statCard('WATCHLIST', String(watchlist.length), 'Spieler auf der Watchlist', 'WATCHLIST', () => navigation.navigate('Watchlist'))}
          {/* Suchmaschine übernimmt den Beraterstatus (Wechsel-Filter in der Suche) */}
          {statCard(
            'SUCHMASCHINE',
            beraterStats && beraterStats.recentChanges > 0 ? String(beraterStats.recentChanges) : '—',
            'Beraterwechsel in den letzten 7 Tagen',
            'SUCHE ÖFFNEN',
            () => navigation.navigate('Suchmaschine'),
            beraterStats ? `${beraterStats.playersWithoutAgent} Spieler ohne Berater` : undefined
          )}
          {statCard('SPORTSTIPENDIUM', String(stipendiumCount), 'Kandidaten im Prozess', 'ÖFFNEN', () => navigation.navigate('Sportstipendium'))}
        </View>

        {/* Untere Reihe: Heute + Zielspieler (mobil: Zielspieler ZUERST) */}
        <View style={[styles.bottomRow, isMobile && { flexDirection: 'column-reverse', flexWrap: 'nowrap' as const }]}>
          {/* Heutige Spiele */}
          <View style={[styles.panelCard, styles.panelHeute, HARD_SHADOW, isMobile && ({ flexBasis: 'auto' } as any)]}>
            {chip(`HEUTE${todayGames.length > 0 ? ` (${todayGames.length})` : ''}`, true)}
            {todayGames.length === 0 ? (
              <Text style={styles.emptyText}>Heute keine Spiele</Text>
            ) : (
              todayGames.map((g, idx) => (
                <TouchableOpacity
                  key={g.key}
                  style={{
                    flexDirection: 'row', alignItems: 'stretch',
                    backgroundColor: RETRO.white,
                    borderBottomWidth: idx === todayGames.length - 1 ? 0 : 1,
                    borderBottomColor: RETRO.rowBorder,
                  }}
                  onPress={() => setGameDetail(g)}
                  activeOpacity={0.7}
                >
                  {/* Anstoßzeit-Block links: heute = grün (wie in der Spiele-Übersicht) */}
                  <View style={{
                    width: 86, backgroundColor: '#22c55e',
                    alignItems: 'center', justifyContent: 'center',
                    paddingVertical: 8, paddingHorizontal: 4,
                    borderRightWidth: 1, borderRightColor: RETRO.rowBorder,
                  }}>
                    {g.isDfb && g.matchDateEnd && g.matchDateEnd !== g.matchDate ? (
                      // Laufender mehrtägiger DFB-Termin: Beginn / bis / Ende
                      <>
                        <Text style={{ fontSize: 10, fontWeight: '700', fontFamily: MONO, color: RETRO.text }} numberOfLines={1}>{fmtShort(g.matchDate)}</Text>
                        <Text style={{ fontSize: 10, fontFamily: MONO, color: RETRO.text, opacity: 0.75, marginTop: 1 }} numberOfLines={1}>bis</Text>
                        <Text style={{ fontSize: 10, fontWeight: '700', fontFamily: MONO, color: RETRO.text, marginTop: 1 }} numberOfLines={1}>{fmtShort(g.matchDateEnd)}</Text>
                      </>
                    ) : (
                      <>
                        <Text style={{ fontSize: 10, fontWeight: '700', fontFamily: MONO, color: RETRO.text, opacity: 0.75 }} numberOfLines={1}>
                          Heute
                        </Text>
                        <Text style={{ fontSize: 14, fontWeight: '800', color: RETRO.text, marginTop: 1 }} numberOfLines={1}>
                          {g.zeit || '–'}
                        </Text>
                      </>
                    )}
                  </View>
                  <View style={{ flex: 1, paddingVertical: 8, paddingHorizontal: 12, justifyContent: 'center' }}>
                    {/* Zeile 1: Altersklasse + Art (dezente Trennlinie), darunter Heim + Gast */}
                    <View style={{
                      flexDirection: 'row', alignItems: 'center', gap: 4,
                      
                    }}>
                      {g.isOwn && !g.isDfb && <View style={styles.attendMarker} />}
                      {g.liga ? (
                        <Text style={{ fontSize: 10, color: RETRO.textMuted }}>{g.liga}</Text>
                      ) : null}
                      {g.art ? (
                        <Text style={{ fontSize: 10, color: RETRO.textMuted }}>{g.art}</Text>
                      ) : null}
                    </View>
                    {/* Kurzer Trennstrich */}
                    <View style={{ width: 28, height: 1, backgroundColor: 'rgba(198, 194, 186, 0.9)', marginTop: 3 }} />
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
                      <TeamLogo name={g.away || !g.isDfb ? g.home : 'Deutschland'} map={clubLogoMap} />
                      <Text style={{ color: RETRO.text, fontSize: 13, fontWeight: '700', flexShrink: 1 }} numberOfLines={1}>
                        {g.home}
                      </Text>
                    </View>
                    {g.away ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                        <TeamLogo name={g.away} map={clubLogoMap} />
                        <Text style={{ color: RETRO.text, fontSize: 13, fontWeight: '700', flexShrink: 1 }} numberOfLines={1}>
                          {g.away}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </TouchableOpacity>
              ))
            )}
          </View>

          {/* Zuletzt zur Watchlist hinzugefügt */}
          <View style={[styles.panelCard, styles.panelWatchlist, HARD_SHADOW, isMobile && ({ flexBasis: 'auto' } as any)]}>
            {chip('ZIELSPIELER', true)}
            <View style={styles.tableHead}>
              <Text style={[styles.tableHeadText, { flex: 1 }]}>SPIELER</Text>
              <Text style={styles.tableHeadText}>POT.</Text>
            </View>
            {topWatchlist.length === 0 ? (
              <Text style={styles.emptyText}>Noch keine Zielspieler markiert</Text>
            ) : (
              topWatchlist.map(({ entry: w, rating, topZiel }, idx) => (
                <TouchableOpacity
                  key={w.id}
                  style={[styles.tableRow, idx === topWatchlist.length - 1 && { borderBottomWidth: 0 }]}
                  onPress={() => openPlayerProfile(w)}
                  activeOpacity={0.7}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.tableCell} numberOfLines={1}>
                      {nameLastFirst(w.player?.player_name || '?')}
                    </Text>
                    {w.player?.club_name ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1 }}>
                        <TeamLogo name={w.player.club_name} map={clubLogoMap} />
                        <Text style={[styles.tableCellSub, { marginTop: 0, flexShrink: 1 }]} numberOfLines={1}>
                          {w.player.club_name}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  {/* Top-Ziel automatisch ab Potential 8 */}
                  {(rating || 0) >= 8 && (
                    <View style={styles.topZielBadge}>
                      <Text style={styles.topZielBadgeText}>TOP-ZIEL</Text>
                    </View>
                  )}
                  {/* Ohne Potential-Eintrag keine Farbe (nicht eingetragen ≠ schlecht) */}
                  {rating != null && rating > 0 && (
                    <View style={[styles.potBadge, { backgroundColor: potentialColor(rating) }]}>
                      <Text style={styles.potBadgeText}>{rating}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              ))
            )}
          </View>
        </View>
      </ScrollView>

      {/* Benachrichtigungs-Glocke: Liste klappt direkt unter der Glocke auf */}
      {bellOpen && !bellDetail && (
        <Modal visible transparent animationType="none" onRequestClose={() => setBellOpen(false)}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setBellOpen(false)}>
            <View style={[styles.bellDropdown, HARD_SHADOW_LG, { top: bellPos.top, right: bellPos.right }]}>
              <View style={[styles.alertBar, HARD_SHADOW, { margin: 0, marginBottom: 0 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.alertTitle}>Benachrichtigungen</Text>
                </View>
                <TouchableOpacity onPress={() => setBellOpen(false)} hitSlop={8}>
                  <Ionicons name="close" size={18} color={RETRO.text} />
                </TouchableOpacity>
              </View>
              {bellCount === 0 ? (
                <Text style={styles.alertText}>Keine neuen Benachrichtigungen.</Text>
              ) : (
                <View style={{ paddingHorizontal: 14, paddingVertical: 6 }}>
                  {alerts.map((a) => (
                    <TouchableOpacity
                      key={a.id}
                      style={styles.bellRow}
                      onPress={() => openAlertDetail(a)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.bellRowTag}>BERATERSTATUS</Text>
                      <Text style={styles.bellRowText} numberOfLines={1}>{a.player_name}</Text>
                      <Ionicons name="chevron-forward" size={13} color={RETRO.shadowDark} />
                    </TouchableOpacity>
                  ))}
                  {openMerges.map((m) => (
                    <TouchableOpacity
                      key={m.scouted.id}
                      style={styles.bellRow}
                      onPress={() => { setMergeChoice(null); setBellDetail({ type: 'merge', item: m }); }}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.bellRowTag}>ZUORDNUNG</Text>
                      <Text style={styles.bellRowText} numberOfLines={1}>{m.scouted.player_name}</Text>
                      <Ionicons name="chevron-forward" size={13} color={RETRO.shadowDark} />
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          </TouchableOpacity>
        </Modal>
      )}

      {/* Benachrichtigungs-Detail: Beraterstatus-Alarm */}
      {bellOpen && bellDetail?.type === 'alert' && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setBellDetail(null)}>
          <View style={styles.alertOverlay}>
            <View style={[styles.alertBox, HARD_SHADOW_LG]}>
              <View style={[styles.alertBar, HARD_SHADOW]}>
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
                  <Text style={styles.alertTitle}>Benachrichtigung</Text>
                  <Text style={styles.alertTag}>BERATERSTATUS</Text>
                </View>
                <TouchableOpacity onPress={() => { setBellDetail(null); setBellOpen(false); }} hitSlop={8}>
                  <Ionicons name="close" size={18} color={RETRO.text} />
                </TouchableOpacity>
              </View>
              <Text style={styles.alertText}>{bellDetail.alert.message}</Text>
              {alertChange && (
                <View style={{ paddingHorizontal: 14, paddingBottom: 12, gap: 3 }}>
                  <Text style={styles.alertAgentLine}>
                    Alter Berater:{' '}
                    <Text style={[styles.alertAgentValue, alertChange.fromKnown && !alertChange.from && { color: '#15803d' }]}>
                      {alertChange.fromKnown ? (alertChange.from || 'kein Beratereintrag') : '—'}
                    </Text>
                  </Text>
                  <Text style={styles.alertAgentLine}>
                    Neuer Berater:{' '}
                    <Text style={[styles.alertAgentValue, !alertChange.to && { color: '#15803d' }]}>
                      {alertChange.to || 'kein Beratereintrag'}
                    </Text>
                  </Text>
                </View>
              )}
              <View style={[styles.alertActions, { gap: 10 }]}>
                <TouchableOpacity
                  style={[styles.alertBtn, HARD_SHADOW]}
                  onPress={() => { const a = bellDetail.alert; setBellDetail(null); setBellOpen(false); openAlertProfile(a); }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.alertBtnText}>Profil anzeigen</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.alertBtn, HARD_SHADOW]}
                  onPress={() => { dismissAlert(bellDetail.alert); setBellDetail(null); }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.alertBtnText}>Gelesen</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* Benachrichtigungs-Detail: unklare TM-Zuordnung */}
      {bellOpen && bellDetail?.type === 'merge' && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setBellDetail(null)}>
          <View style={styles.alertOverlay}>
            <View style={[styles.alertBox, HARD_SHADOW_LG]}>
              <View style={[styles.alertBar, HARD_SHADOW]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.alertTitle}>Merge</Text>
                </View>
                <TouchableOpacity onPress={() => { setBellDetail(null); setBellOpen(false); }} hitSlop={8}>
                  <Ionicons name="close" size={18} color={RETRO.text} />
                </TouchableOpacity>
              </View>
              <Text style={styles.alertText}>
                {`Für ${[
                  `${bellDetail.item.scouted.player_name}${(() => { const a = ageFromBirthDate(bellDetail.item.scouted.birth_date); return a !== null ? ` (${a} J.)` : ''; })()}`,
                  bellDetail.item.scouted.team,
                ].filter(Boolean).join(', ')} kommen mehrere TM-Profile in Frage:`}
              </Text>
              <View style={{ paddingHorizontal: 14, gap: 8 }}>
                {bellDetail.item.candidates.map((c) => {
                  const checked = mergeChoice === c.id;
                  return (
                    <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <TouchableOpacity
                        style={[styles.alertBtn, HARD_SHADOW, { flexShrink: 1 }]}
                        onPress={() => {
                          if (c.tm_profile_url && Platform.OS === 'web') window.open(c.tm_profile_url, '_blank');
                          else if (c.tm_profile_url) Linking.openURL(c.tm_profile_url);
                        }}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.alertBtnText} numberOfLines={1}>
                          {[
                            `${c.player_name}${(() => { const a = ageFromBirthDate(c.birth_date); return a !== null ? ` (${a} J.)` : ''; })()}`,
                            c.is_vereinslos ? 'vereinslos' : c.club_name,
                          ].filter(Boolean).join(' · ')}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.mergeCheckbox, checked && { backgroundColor: RETRO.headerBg, borderColor: RETRO.headerBg }]}
                        onPress={() => setMergeChoice(checked ? null : c.id)}
                        hitSlop={6}
                        activeOpacity={0.7}
                      >
                        {checked && <Text style={styles.mergeCheckmark}>✓</Text>}
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
              <View style={[styles.alertActions, { gap: 10, marginTop: 12 }]}>
                <TouchableOpacity
                  style={[styles.alertBtn, HARD_SHADOW]}
                  onPress={() => {
                    setMergeHidden((prev) => new Set(prev).add(bellDetail.item.scouted.id));
                    setBellDetail(null);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.alertBtnText, { color: '#4a4a55' }]}>Keiner davon</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.alertBtn, HARD_SHADOW, { backgroundColor: '#1a5f2a' }, (!mergeChoice || assigning) && { opacity: 0.5 }]}
                  disabled={!mergeChoice || assigning}
                  onPress={() => mergeChoice && handleAssign(bellDetail.item.scouted.id, mergeChoice)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.alertBtnText, { color: '#ffffff' }]}>Zuordnen</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* Nachfrage: Spiel aus "Meine Spiele" entfernen? */}
      {confirmRemoveGame && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setConfirmRemoveGame(false)}>
          <View style={styles.alertOverlay}>
            <View style={[styles.alertBox, HARD_SHADOW_LG]}>
              <View style={[styles.alertBar, HARD_SHADOW]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.alertTitle}>Spiel entfernen</Text>
                </View>
                <TouchableOpacity onPress={() => setConfirmRemoveGame(false)} hitSlop={8}>
                  <Ionicons name="close" size={18} color={RETRO.text} />
                </TouchableOpacity>
              </View>
              <Text style={styles.alertText}>Soll das Spiel wirklich aus „Meine Spiele" entfernt werden?</Text>
              <View style={[styles.alertActions, { gap: 10 }]}>
                <TouchableOpacity
                  style={[styles.alertBtn, HARD_SHADOW]}
                  onPress={() => setConfirmRemoveGame(false)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.alertBtnText}>Abbrechen</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.alertBtn, HARD_SHADOW, { backgroundColor: '#dc2626' }, removingGame && { opacity: 0.5 }]}
                  onPress={handleRemoveFromMyGames}
                  disabled={removingGame}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.alertBtnText, { color: '#ffffff' }]}>Entfernen</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* Spielerprofil (identisch zur Suchmaschine) */}
      {detailPlayer && (
        <PlayerDetailModal
          player={detailPlayer}
          onClose={() => setDetailPlayer(null)}
          onStatusChanged={() => loadData()}
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

      {/* Spiel-Detail-Popup (wie in der Spiele-Übersicht) */}
      {gameDetail && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setGameDetail(null)}>
          <Pressable style={styles.detailOverlay} onPress={() => setGameDetail(null)}>
            <Pressable style={[styles.detailModal, HARD_SHADOW_LG]}>
              <View style={[styles.detailNameBar, HARD_SHADOW]}>
                <Text style={styles.detailNameText} numberOfLines={2}>
                  {gameDetail.away ? `${gameDetail.home} - ${gameDetail.away}` : gameDetail.home}
                </Text>
                {gameDetail.fussballDeUrl ? (
                  <TouchableOpacity
                    onPress={() => openFussballDe(gameDetail.fussballDeUrl as string)}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  >
                    <Image
                      source={require('../../../assets/fussballde-logo.png')}
                      style={styles.detailFussballIcon}
                    />
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity onPress={() => setGameDetail(null)} hitSlop={8}>
                  <Ionicons name="close" size={20} color={RETRO.text} />
                </TouchableOpacity>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Datum</Text>
                <View style={styles.detailDateWrap}>
                  <Text style={styles.detailHeute}>Heute</Text>
                  <Text style={styles.detailValueFix}>{todayHeader()}</Text>
                </View>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Uhrzeit</Text>
                <Text style={styles.detailValue}>{gameDetail.zeit ? `${gameDetail.zeit} Uhr` : '—'}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Altersklasse</Text>
                <Text style={styles.detailValue}>{gameDetail.liga}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Art</Text>
                <Text style={styles.detailValue}>{gameDetail.art}</Text>
              </View>
              {gameDetail.ort ? (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Ort</Text>
                  <TouchableOpacity style={{ flex: 1 }} onPress={() => openMaps(gameDetail.ort as string)}>
                    <Text style={styles.detailLink} numberOfLines={1}>📍 {shortVenueName(gameDetail.ort)}</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
              <View style={styles.detailDivider} />
              {gameDetail.isOwn ? (
                <TouchableOpacity
                  style={[styles.detailAddedBadge, HARD_SHADOW]}
                  onPress={() => setConfirmRemoveGame(true)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.detailAddedText}>✓ Ich bin beim Spiel</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.detailAddBtn, HARD_SHADOW, BLUE_GRADIENT]}
                  onPress={handleAddToMyGames}
                  disabled={addingGame}
                >
                  {addingGame ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.detailAddBtnText}>Zu „Meine Spiele" hinzufügen</Text>
                  )}
                </TouchableOpacity>
              )}
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: RETRO.page,
  },
  // Gelber Titelbalken
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: RETRO.yellow,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  // Titel + MONO-Untertitel auf gemeinsamer Grundlinie
  headerTitleWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 12,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: RETRO.text,
  },
  headerSubtitle: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1,
    fontFamily: MONO,
    color: RETRO.textMuted,
    marginLeft: 4,
  },
  headerBox: {
    // Standard-Maß der Titelbalken-Boxen (wie RetroHeader.box)
    backgroundColor: RETRO.white,
    borderRadius: 2,
    paddingHorizontal: 10,
    paddingVertical: 5,
    minHeight: 25,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBoxText: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: MONO,
    color: RETRO.text,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
    paddingTop: 24,
    gap: 24,
  },
  // Kennzahlen-Karten
  statRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  statCard: {
    flex: 1,
    minWidth: 190,
    backgroundColor: RETRO.white,
    borderRadius: 2,
    paddingTop: 20,
  },
  // Grün wie der ERGEBNISSE-Chip in der Suchmaschine
  chipGreen: {
    backgroundColor: '#1a5f2a',
  },
  chip: {
    position: 'absolute',
    top: -10,
    left: 10,
    backgroundColor: RETRO.headerBg, // Retro-Blau wie die Chips im Spielerprofil
    borderRadius: 2,
    paddingHorizontal: 8,
    paddingVertical: 2,
    zIndex: 1,
  },
  chipText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    fontFamily: MONO,
    color: '#ffffff',
  },
  statNumber: {
    fontSize: 40,
    fontWeight: '800',
    color: RETRO.text,
    paddingHorizontal: 14,
    lineHeight: 46,
  },
  statLabel: {
    fontSize: 13,
    color: RETRO.textMuted,
    paddingHorizontal: 14,
    marginTop: 2,
    marginBottom: 14,
  },
  statExtra: {
    fontSize: 11,
    fontFamily: MONO,
    color: RETRO.textMuted,
    paddingHorizontal: 14,
    marginTop: -8,
    marginBottom: 14,
  },
  statFooter: {
    marginTop: 'auto',
    backgroundColor: RETRO.face,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
  },
  statFooterText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    fontFamily: MONO,
    color: '#1a5f2a',
  },
  // Untere Karten
  bottomRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    alignItems: 'stretch',
  },
  panelCard: {
    minWidth: 300,
    backgroundColor: RETRO.white,
    borderRadius: 2,
    paddingTop: 16,
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  // Spaltenraster der Kennzahlen-Reihe (5 Karten, 16er-Lücken) exakt treffen:
  // Heute = 3 Kartenbreiten + 2 Lücken, Watchlist = 2 Kartenbreiten + 1 Lücke
  panelHeute: {
    flexGrow: 3,
    flexShrink: 1,
    flexBasis: 32,
    minWidth: 420,
  },
  panelWatchlist: {
    flexGrow: 2,
    flexShrink: 1,
    flexBasis: 16,
  },
  tableHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: RETRO.face,
    paddingVertical: 6,
    paddingHorizontal: 8,
    marginBottom: 2,
  },
  tableHeadText: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1.5,
    fontFamily: MONO,
    color: RETRO.textMuted,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e2ded6',
  },
  tableCell: {
    fontSize: 13,
    fontWeight: '600',
    color: RETRO.text,
  },
  tableCellSub: {
    fontSize: 11,
    color: RETRO.textMuted,
    marginTop: 1,
  },
  tableCellMono: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: MONO,
    color: RETRO.textMuted,
  },
  colDatum: {
    width: 70,
  },
  // Oranger Marker: bei diesem Spiel bin ich (in "Meine Spiele" übernommen)
  attendMarker: {
    width: 8,
    height: 8,
    borderRadius: 1,
    backgroundColor: '#e8930c',
  },
  clubLogoSm: {
    width: 16,
    height: 16,
  },
  colBegegnung: {
    flex: 1,
    minWidth: 0,
  },
  colLiga: {
    width: 92,
  },
  colChevron: {
    width: 16,
    alignItems: 'flex-end',
  },
  potBadge: {
    minWidth: 26,
    height: 22,
    paddingHorizontal: 5,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Glocken-Benachrichtigung (kleines Retro-Popup)
  // Roter Zähler an der Glocke im Titelbalken
  bellBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: '#14141e',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#ffffff',
  },
  bellRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#d8d4cc',
  },
  bellRowTag: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    fontFamily: MONO,
    color: '#4a4a55',
    minWidth: 110,
  },
  bellRowText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: RETRO.text,
  },
  alertAgentLine: {
    fontSize: 13,
    color: '#4a4a55',
  },
  alertAgentValue: {
    fontWeight: '700',
    color: RETRO.text,
  },
  // Benachrichtigungs-Dropdown direkt unter der Glocke
  bellDropdown: {
    position: 'absolute',
    width: 400,
    maxWidth: '92%',
    backgroundColor: '#e9e5dd',
    borderRadius: 2,
    paddingBottom: 6,
  },
  // Häkchen-Kasten im Merge-Dialog (wie die Dropdown-Checkboxen)
  mergeCheckbox: {
    width: 18,
    height: 18,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: RETRO.shadowDark,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  mergeCheckmark: {
    fontSize: 12,
    fontWeight: '700',
    color: '#ffffff',
  },
  alertOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  alertBox: {
    backgroundColor: RETRO.page,
    borderRadius: 2,
    width: 420,
    maxWidth: '92%',
    paddingBottom: 14,
  },
  alertBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: RETRO.yellow,
    paddingVertical: 9,
    paddingHorizontal: 14,
    margin: 10,
    marginBottom: 4,
  },
  alertTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: RETRO.text,
  },
  alertTag: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1.5,
    fontFamily: MONO,
    color: '#4a4a55',
  },
  alertText: {
    fontSize: 14,
    color: RETRO.text,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  alertActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 14,
  },
  alertBtn: {
    backgroundColor: '#ffffff',
    borderRadius: 0,
    paddingHorizontal: 10,
    paddingVertical: 5,
    minHeight: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: RETRO.text,
  },
  // "Sofort machen"-Markierung (goldenes Badge vor dem Namen)
  topZielBadge: {
    backgroundColor: '#F0C040',
    borderRadius: 2,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  topZielBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: '#14141e',
  },
  potBadgeText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#ffffff',
  },
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
    borderRadius: 2,
    padding: 16,
    backgroundColor: 'rgba(238, 234, 226, 0.97)',
  },
  detailNameBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: RETRO.yellow,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginBottom: 10,
  },
  detailNameText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: RETRO.text,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 6,
    paddingHorizontal: 4,
  },
  detailLabel: {
    width: 100,
    fontSize: 13,
    color: RETRO.text,
  },
  detailValue: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'right',
    color: RETRO.text,
  },
  detailLink: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'right',
    color: '#2563eb',
  },
  detailFussballIcon: {
    width: 20,
    height: 20,
    borderWidth: 1,
    borderColor: RETRO.shadowDark,
  },
  detailDateWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'flex-end',
    gap: 8,
  },
  detailValueFix: {
    fontSize: 14,
    fontWeight: '600',
    color: RETRO.text,
  },
  detailHeute: {
    fontSize: 13,
    fontWeight: '800',
    color: '#15803d',
  },
  detailDivider: {
    height: 1,
    backgroundColor: RETRO.rowBorder,
    marginVertical: 12,
  },
  detailHint: {
    fontSize: 13,
    color: RETRO.textMuted,
    marginBottom: 8,
  },
  // Standard-Buttongröße (kompakt wie alle Buttons)
  detailAddBtn: {
    alignSelf: 'flex-end',
    backgroundColor: RETRO.headerBg,
    paddingVertical: 5,
    paddingHorizontal: 10,
    minHeight: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailAddBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#ffffff',
  },
  // Orange nach dem Übernehmen ("Ich bin beim Spiel"), Standard-Buttongröße
  detailAddedBadge: {
    alignSelf: 'flex-end',
    backgroundColor: '#e8930c',
    paddingVertical: 5,
    paddingHorizontal: 10,
    minHeight: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailAddedText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#ffffff',
  },
  emptyText: {
    fontSize: 13,
    color: '#8a867e',
    paddingVertical: 14,
    paddingHorizontal: 8,
  },
});
