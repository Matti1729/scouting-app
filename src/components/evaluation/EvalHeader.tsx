import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, Image, Linking, StyleSheet, Platform, useWindowDimensions } from 'react-native';
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

const openUrl = (url: string) => {
  if (Platform.OS === 'web') {
    window.open(url, '_blank');
  } else {
    Linking.openURL(url);
  }
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
  const { width } = useWindowDimensions();
  const isDesktop = width >= 768;
  const displayName = [firstName, lastName].filter(Boolean).join(' ') || 'Spieler';
  const age = useMemo(() => birthDate ? calculateAge(birthDate) : null, [birthDate]);
  const matchDisplay = [ageGroup, matchName, matchDate].filter(Boolean).join(' · ');

  const birthYear = birthDate ? birthDate.split('.')[2]?.slice(-2) : null;

  return (
    <View style={[styles.container, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
      {/* Row 1: Match info */}
      {matchDisplay ? (
        <Text style={[styles.matchInfo, { color: colors.text }]} numberOfLines={1}>
          {matchDisplay}
        </Text>
      ) : null}

      {/* Row 2: #Number + Name + TM logo */}
      <View style={styles.mobileNameRow}>
        <View style={[styles.mobileJerseyBadge, { borderColor: colors.border }]}>
          <Text style={[styles.mobileJerseyText, { color: colors.text }]}>
            #{jerseyNumber || '?'}
          </Text>
        </View>
        <Text style={[styles.playerNameMobile, { color: colors.text }]} numberOfLines={1}>
          {displayName}
        </Text>
        <View style={{ flex: 1 }} />
        {transfermarktUrl ? (
          <TouchableOpacity onPress={() => openUrl(transfermarktUrl)} activeOpacity={0.7}>
            <Image
              source={require('../../../assets/transfermarkt-logo.png')}
              style={styles.tmLogo}
              resizeMode="contain"
            />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Row 3: Club */}
      <View style={styles.mobileMetaRow}>
        <Text style={[styles.mobileClubText, { color: colors.textSecondary }]} numberOfLines={1}>
          {[currentClub, ageGroup].filter(Boolean).join(' ')}
        </Text>
      </View>

      {/* Row 4: Position | Alter | Rating — tabellarisch mit Trennlinien */}
      <View style={[styles.mobileInfoBar, { borderTopColor: colors.border }]}>
        <View style={styles.mobileInfoCell}>
          <Text style={[styles.mobileInfoLabel, styles.mobileInfoLabelWrap, { color: colors.textSecondary }]}>POSITION</Text>
          <View style={[styles.mobilePositionWrap, isDesktop && { transform: [{ scale: 1.6 }] }]}>
            <Dropdown
              options={POSITION_OPTIONS}
              value={positions as string[]}
              onChange={(val) => onPositionsChange(val as Position[])}
              placeholder="Pos."
              multiSelect
              compact
            />
          </View>
        </View>
        <View style={[styles.mobileInfoDivider, { backgroundColor: colors.border }]} />
        <View style={styles.mobileInfoCell}>
          <Text style={[styles.mobileInfoLabel, styles.mobileInfoLabelWrap, { color: colors.textSecondary }]}>ALTER</Text>
          <View style={{ alignItems: 'center' }}>
            <Text style={[styles.mobileInfoValue, { color: colors.text, fontSize: isDesktop ? 36 : 24 }]}>
              {age !== null ? `${age} J.` : '-'}
            </Text>
            {birthDate ? (
              <Text style={{ fontSize: isDesktop ? 14 : 11, color: colors.textSecondary, marginTop: 2 }}>
                {birthDate}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={[styles.mobileInfoDivider, { backgroundColor: colors.border }]} />
        <View style={styles.mobileInfoCell}>
          <Text style={[styles.mobileInfoLabel, styles.mobileInfoLabelWrap, { color: colors.textSecondary }]}>POTENTIAL</Text>
          <RatingBar value={overallRating} onChange={onRatingChange} compact compactSize={isDesktop ? 52 : 36} />
        </View>
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
  // === Top row (shared) ===
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
  // === Mobile layout ===
  mobileNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mobileJerseyBadge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  mobileJerseyText: {
    fontSize: 13,
    fontWeight: '700',
  },
  playerNameMobile: {
    fontSize: 20,
    fontWeight: '700',
    flexShrink: 1,
  },
  mobileMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: -4,
  },
  mobileClubText: {
    fontSize: 13,
  },
  mobileInfoBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingTop: 6,
    marginTop: 4,
  },
  mobileInfoCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 16,
    paddingBottom: 2,
    paddingHorizontal: 6,
  },
  mobileInfoLabelWrap: {
    position: 'absolute',
    top: -4,
    left: 6,
  },
  mobileInfoLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  mobileInfoValue: {
    fontSize: 24,
    fontWeight: '700',
  },
  mobileInfoDivider: {
    width: 1,
    alignSelf: 'stretch',
  },
  mobilePositionWrap: {
    alignSelf: 'center',
    marginTop: 4,
  },
  tmLogo: {
    height: 22,
    width: 55,
  },
});
