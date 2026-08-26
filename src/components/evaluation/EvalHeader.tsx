import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, Image, Linking, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { MONO, HARD_SHADOW } from '../../theme/retro';
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
  clubLogoUrl?: string | null;
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
  clubLogoUrl,
}: EvalHeaderProps) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 768;
  // Anzeige als "Name, Vorname" (wie in der Aufstellung)
  const displayName = [lastName, firstName].filter(Boolean).join(', ') || 'Spieler';
  const age = useMemo(() => birthDate ? calculateAge(birthDate) : null, [birthDate]);

  const birthYear = birthDate ? birthDate.split('.')[2]?.slice(-2) : null;

  const alterDisplay = birthDate && age !== null
    ? `${birthDate} · ${age} J.`
    : (birthDate || (age !== null ? `${age} J.` : '-'));

  if (isDesktop) {
    // Zwei Zeilen: 1. Name · TM · Position · Verein — 2. Alter · Berater · Potential
    return (
      <View style={[styles.container, HARD_SHADOW, { backgroundColor: colors.surface }]}>
        <View style={styles.deskRow}>
          <View style={[styles.mobileNameRow, styles.deskCellEven]}>
            <View style={[styles.jerseyBadge, { borderColor: colors.inputBorder, backgroundColor: colors.surfaceSecondary }]}>
              <Text style={[styles.jerseyBadgeText, { color: colors.text }]}>
                {jerseyNumber || '?'}
              </Text>
            </View>
            <Text style={[styles.deskValue, { color: colors.text }]} numberOfLines={1}>
              {displayName}
            </Text>
          </View>
          {transfermarktUrl ? (
            <>
              <View style={[styles.deskDivider, { backgroundColor: colors.border }]} />
              <TouchableOpacity onPress={() => openUrl(transfermarktUrl)} activeOpacity={0.7} hitSlop={6}>
                <Image
                  source={require('../../../assets/transfermarkt-icon.jpg')}
                  style={styles.tmLogoInline}
                  resizeMode="cover"
                />
              </TouchableOpacity>
            </>
          ) : null}
          <View style={[styles.deskDivider, { backgroundColor: colors.border }]} />
          <View style={[styles.deskCell, styles.deskCellEven]}>
            <Text style={[styles.deskLabel, { color: colors.textSecondary }]}>POSITION</Text>
            <Dropdown
              options={POSITION_OPTIONS}
              value={positions as string[]}
              onChange={(val) => onPositionsChange(val as Position[])}
              placeholder="Pos."
              multiSelect
              compact
            />
          </View>
          <View style={[styles.deskDivider, { backgroundColor: colors.border }]} />
          <View style={[styles.deskCell, styles.deskCellEven, styles.clubRow]}>
            {clubLogoUrl ? (
              <Image source={{ uri: clubLogoUrl }} style={styles.clubLogo} resizeMode="contain" />
            ) : null}
            <Text style={[styles.deskValue, { color: colors.text }]} numberOfLines={1}>
              {[currentClub, ageGroup].filter(Boolean).join(' ')}
            </Text>
          </View>
        </View>
        <View style={[styles.deskRow, styles.deskRow2, { borderTopColor: colors.inputBorder }]}>
          <View style={[styles.deskCell, styles.deskCellEven]}>
            <Text style={[styles.deskLabel, { color: colors.textSecondary }]}>ALTER</Text>
            <Text style={[styles.deskValue, { color: colors.text }]} numberOfLines={1}>
              {alterDisplay}
            </Text>
          </View>
          <View style={[styles.deskDivider, { backgroundColor: colors.border }]} />
          <View style={[styles.deskCell, styles.deskCellEven]}>
            <Text style={[styles.deskLabel, { color: colors.textSecondary }]}>BERATER</Text>
            <Text style={[styles.deskValue, { color: colors.text }]} numberOfLines={1}>
              {agentName || '-'}
            </Text>
          </View>
          <View style={[styles.deskDivider, { backgroundColor: colors.border }]} />
          <View style={[styles.deskCell, styles.deskCellEven]}>
            <Text style={[styles.deskLabel, { color: colors.textSecondary }]}>POTENTIAL</Text>
            <RatingBar value={overallRating} onChange={onRatingChange} plain />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, HARD_SHADOW, { backgroundColor: colors.surface }]}>
      {/* Row 2: Nummer + Name + TM-Icon (Match-Info steht in der gelben Titelleiste) */}
      <View style={styles.mobileNameRow}>
        <View style={[styles.jerseyBadge, { borderColor: colors.inputBorder, backgroundColor: colors.surfaceSecondary }]}>
          <Text style={[styles.jerseyBadgeText, { color: colors.text }]}>
            {jerseyNumber || '?'}
          </Text>
        </View>
        <Text style={[styles.deskValue, { color: colors.text }]} numberOfLines={1}>
          {displayName}
        </Text>
        {transfermarktUrl ? (
          <TouchableOpacity onPress={() => openUrl(transfermarktUrl)} activeOpacity={0.7} hitSlop={6}>
            <Image
              source={require('../../../assets/transfermarkt-icon.jpg')}
              style={styles.tmLogoInline}
              resizeMode="cover"
            />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Row 3: Club (mit Wappen) + Berater */}
      <View style={[styles.mobileMetaRow, styles.clubRow]}>
        {clubLogoUrl ? (
          <Image source={{ uri: clubLogoUrl }} style={styles.clubLogo} resizeMode="contain" />
        ) : null}
        <Text style={[styles.mobileClubText, { color: colors.textSecondary }]} numberOfLines={1}>
          {[currentClub, ageGroup].filter(Boolean).join(' ')}
        </Text>
      </View>
      {agentName ? (
        <Text style={[styles.mobileClubText, { color: colors.textSecondary }]} numberOfLines={1}>
          Berater: {agentName}
        </Text>
      ) : null}

      {/* Row 4: Position | Alter | Rating — tabellarisch mit Trennlinien */}
      <View style={[styles.mobileInfoBar, { borderTopColor: colors.border }]}>
        <View style={styles.mobileInfoCell}>
          <Text style={[styles.mobileInfoLabel, styles.mobileInfoLabelWrap, { color: colors.textSecondary }]}>POSITION</Text>
          <View style={styles.mobilePositionWrap}>
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
            <Text style={[styles.mobileInfoValue, { color: colors.text }]}>
              {age !== null ? `${age} J.` : '-'}
            </Text>
            {birthDate ? (
              <Text style={{ fontSize: 11, color: colors.textSecondary, marginTop: 2 }}>
                {birthDate}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={[styles.mobileInfoDivider, { backgroundColor: colors.border }]} />
        <View style={styles.mobileInfoCell}>
          <Text style={[styles.mobileInfoLabel, styles.mobileInfoLabelWrap, { color: colors.textSecondary }]}>POTENTIAL</Text>
          <RatingBar value={overallRating} onChange={onRatingChange} compact compactSize={36} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 2, // Anstoss-Optik: eckig, randlos mit Schatten
    padding: 16,
    gap: 10,
  },
  // === Desktop: einzeilige Kopfleiste ===
  deskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  deskNameBlock: {
    minWidth: 200,
    maxWidth: 320,
    gap: 2,
  },
  deskRow2: {
    borderTopWidth: 1,
    // Container-Padding = 16, Container-gap = 10: 10 + 6 = 16 über der Linie, 16 darunter
    marginTop: 6,
    paddingTop: 16,
  },
  deskDivider: {
    width: 1,
    alignSelf: 'stretch',
  },
  deskCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  deskCellGrow: {
    flex: 1,
    minWidth: 160,
  },
  deskCellEven: {
    flex: 1,
    minWidth: 0,
  },
  deskLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 2,
    fontFamily: MONO,
    lineHeight: 18,
  },
  deskValue: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
  },
  clubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  clubLogo: {
    width: 18,
    height: 18,
  },
  tmLogoInline: {
    height: 18,
    width: 18,
    borderRadius: 2,
    marginLeft: 2,
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
  // Rückennummer exakt wie in der Aufstellung (PlayerRow)
  jerseyBadge: {
    width: 22,
    height: 22,
    borderRadius: 2,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  jerseyBadgeText: {
    fontSize: 11,
    fontWeight: '600',
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
});
