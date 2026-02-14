import React, { useCallback, memo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useTheme } from '../contexts/ThemeContext';

// Hilfsfunktion: Alter aus Geburtsdatum berechnen (Format: "DD.MM.YYYY")
const calculateAge = (birthDate: string): number | null => {
  if (!birthDate) return null;
  const parts = birthDate.split('.');
  if (parts.length !== 3) return null;
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
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
const getDisplayYear = (birthDate?: string, jahrgang?: string): string => {
  if (birthDate) {
    const parts = birthDate.split('.');
    if (parts.length === 3) return parts[2];
  }
  return jahrgang || '';
};

// Hilfsfunktion: Alter und Jahr für Anzeige formatieren
const getAgeDisplay = (birthDate?: string, jahrgang?: string): string => {
  if (birthDate) {
    const age = calculateAge(birthDate);
    const year = getDisplayYear(birthDate, jahrgang);
    if (age !== null && year) {
      return `${year}, ${age} J.`;
    }
  }
  return jahrgang || '';
};

export interface Player {
  id: string;
  nummer: string;
  vorname: string;
  name: string;
  jahrgang: string;
  position: string;
  transfermarkt_url?: string;
  agent_name?: string;
  agent_company?: string;
  has_agent?: boolean;
  birth_date?: string;
  fussball_de_url?: string;
  isGoalkeeper?: boolean;
}

export interface PlayerRowProps {
  player: Player;
  onPress?: (player: Player) => void;
  onFieldChange?: (playerId: string, field: keyof Player, value: string) => void;
  isEditMode: boolean;
  showPosition?: boolean;
}

export const PlayerRow = memo<PlayerRowProps>(({
  player,
  onPress,
  onFieldChange,
  isEditMode,
  showPosition = false,
}) => {
  const { colors } = useTheme();

  // Memoized handlers for text input changes
  const handleNummerChange = useCallback((text: string) => {
    onFieldChange?.(player.id, 'nummer', text);
  }, [player.id, onFieldChange]);

  const handleVornameChange = useCallback((text: string) => {
    onFieldChange?.(player.id, 'vorname', text);
  }, [player.id, onFieldChange]);

  const handleNameChange = useCallback((text: string) => {
    onFieldChange?.(player.id, 'name', text);
  }, [player.id, onFieldChange]);

  const handlePress = useCallback(() => {
    if (!isEditMode && onPress) {
      onPress(player);
    }
  }, [isEditMode, onPress, player]);

  const ageDisplay = getAgeDisplay(player.birth_date, player.jahrgang);

  return (
    <TouchableOpacity
      style={[styles.playerRow, { borderBottomColor: colors.border }]}
      onPress={handlePress}
      disabled={isEditMode}
      activeOpacity={isEditMode ? 1 : 0.7}
    >
      {isEditMode ? (
        <TextInput
          style={[
            styles.playerNumberInput,
            {
              backgroundColor: colors.inputBackground,
              borderColor: colors.inputBorder,
              color: colors.text,
            },
          ]}
          value={player.nummer}
          onChangeText={handleNummerChange}
          keyboardType="number-pad"
          maxLength={3}
        />
      ) : (
        <View style={[styles.playerNumber, { backgroundColor: colors.surfaceSecondary }]}>
          <Text style={[styles.playerNumberText, { color: colors.text }]}>
            {player.nummer?.replace(/^0+/, '') || player.nummer}
          </Text>
        </View>
      )}

      <View style={styles.playerInfo}>
        {isEditMode ? (
          <View style={styles.playerNameRow}>
            <TextInput
              style={[
                styles.playerNameInput,
                {
                  backgroundColor: colors.inputBackground,
                  borderColor: colors.inputBorder,
                  color: colors.text,
                },
              ]}
              value={player.vorname}
              onChangeText={handleVornameChange}
              placeholder="Vorname"
              placeholderTextColor={colors.textSecondary}
            />
            <TextInput
              style={[
                styles.playerNameInput,
                {
                  backgroundColor: colors.inputBackground,
                  borderColor: colors.inputBorder,
                  color: colors.text,
                },
              ]}
              value={player.name}
              onChangeText={handleNameChange}
              placeholder="Name"
              placeholderTextColor={colors.textSecondary}
            />
          </View>
        ) : (
          <>
            <View style={styles.playerNameDisplay}>
              <Text style={[styles.playerName, { color: colors.text }]}>
                {player.name}, {player.vorname}
              </Text>
              {ageDisplay && (
                <Text style={[styles.playerJahrgang, { color: colors.textSecondary }]}>
                  ({ageDisplay})
                </Text>
              )}
              {player.agent_name && (
                <Text style={[styles.playerAgent, { color: colors.primary }]}>
                  {player.agent_name}
                </Text>
              )}
            </View>
            {showPosition && player.position && (
              <Text style={[styles.playerPosition, { color: colors.textSecondary }]}>
                {player.position}
              </Text>
            )}
          </>
        )}
      </View>

    </TouchableOpacity>
  );
});

PlayerRow.displayName = 'PlayerRow';

const styles = StyleSheet.create({
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    minHeight: 32,
  },
  playerNumber: {
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  playerNumberText: {
    fontSize: 11,
    fontWeight: '600',
  },
  playerNumberInput: {
    width: 40,
    height: 30,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 6,
    marginRight: 8,
    fontSize: 13,
    textAlign: 'center',
  },
  playerInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  playerNameRow: {
    flexDirection: 'row',
    gap: 6,
  },
  playerNameInput: {
    flex: 1,
    height: 30,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    fontSize: 13,
  },
  playerNameDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 5,
  },
  playerName: {
    fontSize: 12,
    fontWeight: '500',
  },
  playerJahrgang: {
    fontSize: 11,
  },
  playerAgent: {
    fontSize: 10,
    fontWeight: '500',
  },
  playerPosition: {
    fontSize: 11,
    marginTop: 1,
  },
});

export default PlayerRow;
