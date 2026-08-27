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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { RootStackParamList } from '../../navigation/types';
import { RETRO, HARD_SHADOW, HARD_SHADOW_LG, MONO } from '../../theme/retro';
import { loadScanStatus, BeraterStats, loadWatchlist, WatchlistEntry, loadAllEvaluations, PlayerEvaluation } from '../../services/beraterService';
import { areaAge, areaArt, shortVenueName } from '../../services/areaGamesService';
import { createMatch } from '../../services/matchService';
import { PlayerDetailModal } from '../../components/PlayerDetailModal';
import { fetchSearchPlayer, StipendiumSearchPlayer, positionCode, ageFromBirthDate } from '../../services/stipendiumService';
import { BLUE_GRADIENT } from '../../theme/retro';
import { supabase } from '../../config/supabase';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

interface TodayGame {
  key: string;
  matchId: string; // Match-ID im Spiele-Screen ("area:<match_key>" bzw. eigene ID)
  zeit: string | null;
  begegnung: string;
  liga: string;
  art: string;
  ort: string | null;
  fussballDeUrl: string | null;
  isOwn: boolean;
}

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

/** "Mi, 27.08." */
function todayShort(): string {
  const d = new Date();
  return `${WEEKDAYS[d.getDay()]}, ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`;
}

/** "Do, 27.08.26" für die Kopfzeile */
function todayHeader(): string {
  const d = new Date();
  return `${WEEKDAYS[d.getDay()]}, ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getFullYear()).slice(-2)}`;
}

/** "Vorname Nachname" -> "Nachname, Vorname" */
function nameLastFirst(fullName: string): string {
  const parts = (fullName || '').trim().split(/\s+/);
  if (parts.length <= 1) return fullName;
  return `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(' ')}`;
}

export function DashboardScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { signOut } = useAuth();

  const [upcomingMatches, setUpcomingMatches] = useState(0);
  const [stipendiumCount, setStipendiumCount] = useState(0);
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);
  const [evaluations, setEvaluations] = useState<Map<string, PlayerEvaluation>>(new Map());
  const [beraterStats, setBeraterStats] = useState<BeraterStats | null>(null);
  const [todayGames, setTodayGames] = useState<TodayGame[]>([]);
  const [gameDetail, setGameDetail] = useState<TodayGame | null>(null);
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
          .select('id, spiel, zeit, mannschaft, art, location, fussball_de_url')
          .eq('is_archived', false)
          .eq('datum', today)
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
        zeit: m.zeit || null,
        begegnung: m.spiel,
        liga: m.mannschaft || '—',
        art: m.art || 'Punktspiel',
        ort: m.location || null,
        fussballDeUrl: m.fussball_de_url || null,
        isOwn: true,
      }));
      const ownNames = new Set(own.map((g) => g.begegnung));
      const area: TodayGame[] = ((areaRes.data as any[]) || [])
        .map((g) => ({
          key: `area-${g.match_key}`,
          matchId: `area:${g.match_key}`,
          zeit: g.kickoff_time ? String(g.kickoff_time).slice(0, 5) : null,
          begegnung: `${g.home_name} - ${g.away_name}`,
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
  const topWatchlist = [...watchlist]
    .map((w) => ({ entry: w, rating: watchlistRating(w) }))
    .filter((x) => x.rating !== null)
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

  const chip = (title: string) => (
    <View style={[styles.chip, HARD_SHADOW]}>
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
        <Text style={styles.headerTitle}>Scouting Dashboard</Text>
        <Text style={styles.headerSubtitle}>Spieler & Spiele im Blick</Text>
        <View style={{ flex: 1 }} />
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
          {statCard(
            'BERATERSTATUS',
            beraterStats ? String(beraterStats.playersWithoutAgent) : '…',
            'Spieler ohne Berater',
            'ALLE ANZEIGEN',
            () => navigation.navigate('Beraterstatus'),
            beraterStats && beraterStats.recentChanges > 0
              ? `${beraterStats.recentChanges} Wechsel in den letzten 7 Tagen`
              : undefined
          )}
          {statCard('WATCHLIST', String(watchlist.length), 'Spieler auf der Watchlist', 'WATCHLIST', () => navigation.navigate('Watchlist'))}
          {statCard('SUCHMASCHINE', '—', 'Spieler nach Alter, Liga, Vertrag und Status durchsuchen', 'SUCHE ÖFFNEN', () => navigation.navigate('Suchmaschine'))}
          {statCard('SPORTSTIPENDIUM', String(stipendiumCount), 'Kandidaten im Prozess', 'ÖFFNEN', () => navigation.navigate('Sportstipendium'))}
        </View>

        {/* Untere Reihe: Heute + zuletzt hinzugefügte Watchlist-Spieler */}
        <View style={styles.bottomRow}>
          {/* Heutige Spiele */}
          <View style={[styles.panelCard, styles.panelHeute, HARD_SHADOW]}>
            {chip(`HEUTE${todayGames.length > 0 ? ` (${todayGames.length})` : ''}`)}
            <View style={styles.tableHead}>
              <Text style={[styles.tableHeadText, styles.colDatum]}>DATUM</Text>
              <Text style={[styles.tableHeadText, styles.colBegegnung]}>BEGEGNUNG</Text>
              <Text style={[styles.tableHeadText, styles.colLiga]}>ALTERSKLASSE</Text>
              <View style={styles.colChevron} />
            </View>
            {todayGames.length === 0 ? (
              <Text style={styles.emptyText}>Heute keine Spiele</Text>
            ) : (
              todayGames.map((g, idx) => (
                <TouchableOpacity
                  key={g.key}
                  style={[styles.tableRow, idx === todayGames.length - 1 && { borderBottomWidth: 0 }]}
                  onPress={() => setGameDetail(g)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.tableCellMono, styles.colDatum]} numberOfLines={1}>
                    {todayShort()}{g.zeit ? ` ${g.zeit}` : ''}
                  </Text>
                  <Text style={[styles.tableCell, styles.colBegegnung]} numberOfLines={1}>
                    {g.begegnung}
                  </Text>
                  <Text style={[styles.tableCellMono, styles.colLiga]} numberOfLines={1}>
                    {g.liga}
                  </Text>
                  <View style={styles.colChevron}>
                    <Ionicons name="chevron-forward" size={13} color={RETRO.shadowDark} />
                  </View>
                </TouchableOpacity>
              ))
            )}
          </View>

          {/* Zuletzt zur Watchlist hinzugefügt */}
          <View style={[styles.panelCard, styles.panelWatchlist, HARD_SHADOW]}>
            {chip('WATCHLIST')}
            <View style={styles.tableHead}>
              <Text style={[styles.tableHeadText, { flex: 1 }]}>HÖCHSTES POTENTIAL</Text>
              <Text style={styles.tableHeadText}>POT.</Text>
            </View>
            {topWatchlist.length === 0 ? (
              <Text style={styles.emptyText}>Noch keine bewerteten Spieler auf der Watchlist</Text>
            ) : (
              topWatchlist.map(({ entry: w, rating }, idx) => (
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
                      <Text style={styles.tableCellSub} numberOfLines={1}>
                        {w.player.club_name}
                      </Text>
                    ) : null}
                  </View>
                  <View style={[styles.potBadge, { backgroundColor: potentialColor(rating || 0) }]}>
                    <Text style={styles.potBadgeText}>{rating}</Text>
                  </View>
                </TouchableOpacity>
              ))
            )}
          </View>
        </View>
      </ScrollView>

      {/* Spielerprofil (identisch zur Suchmaschine) */}
      {detailPlayer && (
        <PlayerDetailModal
          player={detailPlayer}
          onClose={() => setDetailPlayer(null)}
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

      {/* Spiel-Detail-Popup (wie in der Spiele-Übersicht) */}
      {gameDetail && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setGameDetail(null)}>
          <Pressable style={styles.detailOverlay} onPress={() => setGameDetail(null)}>
            <Pressable style={[styles.detailModal, HARD_SHADOW_LG]}>
              <View style={[styles.detailNameBar, HARD_SHADOW]}>
                <Text style={styles.detailNameText} numberOfLines={2}>{gameDetail.begegnung}</Text>
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
                <View style={[styles.detailAddedBadge, HARD_SHADOW]}>
                  <Text style={styles.detailAddedText}>✓ In „Meine Spiele" übernommen</Text>
                </View>
              ) : (
                <>
                  <Text style={styles.detailHint}>
                    Dieses Spiel beobachten? Es wird als eigenes Spiel übernommen (mit Aufstellung & Scouting).
                  </Text>
                  <TouchableOpacity
                    style={[styles.detailAddBtn, HARD_SHADOW, BLUE_GRADIENT]}
                    onPress={handleAddToMyGames}
                    disabled={addingGame}
                  >
                    {addingGame ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.detailAddBtnText}>+ Zu „Meine Spiele" hinzufügen</Text>
                    )}
                  </TouchableOpacity>
                </>
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
    backgroundColor: RETRO.white,
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
    fontSize: 12,
    fontWeight: '600',
    fontFamily: MONO,
    color: RETRO.textMuted,
  },
  colDatum: {
    width: 138,
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
    fontSize: 12,
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
  detailAddBtn: {
    alignSelf: 'flex-end',
    backgroundColor: RETRO.headerBg,
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  detailAddBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ffffff',
  },
  detailAddedBadge: {
    alignSelf: 'flex-start',
    backgroundColor: RETRO.yellow,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  detailAddedText: {
    fontSize: 13,
    fontWeight: '700',
    color: RETRO.text,
  },
  emptyText: {
    fontSize: 13,
    color: '#8a867e',
    paddingVertical: 14,
    paddingHorizontal: 8,
  },
});
