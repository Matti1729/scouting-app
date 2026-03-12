import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, Image, Linking, StyleSheet } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { Position, POSITION_LABELS } from '../../types';
import { Dropdown } from '../Dropdown';
import { RatingBar } from './RatingBar';

const POSITIONS: Position[] = ['TW', 'IV', 'LV', 'RV', 'DM', 'ZM', 'LM', 'RM', 'OM', 'LF', 'RF', 'ST'];
const POSITION_OPTIONS = POSITIONS.map(pos => ({
  value: pos,
  label: pos,
}));

const calculateAge = (birthDate: string): number | null => {
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
  return age >= 10 && age <= 50 ? age : null;
};

interface EvalHeaderProps {
  jerseyNumber: string;
  firstName: string;
  lastName: string;
  currentClub: string;
  ageGroup: string;
  birthDate: string;
  positions: Position[];
  onPositionsChange: (positions: Position[]) => void;
  matchName: string;
  matchDate: string;
  overallRating: number;
  onRatingChange: (value: number) => void;
  onClose: () => void;
  transfermarktUrl?: string;
  agentName?: string;
}

export function EvalHeader({
  jerseyNumber,
  firstName,
  lastName,
  currentClub,
  ageGroup,
  birthDate,
  positions,
  onPositionsChange,
  matchName,
  matchDate,
  overallRating,
  onRatingChange,
  onClose,
  transfermarktUrl,
  agentName,
}: EvalHeaderProps) {
  const { colors } = useTheme();

  const displayName = [firstName, lastName].filter(Boolean).join(' ') || 'Spieler';
  const age = useMemo(() => birthDate ? calculateAge(birthDate) : null, [birthDate]);
  const positionDisplay = positions.length > 0
    ? positions.map(p => POSITION_LABELS[p] || p).join(', ')
    : '';

  const matchDisplay = [ageGroup, matchName, matchDate].filter(Boolean).join(' · ');

  return (
    <View style={[styles.container, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
      {/* Top row: Match info (center) + Close (right) */}
      <View style={styles.topRow}>
        <View style={styles.topSpacer} />
        {matchDisplay ? (
          <Text style={[styles.matchInfo, { color: colors.text }]} numberOfLines={1}>
            {matchDisplay}
          </Text>
        ) : null}
        <View style={styles.topCloseWrap}>
          <TouchableOpacity
            onPress={onClose}
            style={[styles.closeButton, { borderColor: colors.border }]}
            activeOpacity={0.7}
          >
            <Text style={[styles.closeText, { color: colors.textSecondary }]}>✕</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Main row: Number + Info + Rating */}
      <View style={styles.mainRow}>
        <View style={[styles.numberCircle, { backgroundColor: colors.primary }]}>
          <Text style={[styles.numberText, { color: colors.primaryText }]}>
            #{jerseyNumber || '?'}
          </Text>
        </View>

        <View style={styles.infoContainer}>
          <View style={styles.nameRow}>
            <Text style={[styles.playerName, { color: colors.text }]} numberOfLines={1}>
              {displayName}
            </Text>
            {birthDate ? (
              <Text style={[styles.ageText, { color: colors.textSecondary }]}>
                {birthDate}{age !== null ? ` (${age} J.)` : ''}
              </Text>
            ) : null}
          </View>
          <View style={styles.metaRow}>
            {currentClub ? (
              <View style={[styles.clubBadge, { backgroundColor: colors.primary + '20' }]}>
                <Text style={[styles.clubText, { color: colors.primary }]} numberOfLines={1}>
                  {currentClub}
                </Text>
              </View>
            ) : null}
            {ageGroup ? (
              <Text style={[styles.metaText, { color: colors.textSecondary }]}>
                {currentClub ? ' \u2022 ' : ''}{ageGroup}
              </Text>
            ) : null}
            {positionDisplay ? (
              <Text style={[styles.metaText, { color: colors.textSecondary }]}>
                {' \u2022 '}{positionDisplay}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.ratingWrap}>
          <RatingBar value={overallRating} onChange={onRatingChange} />
        </View>

        {(transfermarktUrl || (agentName && agentName !== 'kein Beratereintrag')) ? (
          <View style={styles.rightInfo}>
            {transfermarktUrl ? (
              <TouchableOpacity
                onPress={() => Linking.openURL(transfermarktUrl)}
                activeOpacity={0.7}
              >
                <Image
                  source={require('../../../assets/transfermarkt-logo.png')}
                  style={styles.tmLogo}
                  resizeMode="contain"
                />
              </TouchableOpacity>
            ) : null}
            {agentName && agentName !== 'kein Beratereintrag' ? (
              <Text style={[styles.agentText, { color: colors.textSecondary }]} numberOfLines={1}>
                {agentName}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>

      {/* Position Dropdown - compact */}
      <View style={styles.positionWrap}>
        <Dropdown
          options={POSITION_OPTIONS}
          value={positions as string[]}
          onChange={(val) => onPositionsChange(val as Position[])}
          placeholder="Position wählen"
          multiSelect
          compact
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  topSpacer: {
    flex: 1,
  },
  matchInfo: {
    fontSize: 12,
    textAlign: 'center',
    flex: 2,
  },
  topCloseWrap: {
    flex: 1,
    alignItems: 'flex-end',
  },
  closeButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeText: {
    fontSize: 14,
    fontWeight: '600',
  },
  mainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  numberCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  numberText: {
    fontSize: 16,
    fontWeight: '700',
  },
  infoContainer: {
    flex: 1,
    gap: 4,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  playerName: {
    fontSize: 18,
    fontWeight: '700',
  },
  ageText: {
    fontSize: 14,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  clubBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  clubText: {
    fontSize: 12,
    fontWeight: '600',
  },
  metaText: {
    fontSize: 12,
  },
  ratingWrap: {
    flex: 1,
    alignItems: 'center',
  },
  rightInfo: {
    alignItems: 'flex-end',
    gap: 4,
  },
  tmLogo: {
    height: 22,
    width: 55,
  },
  agentText: {
    fontSize: 10,
    maxWidth: 80,
  },
  positionWrap: {
    alignSelf: 'flex-start',
    flexShrink: 0,
  },
});
