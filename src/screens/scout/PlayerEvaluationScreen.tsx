import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Alert,
  useWindowDimensions,
  BackHandler,
  Image,
  Linking,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../config/supabase';
import { ThemeOverride } from '../../contexts/ThemeContext';
import { RETRO, HARD_SHADOW, HARD_SHADOW_LG, RETRO_BTN, RETRO_THEME, MONO, RETRO_CHIP, RETRO_CHIP_TEXT } from '../../theme/retro';
import {
  AgeGroup,
  Position,
  BodyStructureData,
  SpeedAthleticismData,
} from '../../types';
import { agentDisplayName } from '../../services/stipendiumService';
import { createEmptyBodyStructureData } from '../../utils/bodyStructureCalculation';
import { createEmptySpeedAthleticismData } from '../../components/SpeedAthleticismSelector';
import { EvalHeader } from '../../components/evaluation/EvalHeader';
import { KoerperCard } from '../../components/evaluation/KoerperCard';
import { AthletikCard } from '../../components/evaluation/AthletikCard';
import {
  savePlayerEvaluation as saveBeraterEval,
  setScoutStatus,
  deriveScoutStatus,
  deletePlayerEvaluation as deleteBeraterEval,
  loadPlayerEvaluation as loadBeraterEval,
  addToWatchlist,
  removeFromWatchlist,
  isOnWatchlist,
  isPlaceholderName,
  normalizePlayerName,
  namesCompatible,
} from '../../services/beraterService';

// Deutsches Datum mit Wochentag, z.B. "Mi, 26.08.26" (aus ISO oder DD.MM.YYYY)
const formatMatchDateGerman = (raw: string): string => {
  if (!raw) return '';
  let d: Date | null = null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    d = new Date(`${raw.slice(0, 10)}T12:00:00`);
  } else if (/^\d{1,2}\.\d{1,2}\.\d{2,4}$/.test(raw)) {
    const [dd, mm, yy] = raw.split('.').map(Number);
    d = new Date(yy < 100 ? 2000 + yy : yy, mm - 1, dd, 12);
  }
  if (!d || isNaN(d.getTime())) return raw;
  const wd = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()];
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${wd}, ${dd}.${mm}.${yy}`;
};

export function PlayerEvaluationScreen({ navigation, route }: any) {
  // Retro-Look (Anstoss-Optik): feste Palette statt Dark/Light-Theme
  const colors = RETRO_THEME;
  const { width } = useWindowDimensions();
  const isMobile = width < 768;

  // Params vom vorherigen Screen
  const params = route?.params || {};

  // Spielername parsen (Format: "Nachname, Vorname")
  const parsePlayerName = (name: string): { lastName: string; firstName: string } => {
    if (!name) return { lastName: '', firstName: '' };
    const parts = name.split(', ');
    return {
      lastName: parts[0] || '',
      firstName: parts[1] || '',
    };
  };

  const parsedName = parsePlayerName(params.playerName);

  // Event-Daten (aus Navigation)
  const [matchName] = useState(params.matchName || '');
  const [matchDate] = useState(params.matchDate || '');
  const [ageGroup] = useState<AgeGroup>((params.mannschaft as AgeGroup) || 'U15');

  // Spielerdaten
  const [lastName] = useState(parsedName.lastName);
  const [firstName] = useState(parsedName.firstName);
  const [jerseyNumber] = useState(params.playerNumber?.toString() || '');
  const [currentClub] = useState(params.playerClub || '');
  const [positions, setPositions] = useState<Position[]>(
    params.playerPosition ? [params.playerPosition as Position] : []
  );
  const transfermarktUrl = params.transfermarktUrl || '';
  const agentName = params.agentName || '';
  const birthDateFromTM = params.playerBirthDate || '';

  // Körperbau
  const [bodyStructure, setBodyStructure] = useState<BodyStructureData>(
    createEmptyBodyStructureData()
  );

  // Schnelligkeit & Athletik
  const [speedAthleticism, setSpeedAthleticism] = useState<SpeedAthleticismData>(
    createEmptySpeedAthleticismData()
  );

  // Bewertung
  const [overallRating, setOverallRating] = useState(0);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [existingId, setExistingId] = useState<string | null>(null);

  // Felder die nicht mehr im UI sind, aber beim Laden erhalten bleiben
  const [preservedFields, setPreservedFields] = useState<Record<string, any>>({});

  // Track ob Änderungen gemacht wurden seit dem Laden
  const hasLoadedRef = useRef(false);
  const [hasChanges, setHasChanges] = useState(false);
  const hasChangesRef = useRef(false);

  // Art/Uhrzeit/fussball.de-Link nachladen, wenn nur die matchId übergeben wurde
  // (z. B. beim Öffnen eines Berichts aus dem Spielerprofil)
  const [matchExtra, setMatchExtra] = useState<{ art?: string | null; zeit?: string | null; url?: string | null }>({});
  useEffect(() => {
    if (!params.matchId || (params.matchArt && params.fussballDeUrl)) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('scouting_matches')
        .select('match_type, match_time, fussball_de_url')
        .eq('id', params.matchId)
        .maybeSingle();
      if (!cancelled && data) {
        setMatchExtra({ art: data.match_type, zeit: data.match_time, url: data.fussball_de_url });
      }
    })();
    return () => { cancelled = true; };
  }, [params.matchId]);
  const matchArt = params.matchArt || matchExtra.art || '';
  const matchZeit = params.matchZeit || matchExtra.zeit || '';
  const fussballDeUrl = params.fussballDeUrl || matchExtra.url || '';

  // Vereinswappen (über berater_clubs → Transfermarkt-CDN), rein optisch
  const [clubLogoUrl, setClubLogoUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!currentClub) return;
    let cancelled = false;
    (async () => {
      try {
        const tryFind = async (pattern: string): Promise<string | null> => {
          const { data } = await supabase
            .from('berater_clubs')
            .select('tm_club_id')
            .ilike('club_name', pattern)
            .limit(1);
          return data?.[0]?.tm_club_id || null;
        };
        let tmId = await tryFind(currentClub);
        if (!tmId) {
          // Zusätze wie "II", "2", "U16", "1848 II" am Ende abstreifen
          const base = currentClub.replace(/(\s+(II|III|IV|U\d+|\d+))+\s*$/i, '').trim();
          if (base && base.length >= 4 && base !== currentClub) {
            tmId = await tryFind(`${base}%`);
          }
        }
        if (tmId && !cancelled) {
          setClubLogoUrl(`https://tmssl.akamaized.net/images/wappen/head/${tmId}.png`);
        }
      } catch { /* Logo ist optional */ }
    })();
    return () => { cancelled = true; };
  }, [currentClub]);

  // Berater-Evaluation + Watchlist Status
  const [beraterPlayerId, setBeraterPlayerId] = useState<string>(params.beraterPlayerId || '');

  // Vereins-/Vertragsdaten für die Kopfkarten (aus berater_players, falls verknüpft)
  const [beraterInfo, setBeraterInfo] = useState<{
    birth_date?: string | null;
    club_name?: string | null;
    league_name?: string | null;
    contract_until?: string | null;
    market_value?: string | null;
    agent_name?: string | null;
    agent_url?: string | null;
  } | null>(null);
  useEffect(() => {
    if (!beraterPlayerId) return;
    let cancelled = false;
    supabase
      .from('berater_players')
      .select('birth_date, current_agent_name, current_agent_company, agent_url, market_value, contract_until, berater_clubs (club_name, berater_leagues (name))')
      .eq('id', beraterPlayerId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return;
        const d = data as any;
        setBeraterInfo({
          birth_date: d.birth_date,
          club_name: d.berater_clubs?.club_name,
          league_name: d.berater_clubs?.berater_leagues?.name,
          contract_until: d.contract_until,
          market_value: d.market_value,
          agent_name: agentDisplayName(d.current_agent_name, d.current_agent_company),
          agent_url: d.agent_url,
        });
      });
    return () => { cancelled = true; };
  }, [beraterPlayerId]);
  const [beraterEvalStatus, setBeraterEvalStatus] = useState<'interessant' | 'nicht_interessant' | 'top_ziel' | null>(null);
  const [onWatchlist, setOnWatchlist] = useState(false);
  // Nach dem Speichern: Vorschlag, den Spieler hochzustufen (7/8 -> Watchlist, 9/10 -> Top-Ziel)
  const [statusPrompt, setStatusPrompt] = useState<{ target: 'watchlist' | 'top_ziel'; playerId: string } | null>(null);
  const [statusPromptSaving, setStatusPromptSaving] = useState(false);

  // Bestehende Bewertung laden
  useEffect(() => {
    const loadExisting = async () => {
      if (!params.matchId || !parsedName.lastName) {
        hasLoadedRef.current = true;
        setIsLoading(false);
        return;
      }
      try {
        // 1. Bevorzugt über die eindeutige Aufstellungs-Zeile laden — Namen sind
        //    bei "k.A."-Spielern mehrdeutig und würden fremde Berichte laden.
        let data: any = null;
        if (params.lineupPlayerId) {
          const { data: byLineup } = await supabase
            .from('player_evaluations')
            .select('*')
            .eq('match_id', params.matchId)
            .eq('lineup_player_id', params.lineupPlayerId)
            .maybeSingle();
          data = byLineup;
        }
        // 2. Fallback per Name — nur mit echtem Namen, nie mit Platzhalter
        if (!data && parsedName.lastName && !isPlaceholderName(parsedName.lastName)) {
          let query = supabase
            .from('player_evaluations')
            .select('*')
            .eq('match_id', params.matchId)
            .eq('last_name', parsedName.lastName);
          if (parsedName.firstName) {
            query = query.eq('first_name', parsedName.firstName);
          } else {
            query = query.is('first_name', null);
          }
          const { data: byName } = await query.maybeSingle();
          // Nur übernehmen, wenn der Bericht nicht zu einer ANDEREN
          // Aufstellungs-Zeile gehört
          if (byName && (!byName.lineup_player_id || !params.lineupPlayerId || byName.lineup_player_id === params.lineupPlayerId)) {
            data = byName;
          }
        }
        if (data) {
          setExistingId(data.id);
          if (data.positions) setPositions(data.positions.split(', ').filter(Boolean) as Position[]);
          if (data.body_structure) setBodyStructure(data.body_structure);
          if (data.speed_athleticism) setSpeedAthleticism(data.speed_athleticism);
          if (data.overall_rating != null) setOverallRating(data.overall_rating);
          if (data.notes) setNotes(data.notes);
          // Felder erhalten die nicht mehr im UI sind
          setPreservedFields({
            height_m: data.height_m,
            height_cm: data.height_cm,
            development_stage: data.development_stage,
            adult_body_type: data.adult_body_type,
            physical_tags: data.physical_tags,
          });
        }
      } catch (err) {
        console.error('Error loading existing evaluation:', err);
      } finally {
        hasLoadedRef.current = true;
        setIsLoading(false);
      }
    };
    loadExisting();
  }, []);

  // Änderungen tracken nach initialem Laden
  const changeCountRef = useRef(0);
  useEffect(() => {
    if (hasLoadedRef.current) {
      // Ersten Trigger nach dem Laden ignorieren
      changeCountRef.current++;
      if (changeCountRef.current > 1) { setHasChanges(true); hasChangesRef.current = true; }
    }
  }, [positions, bodyStructure, speedAthleticism, overallRating, notes]);

  // Bestätigungsdialog beim Schließen mit ungespeicherten Änderungen
  const confirmClose = useCallback(() => {
    if (!hasChanges) {
      navigation.goBack();
      return;
    }
    if (Platform.OS === 'web') {
      if (window.confirm('Du hast ungespeicherte Änderungen. Möchtest du wirklich schließen?')) {
        navigation.goBack();
      }
    } else {
      Alert.alert(
        'Ungespeicherte Änderungen',
        'Du hast ungespeicherte Änderungen. Möchtest du wirklich schließen?',
        [
          { text: 'Abbrechen', style: 'cancel' },
          { text: 'Verwerfen', style: 'destructive', onPress: () => navigation.goBack() },
        ]
      );
    }
  }, [hasChanges, navigation]);

  // Hardware-Back-Button (Android) abfangen
  useEffect(() => {
    const onBackPress = () => {
      if (hasChanges) {
        confirmClose();
        return true; // prevent default
      }
      return false;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [hasChanges, confirmClose]);

  // Navigation beforeRemove abfangen (Web/iOS back gesture)
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e: any) => {
      if (!hasChangesRef.current) return;
      e.preventDefault();
      if (Platform.OS === 'web') {
        if (window.confirm('Du hast ungespeicherte Änderungen. Möchtest du wirklich schließen?')) {
          hasChangesRef.current = false;
          navigation.dispatch(e.data.action);
        }
      } else {
        Alert.alert(
          'Ungespeicherte Änderungen',
          'Du hast ungespeicherte Änderungen. Möchtest du wirklich schließen?',
          [
            { text: 'Abbrechen', style: 'cancel' },
            { text: 'Verwerfen', style: 'destructive', onPress: () => { hasChangesRef.current = false; navigation.dispatch(e.data.action); } },
          ]
        );
      }
    });
    return unsubscribe;
  }, [navigation, hasChanges]);

  // Berater-Status laden
  useEffect(() => {
    if (!beraterPlayerId) return;
    const loadBeraterStatus = async () => {
      const [eval_, wl] = await Promise.all([
        loadBeraterEval(beraterPlayerId),
        isOnWatchlist(beraterPlayerId),
      ]);
      if (eval_) setBeraterEvalStatus(eval_.status);
      setOnWatchlist(wl);
    };
    loadBeraterStatus();
  }, [beraterPlayerId]);

  // Berater-Spieler suchen oder on-demand erstellen
  const ensureBeraterPlayer = async (): Promise<string | null> => {
    if (beraterPlayerId) return beraterPlayerId;

    // 1. Per TM-URL suchen
    if (transfermarktUrl) {
      const { data: byUrl } = await supabase
        .from('berater_players')
        .select('id')
        .eq('tm_profile_url', transfermarktUrl)
        .maybeSingle();
      if (byUrl) {
        setBeraterPlayerId(byUrl.id);
        return byUrl.id;
      }
    }

    // Platzhalter-Name ("k.A.") ohne TM-Profil: keine belastbare Identität —
    // NICHT anlegen/matchen, sonst teilen sich alle unbekannten Spieler
    // denselben Datensatz (Berichte, Notizen, Status).
    if (isPlaceholderName(lastName) && !transfermarktUrl) return null;

    // 2. Per Name suchen — nie mit Platzhalter-Namen. Akzent-unabhängig über
    //    normalized_name, damit "Ouedraogo" den TM-Spieler "Ouédraogo" findet.
    const playerName = [firstName, lastName].filter(Boolean).join(' ');
    if (!isPlaceholderName(lastName)) {
      const playerNameReversed = [lastName, firstName].filter(Boolean).join(' ');
      const normsToTry = [...new Set(
        [playerName, playerNameReversed].filter(Boolean).map(normalizePlayerName)
      )].filter(Boolean);

      if (normsToTry.length > 0) {
        const { data: byNorm } = await supabase
          .from('berater_players')
          .select('id, birth_date')
          .in('normalized_name', normsToTry)
          .limit(5);
        // Kein Geburtsdatums-Widerspruch zulassen
        const match = (byNorm || []).find(
          (p) => !(birthDateFromTM && p.birth_date && p.birth_date !== birthDateFromTM)
        );
        if (match) {
          setBeraterPlayerId(match.id);
          return match.id;
        }
      }

      // 2b. Kompatible Namen (zweite Vornamen / Doppel-Nachnamen) — je
      //     Namens-Wort suchen, nur bei eindeutigem Treffer ohne
      //     Geburtsdatums-Widerspruch übernehmen
      {
        const myNorm = normalizePlayerName(playerName);
        const toks = myNorm.split(' ').filter((t) => t.length >= 3).slice(0, 4);
        const found = new Map<string, { id: string; player_name: string; normalized_name: string | null; birth_date: string | null }>();
        for (const tok of toks) {
          const { data: fuzzy } = await supabase
            .from('berater_players')
            .select('id, player_name, normalized_name, birth_date')
            .ilike('normalized_name', `%${tok}%`)
            .limit(10);
          for (const f of fuzzy || []) found.set(f.id, f);
        }
        const candidates = [...found.values()].filter((c) => {
          const cNorm = c.normalized_name || normalizePlayerName(c.player_name);
          if (!namesCompatible(myNorm, cNorm)) return false;
          return !(birthDateFromTM && c.birth_date && c.birth_date !== birthDateFromTM);
        });
        if (candidates.length === 1) {
          setBeraterPlayerId(candidates[0].id);
          return candidates[0].id;
        }
      }
    }

    // 3. Neuen Spieler anlegen (tm_player_id aus der URL, damit UNIQUE-Dedup greift)
    const tmIdMatch = transfermarktUrl?.match(/spieler\/(\d+)/);
    const { data: newPlayer, error } = await supabase
      .from('berater_players')
      .insert({
        player_name: playerName || lastName,
        tm_profile_url: transfermarktUrl || null,
        tm_player_id: tmIdMatch ? tmIdMatch[1] : null,
        birth_date: birthDateFromTM || null,
        position: positions[0] || null,
        is_active: true,
        has_agent: false,
      })
      .select('id')
      .single();

    if (error) {
      console.error('Error creating berater player:', error);
      return null;
    }
    setBeraterPlayerId(newPlayer.id);
    return newPlayer.id;
  };

  const handleBeraterEvaluation = async (status: 'interessant' | 'nicht_interessant') => {
    if (beraterEvalStatus === status) {
      if (!beraterPlayerId) return;
      const success = await deleteBeraterEval(beraterPlayerId);
      if (success) setBeraterEvalStatus(null);
    } else {
      const playerId = await ensureBeraterPlayer();
      if (!playerId) return;
      const success = await saveBeraterEval(playerId, status);
      if (success) setBeraterEvalStatus(status);
    }
  };

  const handleWatchlistToggle = async () => {
    if (onWatchlist) {
      if (!beraterPlayerId) return;
      const success = await removeFromWatchlist(beraterPlayerId);
      if (success) setOnWatchlist(false);
    } else {
      const playerId = await ensureBeraterPlayer();
      if (!playerId) return;
      const success = await addToWatchlist(playerId);
      if (success) setOnWatchlist(true);
    }
  };

  const handleSave = async () => {
    if (!lastName.trim()) {
      Alert.alert('Fehler', 'Nachname ist erforderlich.');
      return;
    }
    setSaving(true);
    try {
      // Bericht immer fest mit dem Spieler-Datensatz verknüpfen (legt ihn bei Bedarf an)
      let linkedPlayerId: string | null = null;
      try { linkedPlayerId = await ensureBeraterPlayer(); } catch { /* Verknüpfung optional */ }
      const evalData: Record<string, any> = {
        match_id: params.matchId || null,
        lineup_player_id: params.lineupPlayerId || null,
        match_name: matchName || null,
        match_date: matchDate || null,
        age_group: ageGroup || null,
        first_name: firstName || null,
        last_name: lastName,
        jersey_number: jerseyNumber ? parseInt(jerseyNumber) : null,
        current_club: currentClub || null,
        positions: positions.join(', ') || null,
        transfermarkt_url: transfermarktUrl || null,
        agent_name: agentName || null,
        birth_date: birthDateFromTM || null,
        height_m: preservedFields.height_m ?? null,
        height_cm: preservedFields.height_cm ?? null,
        body_structure: bodyStructure,
        development_stage: preservedFields.development_stage ?? null,
        adult_body_type: preservedFields.adult_body_type ?? null,
        physical_tags: preservedFields.physical_tags ?? null,
        speed_athleticism: speedAthleticism,
        overall_rating: overallRating || null,
        notes: notes || null,
      };
      // Nur setzen, wenn Verknüpfung gelang — nie eine bestehende überschreiben
      if (linkedPlayerId) evalData.berater_player_id = linkedPlayerId;
      let error;
      if (existingId) {
        ({ error } = await supabase
          .from('player_evaluations')
          .update(evalData)
          .eq('id', existingId));
      } else {
        const { data, error: insertError } = await supabase
          .from('player_evaluations')
          .insert(evalData)
          .select('id')
          .single();
        error = insertError;
        if (data) setExistingId(data.id);
      }
      if (error) {
        Alert.alert('Fehler', error.message);
      } else {
        hasChangesRef.current = false;
        setHasChanges(false);
        // Hochstufen vorschlagen: 7/8 -> Watchlist (nur von neutral aus),
        // 9/10 -> Top-Ziel (auch von der Watchlist aus). Nie runterstufen,
        // Uninteressant bleibt eine bewusste Entscheidung.
        const pid = linkedPlayerId || beraterPlayerId || null;
        const current = deriveScoutStatus(onWatchlist, beraterEvalStatus);
        if (pid && overallRating >= 9 && current !== 'top_ziel' && current !== 'uninteressant') {
          setStatusPrompt({ target: 'top_ziel', playerId: pid });
        } else if (pid && (overallRating === 7 || overallRating === 8) && current === 'neutral') {
          setStatusPrompt({ target: 'watchlist', playerId: pid });
        } else {
          navigation.goBack();
        }
      }
    } catch (err: any) {
      Alert.alert('Fehler', err.message || 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ThemeOverride colors={RETRO_THEME}>
    <View style={styles.modalOverlay}>
      <View style={[styles.modalContainer, HARD_SHADOW_LG, { backgroundColor: colors.background, borderColor: RETRO.shadowDark }]}>
        {/* Gelbe Titelleiste (Anstoss-Optik): links Badge+Art · Mitte Spiel+Icon · rechts Wochentag/Datum/Zeit · ✕ */}
        <View style={[HARD_SHADOW, {
          backgroundColor: RETRO.yellow,
          marginHorizontal: 12, marginTop: 12, marginBottom: 4,
          paddingVertical: 8, paddingHorizontal: 12,
          flexDirection: 'row', alignItems: 'center', gap: 10,
        }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ backgroundColor: colors.primary, paddingHorizontal: 5, paddingVertical: 1 }}>
              <Text style={{ fontSize: 10, fontWeight: '700', color: colors.primaryText }}>
                {ageGroup}
              </Text>
            </View>
            {matchArt ? (
              <Text style={{ fontSize: 13, fontWeight: '600', color: RETRO.text }} numberOfLines={1}>
                {matchArt}
              </Text>
            ) : null}
          </View>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Text style={{ fontSize: 16, fontWeight: '800', color: RETRO.text }} numberOfLines={1}>
              {matchName || [firstName, lastName].filter(Boolean).join(' ')}
            </Text>
            {fussballDeUrl ? (
              <TouchableOpacity
                onPress={() => Linking.openURL(fussballDeUrl)}
                activeOpacity={0.7}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <Image
                  source={require('../../../assets/fussballde-logo.png')}
                  style={{ width: 20, height: 20, borderWidth: 1, borderColor: RETRO.shadowDark }}
                />
              </TouchableOpacity>
            ) : null}
          </View>
          {matchDate ? (
            <Text style={{ fontSize: 13, fontWeight: '600', color: RETRO.text }} numberOfLines={1}>
              {formatMatchDateGerman(matchDate)}{matchZeit ? ` · ${matchZeit}` : ''}
            </Text>
          ) : null}
          <TouchableOpacity onPress={confirmClose} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={20} color={RETRO.text} />
          </TouchableOpacity>
        </View>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            {/* Header Card */}
            <EvalHeader
              jerseyNumber={jerseyNumber}
              firstName={firstName}
              lastName={lastName}
              birthDate={beraterInfo?.birth_date || birthDateFromTM}
              positions={positions}
              onPositionsChange={setPositions}
              overallRating={overallRating}
              onRatingChange={setOverallRating}
              transfermarktUrl={transfermarktUrl}
              clubLogoUrl={clubLogoUrl}
              clubName={beraterInfo?.club_name || [currentClub, ageGroup].filter(Boolean).join(' ')}
              leagueName={beraterInfo?.league_name}
              contractUntil={beraterInfo?.contract_until}
              marketValue={beraterInfo?.market_value}
              agentName={beraterInfo?.agent_name || agentName}
              agentUrl={beraterInfo?.agent_url}
            />

            {/* Körper + Athletik + rechte Spalte (Report/Einordnung) */}
            <View style={isMobile ? styles.cardsColumn : styles.cardsRow}>
              <KoerperCard
                relativeHeight={bodyStructure.relativeHeight}
                onRelativeHeightChange={(v) => setBodyStructure(prev => ({ ...prev, relativeHeight: v }))}
                proportion={bodyStructure.proportion}
                onProportionChange={(v) => setBodyStructure(prev => ({ ...prev, proportion: v }))}
                pelvis={bodyStructure.pelvis}
                onPelvisChange={(v) => setBodyStructure(prev => ({ ...prev, pelvis: v }))}
                shoulderLine={bodyStructure.shoulderLine}
                onShoulderLineChange={(v) => setBodyStructure(prev => ({ ...prev, shoulderLine: v }))}
                musculature={bodyStructure.musculature}
                onMusculatureChange={(v) => setBodyStructure(prev => ({ ...prev, musculature: v }))}
              />
              <AthletikCard
                antritt={speedAthleticism.antritt}
                onAntrittChange={(v) => setSpeedAthleticism(prev => ({ ...prev, antritt: v }))}
                endspeed={speedAthleticism.endspeed}
                onEndspeedChange={(v) => setSpeedAthleticism(prev => ({ ...prev, endspeed: v }))}
                beweglichkeit={speedAthleticism.beweglichkeit}
                onBeweglichkeitChange={(v) => setSpeedAthleticism(prev => ({ ...prev, beweglichkeit: v }))}
                koordination={speedAthleticism.koordination}
                onKoordinationChange={(v) => setSpeedAthleticism(prev => ({ ...prev, koordination: v }))}
                intensitaet={speedAthleticism.intensitaet}
                onIntensitaetChange={(v) => setSpeedAthleticism(prev => ({ ...prev, intensitaet: v }))}
              />

              {/* Rechte Spalte: Scouting Report + Einordnung */}
              <View style={styles.rightCol}>
                <View style={[styles.reportCard, { flex: 1, backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={RETRO_CHIP}>
                    <Text style={RETRO_CHIP_TEXT}>SCOUTING REPORT</Text>
                  </View>
                  <TextInput
                    style={[
                      styles.reportTextArea,
                      {
                        backgroundColor: colors.inputBackground,
                        borderColor: colors.inputBorder,
                        color: colors.text,
                      },
                      !isMobile && { flex: 1 },
                    ]}
                    value={notes}
                    onChangeText={setNotes}
                    placeholder="Detaillierte Beobachtungen..."
                    placeholderTextColor={colors.textSecondary}
                    multiline
                    numberOfLines={6}
                    textAlignVertical="top"
                  />
                  <View style={styles.noteQuickRow}>
                    {(['Stärke', 'Schwäche', 'Notiz'] as const).map((kind) => (
                      <TouchableOpacity
                        key={kind}
                        style={[RETRO_BTN, HARD_SHADOW, styles.noteQuickButton]}
                        onPress={() => setNotes(prev => `${prev ? prev.replace(/\s+$/, '') + '\n' : ''}${kind}: `)}
                      >
                        <Text style={[styles.evalButtonText, { color: RETRO.text }]}>+ {kind}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                <View style={[styles.reportCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={RETRO_CHIP}>
                    <Text style={RETRO_CHIP_TEXT}>EINORDNUNG</Text>
                  </View>
                  <View style={styles.evalButtons}>
                    <TouchableOpacity
                      style={[
                        RETRO_BTN, HARD_SHADOW, styles.evalButton,
                        beraterEvalStatus === 'nicht_interessant' && { backgroundColor: colors.error },
                      ]}
                      onPress={() => handleBeraterEvaluation('nicht_interessant')}
                    >
                      <Text style={[styles.evalButtonText, { color: beraterEvalStatus === 'nicht_interessant' ? '#fff' : RETRO.text }]}>
                        Uninteressant
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        RETRO_BTN, HARD_SHADOW, styles.evalButton,
                        beraterEvalStatus === 'interessant' && { backgroundColor: colors.success },
                      ]}
                      onPress={() => handleBeraterEvaluation('interessant')}
                    >
                      <Text style={[styles.evalButtonText, { color: beraterEvalStatus === 'interessant' ? '#fff' : RETRO.text }]}>
                        Interessant
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        RETRO_BTN, HARD_SHADOW, styles.evalButton,
                        onWatchlist && { backgroundColor: '#d4a017' },
                      ]}
                      onPress={handleWatchlistToggle}
                    >
                      <Text style={[styles.evalButtonText, { color: onWatchlist ? '#fff' : RETRO.text }]}>
                        Watchlist
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity
                    style={[RETRO_BTN, HARD_SHADOW, styles.saveButton, { backgroundColor: colors.primary, opacity: saving ? 0.6 : 1 }]}
                    onPress={handleSave}
                    disabled={saving}
                  >
                    <Text style={[styles.saveButtonText, { color: colors.primaryText }]}>
                      {saving ? 'Speichert...' : 'Änderungen speichern'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>

          </ScrollView>
        </KeyboardAvoidingView>
      </View>

      {/* Nach dem Speichern: Hochstufen vorschlagen (7/8 Watchlist, 9/10 Top-Ziel) */}
      {statusPrompt && (
        <Modal visible transparent animationType="fade" onRequestClose={() => { setStatusPrompt(null); navigation.goBack(); }}>
          <View style={styles.promptOverlay}>
            <View style={[styles.promptBox, HARD_SHADOW_LG]}>
              <View style={[styles.promptBar, HARD_SHADOW]}>
                <Text style={styles.promptTitle}>
                  {statusPrompt.target === 'top_ziel' ? 'Top-Ziel' : 'Watchlist'}
                </Text>
              </View>
              <Text style={styles.promptText}>
                {`${[firstName, lastName].filter(Boolean).join(' ')} wurde mit ${overallRating} bewertet. ` +
                  (statusPrompt.target === 'top_ziel' ? 'Als Top-Ziel markieren?' : 'Zur Watchlist hinzufügen?')}
              </Text>
              <View style={styles.promptActions}>
                <TouchableOpacity
                  style={[styles.promptBtn, HARD_SHADOW]}
                  onPress={() => { setStatusPrompt(null); navigation.goBack(); }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.promptBtnText}>Nein</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.promptBtn, HARD_SHADOW, { backgroundColor: '#22c55e' }]}
                  disabled={statusPromptSaving}
                  onPress={async () => {
                    if (statusPromptSaving) return;
                    setStatusPromptSaving(true);
                    await setScoutStatus(statusPrompt.playerId, statusPrompt.target);
                    setStatusPromptSaving(false);
                    setStatusPrompt(null);
                    navigation.goBack();
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.promptBtnText, { color: '#ffffff' }]}>
                    {statusPrompt.target === 'top_ziel' ? 'Top-Ziel' : 'Zur Watchlist'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </View>
    </ThemeOverride>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 16,
    paddingBottom: 40,
  },
  cardsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 16,
  },
  cardsColumn: {
    flexDirection: 'column',
    gap: 16,
  },
  rightCol: {
    flex: 1,
    gap: 16,
  },
  reportCard: {
    borderRadius: 2, // randlos, nur Schatten
    padding: 16,
    gap: 12,
    ...HARD_SHADOW,
  },
  reportLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 2,
    fontFamily: MONO,
  },
  reportTextArea: {
    // randlos — die Karte selbst ist das Eingabefeld
    borderRadius: 2,
    padding: 14,
    // gleiche Schrift wie die Auswahl-Buttons ("unterdurchschnittlich")
    fontSize: 10,
    fontWeight: '500',
    lineHeight: 16,
    minHeight: 140,
  },
  noteQuickRow: {
    flexDirection: 'row',
    gap: 8,
  },
  noteQuickButton: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  evalButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  evalButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  evalButtonText: {
    fontSize: 11,
    fontWeight: '600',
  },
  saveButton: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  saveButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContainer: {
    width: '95%',
    maxWidth: 1200,
    maxHeight: '92%',
    borderRadius: 2,
    borderWidth: 1,
    overflow: 'hidden',
  },
  // Hochstufen-Dialog nach dem Speichern
  promptOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  promptBox: {
    backgroundColor: '#e9e5dd',
    borderRadius: 2,
    width: 400,
    maxWidth: '92%',
    paddingBottom: 14,
  },
  promptBar: {
    backgroundColor: RETRO.yellow,
    paddingVertical: 9,
    paddingHorizontal: 14,
    margin: 10,
    marginBottom: 4,
  },
  promptTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: RETRO.text,
  },
  promptText: {
    fontSize: 14,
    color: RETRO.text,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  promptActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    paddingHorizontal: 14,
  },
  promptBtn: {
    backgroundColor: '#ffffff',
    borderRadius: 0,
    paddingHorizontal: 10,
    paddingVertical: 5,
    minHeight: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  promptBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: RETRO.text,
  },
});
