import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Linking,
} from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { PhysicalTagSelector } from '../../components/PhysicalTagSelector';
import { DevelopmentStageSelector } from '../../components/DevelopmentStageSelector';
import { Dropdown } from '../../components/Dropdown';
import { BodyStructureSelector } from '../../components/BodyStructureSelector';
import { AdultBodyTypeSelector } from '../../components/AdultBodyTypeSelector';
import { SpeedAthleticismSelector, createEmptySpeedAthleticismData } from '../../components/SpeedAthleticismSelector';
import {
  PhysicalTag,
  DevelopmentStage,
  AgeGroup,
  Position,
  POSITION_LABELS,
  BodyStructureData,
  AdultBodyType,
  SpeedAthleticismData,
} from '../../types';
import { createEmptyBodyStructureData, isYouthPlayer } from '../../utils/bodyStructureCalculation';

const POSITIONS: Position[] = ['TW', 'IV', 'LV', 'RV', 'DM', 'ZM', 'LM', 'RM', 'OM', 'LF', 'RF', 'ST'];

const POSITION_OPTIONS = POSITIONS.map(pos => ({
  value: pos,
  label: `${pos} - ${POSITION_LABELS[pos]}`,
}));

// Alter aus Geburtsdatum berechnen (Format: DD.MM.YYYY)
const calculateAge = (birthDate: string): number | null => {
  const parts = birthDate.split('.');
  if (parts.length !== 3) return null;
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const year = parseInt(parts[2], 10);
  const birth = new Date(year, month, day);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
};

// Geburtsdatum mit Alter formatieren
const formatBirthDateWithAge = (birthDate: string): string => {
  const age = calculateAge(birthDate);
  if (age !== null) {
    return `${birthDate} (${age})`;
  }
  return birthDate;
};

export function PlayerEvaluationScreen({ navigation, route }: any) {
  const { colors } = useTheme();

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

  // Event-Daten (Partie/Turnier) - aus Navigation oder manuell
  const [matchName, setMatchName] = useState(params.matchName || '');
  const [matchDate, setMatchDate] = useState(params.matchDate || '');
  const [ageGroup, setAgeGroup] = useState<AgeGroup>(
    (params.mannschaft as AgeGroup) || 'U15'
  );

  // Spielerdaten - aus Navigation übernehmen
  const [lastName, setLastName] = useState(parsedName.lastName);
  const [firstName, setFirstName] = useState(parsedName.firstName);
  const [jerseyNumber, setJerseyNumber] = useState(params.playerNumber || '');
  const [currentClub, setCurrentClub] = useState(params.playerClub || '');
  const [positions, setPositions] = useState<Position[]>(
    params.playerPosition ? [params.playerPosition as Position] : []
  );
  const transfermarktUrl = params.transfermarktUrl || '';
  const agentName = params.agentName || '';
  const birthDateFromTM = params.playerBirthDate || ''; // Vollständiges Geburtsdatum von TM

  // Größe für Körperbau (in Metern, z.B. "1.75")
  const heightFromTM = params.playerHeight || ''; // Größe von Transfermarkt (in cm oder m)
  const [playerHeightM, setPlayerHeightM] = useState(() => {
    // Konvertiere von cm zu m wenn nötig
    if (heightFromTM) {
      const num = parseFloat(heightFromTM.replace(',', '.'));
      if (!isNaN(num)) {
        // Wenn > 3, ist es wahrscheinlich in cm
        return num > 3 ? (num / 100).toFixed(2) : num.toFixed(2);
      }
    }
    return '';
  });

  // Körperbau für Jugendspieler (Entwicklungszustand)
  const [bodyStructure, setBodyStructure] = useState<BodyStructureData>(
    createEmptyBodyStructureData()
  );

  // Körpertyp für Erwachsene
  const [adultBodyType, setAdultBodyType] = useState<AdultBodyType | null>(null);

  // Geburtsjahr aus Datum extrahieren (für Jugend/Erwachsen-Unterscheidung)
  const birthYear = useMemo(() => {
    if (birthDateFromTM) {
      // Format: DD.MM.YYYY
      const parts = birthDateFromTM.split('.');
      if (parts.length === 3) {
        return parseInt(parts[2], 10);
      }
    }
    return null;
  }, [birthDateFromTM]);

  // Prüfen ob Jugendspieler (noch U19-berechtigt)
  const isYouth = useMemo(() => {
    if (birthYear) {
      return isYouthPlayer(birthYear);
    }
    // Wenn kein Geburtsjahr bekannt, default zu Jugend
    return true;
  }, [birthYear]);

  // Spieleralter berechnen (für Körperbau-Prognose bei Jugendspielern)
  const playerAge = useMemo(() => {
    if (birthDateFromTM) {
      return calculateAge(birthDateFromTM);
    }
    return null;
  }, [birthDateFromTM]);

  // Schnelligkeit & Athletik
  const [speedAthleticism, setSpeedAthleticism] = useState<SpeedAthleticismData>(
    createEmptySpeedAthleticismData()
  );

  // Körperliche Daten
  const [heightCm, setHeightCm] = useState('');
  const [developmentStage, setDevelopmentStage] = useState<DevelopmentStage>('im_wachstumsschub');
  const [physicalTags, setPhysicalTags] = useState<PhysicalTag[]>([]);

  // Bewertung
  const [overallRating, setOverallRating] = useState(5);
  const [notes, setNotes] = useState('');

  const handleTagToggle = (tag: PhysicalTag) => {
    setPhysicalTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handlePositionToggle = (pos: Position) => {
    setPositions((prev) =>
      prev.includes(pos) ? prev.filter((p) => p !== pos) : [...prev, pos]
    );
  };

  // Positionen als Text (für Anzeige)
  const positionsText = positions.length > 0
    ? positions.map(p => POSITION_LABELS[p]).join(', ')
    : 'Position wählen';

  const handleSave = () => {
    // TODO: Speichern in Supabase
    console.log({
      matchName,
      matchDate,
      ageGroup,
      lastName,
      firstName,
      jerseyNumber: jerseyNumber ? parseInt(jerseyNumber) : null,
      currentClub,
      positions,
      playerHeightM: playerHeightM ? parseFloat(playerHeightM) : null,
      bodyStructure,
      heightCm: heightCm ? parseInt(heightCm) : null,
      developmentStage,
      physicalTags,
      overallRating,
      notes,
    });
  };

  return (
    <View style={styles.modalOverlay}>
      <View style={[styles.modalContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {/* Modal Header */}
        <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
          >
            <Text style={[styles.backButtonText, { color: colors.textSecondary }]}>←</Text>
            <Text style={[styles.backButtonLabel, { color: colors.textSecondary }]}>Aufstellung</Text>
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Spieler bewerten</Text>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={() => navigation.goBack()}
          >
            <Text style={[styles.closeButtonText, { color: colors.textSecondary }]}>✕</Text>
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {/* ========== SPIELERDATEN (OBEN) ========== */}
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {/* Event-Header: Altersklasse | Partie | Datum */}
            <View style={styles.eventHeader}>
              {/* Links: Altersklasse (vom Event, nicht editierbar) */}
              <View style={[styles.ageGroupBadge, { backgroundColor: colors.primary }]}>
                <Text style={[styles.ageGroupText, { color: colors.primaryText }]}>{ageGroup}</Text>
              </View>

              {/* Mitte: Partie/Spielname */}
              <TextInput
                style={[styles.matchNameInput, { color: colors.text }]}
                value={matchName}
                onChangeText={setMatchName}
                placeholder="Partie / Turnier"
                placeholderTextColor={colors.textSecondary}
              />

              {/* Rechts: Datum */}
              <TextInput
                style={[styles.matchDateInput, { color: colors.textSecondary }]}
                value={matchDate}
                onChangeText={setMatchDate}
                placeholder="Datum"
                placeholderTextColor={colors.textSecondary}
              />
            </View>

            {/* Trennlinie */}
            <View style={[styles.divider, { backgroundColor: colors.border }]} />

            {/* Spieler-Info Zeile */}
            <View style={styles.playerHeader}>
              {/* Links: Nummer */}
              <TextInput
                style={[
                  styles.jerseyNumberInput,
                  {
                    backgroundColor: colors.inputBackground,
                    borderColor: colors.inputBorder,
                    color: colors.text,
                  },
                ]}
                value={jerseyNumber}
                onChangeText={setJerseyNumber}
                placeholder="#"
                placeholderTextColor={colors.textSecondary}
                keyboardType="numeric"
                maxLength={2}
              />

              {/* Mitte: Name + Position */}
              <View style={styles.playerInfo}>
                <View style={styles.nameRow}>
                  <TextInput
                    style={[styles.nameInput, { color: colors.text }]}
                    value={lastName}
                    onChangeText={setLastName}
                    placeholder="Name"
                    placeholderTextColor={colors.textSecondary}
                  />
                  <Text style={[styles.nameComma, { color: colors.text }]}>, </Text>
                  <TextInput
                    style={[styles.nameInput, { color: colors.text }]}
                    value={firstName}
                    onChangeText={setFirstName}
                    placeholder="Vorname"
                    placeholderTextColor={colors.textSecondary}
                  />
                </View>
                <Text style={[styles.positionText, { color: colors.textSecondary }]}>
                  {positionsText}
                </Text>
              </View>

              {/* Rechts: Verein + TM-Link */}
              <View style={styles.clubContainer}>
                <View style={[styles.clubBox, { borderColor: colors.border }]}>
                  <TextInput
                    style={[styles.clubInput, { color: colors.text }]}
                    value={currentClub}
                    onChangeText={setCurrentClub}
                    placeholder="Verein"
                    placeholderTextColor={colors.textSecondary}
                  />
                </View>
                {transfermarktUrl ? (
                  <TouchableOpacity
                    style={[styles.tmLinkButton, { backgroundColor: colors.surfaceSecondary }]}
                    onPress={() => Linking.openURL(transfermarktUrl)}
                  >
                    <Text style={[styles.tmLinkText, { color: colors.primary }]}>TM</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>

            {/* Berater-Info */}
            {agentName ? (
              <View style={styles.agentRow}>
                <Text style={[styles.agentLabel, { color: colors.textSecondary }]}>Berater:</Text>
                <Text style={[styles.agentName, { color: colors.primary }]}>{agentName}</Text>
              </View>
            ) : null}

            {/* Geburtsdatum von Transfermarkt */}
            {birthDateFromTM ? (
              <View style={styles.agentRow}>
                <Text style={[styles.agentLabel, { color: colors.textSecondary }]}>Geburtsdatum:</Text>
                <Text style={[styles.birthDateText, { color: colors.text }]}>{formatBirthDateWithAge(birthDateFromTM)}</Text>
              </View>
            ) : null}

            {/* Trennlinie */}
            <View style={[styles.divider, { backgroundColor: colors.border }]} />

            {/* Position Auswahl */}
            <Dropdown
              label="Position"
              options={POSITION_OPTIONS}
              value={positions}
              onChange={(val) => setPositions(val as Position[])}
              placeholder="Position wählen"
              multiSelect
            />
          </View>

          {/* ========== KÖRPERBAU / ENTWICKLUNGSZUSTAND ========== */}
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sectionHeader, { color: colors.text }]}>
              {isYouth ? 'Körperliche Entwicklungszustand' : 'Körperbau'}
            </Text>

            {isYouth ? (
              /* Jugendspieler: Vollständige Entwicklungsprognose */
              <>
                {/* Größe in Metern */}
                <View style={styles.inputGroup}>
                  <Text style={[styles.label, { color: colors.textSecondary }]}>Größe (m)</Text>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: colors.inputBackground,
                        borderColor: colors.inputBorder,
                        color: colors.text,
                        maxWidth: 120,
                      },
                    ]}
                    value={playerHeightM}
                    onChangeText={setPlayerHeightM}
                    placeholder="z.B. 1.75"
                    placeholderTextColor={colors.textSecondary}
                    keyboardType="decimal-pad"
                    maxLength={4}
                  />
                </View>

                <BodyStructureSelector
                  data={bodyStructure}
                  onChange={setBodyStructure}
                  playerAge={playerAge}
                />
              </>
            ) : (
              /* Erwachsene: Vereinfachter Körperbau ohne Prognose */
              <AdultBodyTypeSelector
                heightM={playerHeightM}
                onHeightChange={setPlayerHeightM}
                bodyType={adultBodyType}
                onBodyTypeChange={setAdultBodyType}
              />
            )}
          </View>

          {/* ========== SCHNELLIGKEIT & ATHLETIK ========== */}
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sectionHeader, { color: colors.text }]}>
              Schnelligkeit & Athletik
            </Text>
            <SpeedAthleticismSelector
              data={speedAthleticism}
              onChange={setSpeedAthleticism}
            />
          </View>

          {/* ========== BEWERTUNG ========== */}
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sectionHeader, { color: colors.text }]}>
              Gesamtbewertung
            </Text>

            {/* Rating 1-10 */}
            <View style={styles.ratingContainer}>
              <Text style={[styles.ratingValue, { color: colors.primary }]}>{overallRating}</Text>
              <View style={styles.ratingButtons}>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
                  <TouchableOpacity
                    key={num}
                    style={[
                      styles.ratingButton,
                      {
                        backgroundColor: overallRating === num ? colors.primary : colors.surfaceSecondary,
                        borderColor: overallRating === num ? colors.primary : colors.border,
                      },
                    ]}
                    onPress={() => setOverallRating(num)}
                  >
                    <Text
                      style={[
                        styles.ratingButtonText,
                        { color: overallRating === num ? colors.primaryText : colors.text },
                      ]}
                    >
                      {num}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Notizen */}
            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>Notizen</Text>
              <TextInput
                style={[
                  styles.textArea,
                  {
                    backgroundColor: colors.inputBackground,
                    borderColor: colors.inputBorder,
                    color: colors.text,
                  },
                ]}
                value={notes}
                onChangeText={setNotes}
                placeholder="Stärken, Schwächen, Beobachtungen..."
                placeholderTextColor={colors.textSecondary}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />
            </View>
          </View>

          {/* ========== SPEICHERN ========== */}
          <TouchableOpacity
            style={[styles.saveButton, { backgroundColor: colors.primary }]}
            onPress={handleSave}
          >
            <Text style={[styles.saveButtonText, { color: colors.primaryText }]}>
              Spieler speichern
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 16,
    paddingBottom: 40,
  },
  section: {
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    gap: 16,
  },
  sectionHeader: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  inputGroup: {
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  textArea: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    minHeight: 100,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '500',
  },
  hint: {
    fontSize: 12,
    marginTop: 4,
  },
  tagsSection: {
    marginTop: 8,
  },
  ratingContainer: {
    alignItems: 'center',
    gap: 12,
  },
  ratingValue: {
    fontSize: 48,
    fontWeight: '700',
  },
  ratingButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  ratingButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ratingButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  saveButton: {
    padding: 16,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  // Spieler Header Styles
  playerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  jerseyNumberInput: {
    width: 50,
    height: 50,
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  playerInfo: {
    flex: 1,
    gap: 2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  nameInput: {
    fontSize: 17,
    fontWeight: '600',
    padding: 0,
    minWidth: 60,
  },
  nameComma: {
    fontSize: 17,
    fontWeight: '600',
  },
  birthInput: {
    fontSize: 14,
    padding: 0,
  },
  clubBox: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 80,
  },
  clubInput: {
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
    padding: 0,
  },
  clubContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tmLinkButton: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 6,
  },
  tmLinkText: {
    fontSize: 12,
    fontWeight: '700',
  },
  agentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 6,
  },
  agentLabel: {
    fontSize: 12,
  },
  agentName: {
    fontSize: 12,
    fontWeight: '600',
  },
  birthDateText: {
    fontSize: 12,
    fontWeight: '500',
  },
  // Event Header Styles
  eventHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  ageGroupBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  ageGroupText: {
    fontSize: 14,
    fontWeight: '700',
  },
  matchNameInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    padding: 0,
  },
  matchDateInput: {
    fontSize: 14,
    textAlign: 'right',
    padding: 0,
    minWidth: 80,
  },
  divider: {
    height: 1,
    marginVertical: 12,
  },
  positionText: {
    fontSize: 14,
    fontWeight: '500',
  },
  birthInline: {
    fontSize: 15,
    fontWeight: '400',
  },
  // Dropdown Layout
  dropdownRow: {
    flexDirection: 'row',
    gap: 12,
  },
  dropdownHalf: {
    flex: 1,
  },
  // Modal Styles
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
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    flex: 1,
    textAlign: 'center',
  },
  closeButton: {
    padding: 4,
    width: 100,
    alignItems: 'flex-end',
  },
  closeButtonText: {
    fontSize: 24,
    fontWeight: '300',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 4,
    gap: 6,
    width: 100,
  },
  backButtonText: {
    fontSize: 20,
    fontWeight: '400',
  },
  backButtonLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
});
