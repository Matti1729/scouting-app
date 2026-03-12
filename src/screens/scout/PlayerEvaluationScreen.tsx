import React, { useState, useEffect } from 'react';
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
} from 'react-native';
import { supabase } from '../../config/supabase';
import { useTheme } from '../../contexts/ThemeContext';
import {
  AgeGroup,
  Position,
  BodyStructureData,
  SpeedAthleticismData,
} from '../../types';
import { createEmptyBodyStructureData } from '../../utils/bodyStructureCalculation';
import { createEmptySpeedAthleticismData } from '../../components/SpeedAthleticismSelector';
import { EvalHeader } from '../../components/evaluation/EvalHeader';
import { KoerperCard } from '../../components/evaluation/KoerperCard';
import { AthletikCard } from '../../components/evaluation/AthletikCard';
import {
  savePlayerEvaluation as saveBeraterEval,
  deletePlayerEvaluation as deleteBeraterEval,
  loadPlayerEvaluation as loadBeraterEval,
  addToWatchlist,
  removeFromWatchlist,
  isOnWatchlist,
} from '../../services/beraterService';

export function PlayerEvaluationScreen({ navigation, route }: any) {
  const { colors } = useTheme();
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

  // Berater-Evaluation + Watchlist Status
  const [beraterPlayerId, setBeraterPlayerId] = useState<string>(params.beraterPlayerId || '');
  const [beraterEvalStatus, setBeraterEvalStatus] = useState<'interessant' | 'nicht_interessant' | null>(null);
  const [onWatchlist, setOnWatchlist] = useState(false);

  // Bestehende Bewertung laden
  useEffect(() => {
    const loadExisting = async () => {
      if (!params.matchId || !parsedName.lastName) {
        setIsLoading(false);
        return;
      }
      try {
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
        const { data } = await query.maybeSingle();
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
        setIsLoading(false);
      }
    };
    loadExisting();
  }, []);

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

    // 2. Per Name suchen
    const playerName = [firstName, lastName].filter(Boolean).join(' ');
    if (playerName) {
      const { data: byName } = await supabase
        .from('berater_players')
        .select('id')
        .ilike('player_name', playerName)
        .maybeSingle();
      if (byName) {
        setBeraterPlayerId(byName.id);
        return byName.id;
      }
    }

    // 3. Neuen Spieler anlegen
    const { data: newPlayer, error } = await supabase
      .from('berater_players')
      .insert({
        player_name: playerName || lastName,
        tm_profile_url: transfermarktUrl || null,
        tm_player_id: null,
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
      if (existingId) evalData.id = existingId;
      const { error } = await supabase.from('player_evaluations').upsert(evalData, {
        onConflict: 'match_id,last_name,first_name',
      });
      if (error) {
        Alert.alert('Fehler', error.message);
      } else {
        navigation.goBack();
      }
    } catch (err: any) {
      Alert.alert('Fehler', err.message || 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.modalOverlay}>
      <View style={[styles.modalContainer, { backgroundColor: colors.background, borderColor: colors.border }]}>
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
              currentClub={currentClub}
              ageGroup={ageGroup}
              birthDate={birthDateFromTM}
              positions={positions}
              onPositionsChange={setPositions}
              matchName={matchName}
              matchDate={matchDate}
              overallRating={overallRating}
              onRatingChange={setOverallRating}
              onClose={() => navigation.goBack()}
              transfermarktUrl={transfermarktUrl}
              agentName={agentName}
            />

            {/* Körper + Athletik Cards */}
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
            </View>

            {/* Scouting Report */}
            <View style={[styles.reportCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.reportLabel, { color: colors.textSecondary }]}>SCOUTING REPORT</Text>
              <TextInput
                style={[
                  styles.reportTextArea,
                  {
                    backgroundColor: colors.inputBackground,
                    borderColor: colors.inputBorder,
                    color: colors.text,
                  },
                ]}
                value={notes}
                onChangeText={setNotes}
                placeholder="Detaillierte Beobachtungen..."
                placeholderTextColor={colors.textSecondary}
                multiline
                numberOfLines={6}
                textAlignVertical="top"
              />
            </View>

          </ScrollView>
          {/* Fixed bottom bar */}
          <View style={[styles.bottomBar, { borderTopColor: colors.border }]}>
            <View style={styles.evalButtons}>
              <TouchableOpacity
                style={[
                  styles.evalButton,
                  beraterEvalStatus === 'nicht_interessant'
                    ? { backgroundColor: colors.error }
                    : { backgroundColor: colors.border },
                ]}
                onPress={() => handleBeraterEvaluation('nicht_interessant')}
              >
                <Text style={[styles.evalButtonText, { color: beraterEvalStatus === 'nicht_interessant' ? '#fff' : colors.textSecondary }]}>
                  Uninteressant
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.evalButton,
                  beraterEvalStatus === 'interessant'
                    ? { backgroundColor: colors.success }
                    : { backgroundColor: colors.border },
                ]}
                onPress={() => handleBeraterEvaluation('interessant')}
              >
                <Text style={[styles.evalButtonText, { color: beraterEvalStatus === 'interessant' ? '#fff' : colors.textSecondary }]}>
                  Interessant
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.evalButton,
                  onWatchlist
                    ? { backgroundColor: colors.warning }
                    : { backgroundColor: colors.border },
                ]}
                onPress={handleWatchlistToggle}
              >
                <Text style={[styles.evalButtonText, { color: onWatchlist ? '#fff' : colors.textSecondary }]}>
                  Watchlist
                </Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[styles.saveButton, { backgroundColor: colors.primary, opacity: saving ? 0.6 : 1 }]}
              onPress={handleSave}
              disabled={saving}
            >
              <Text style={[styles.saveButtonText, { color: colors.primaryText }]}>
                {saving ? 'Speichert...' : 'Änderungen speichern'}
              </Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    </View>
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
    gap: 16,
  },
  cardsColumn: {
    flexDirection: 'column',
    gap: 16,
  },
  reportCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  reportLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1,
  },
  reportTextArea: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    minHeight: 140,
  },
  bottomBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
  },
  evalButtons: {
    flexDirection: 'row',
    gap: 6,
  },
  evalButton: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  evalButtonText: {
    fontSize: 11,
    fontWeight: '600',
  },
  saveButton: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 6,
    alignItems: 'center',
  },
  saveButtonText: {
    fontSize: 11,
    fontWeight: '600',
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
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
});
