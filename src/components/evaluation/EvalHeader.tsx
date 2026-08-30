import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, Image, Linking, StyleSheet, Platform } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { MONO, HARD_SHADOW, RETRO_CHIP, RETRO_CHIP_TEXT, RETRO } from '../../theme/retro';
import { Position } from '../../types';
import { Dropdown } from '../Dropdown';

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

/** ISO "YYYY-MM-DD" -> "DD.MM.YYYY" */
function formatIsoDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  return `${parts[2]}.${parts[1]}.${parts[0]}`;
}

/** Farbe wie im Potential-Schiebebalken (1-3 rot, 4-6 orange, 7-9 grün, 10 gold) */
function potentialColor(v: number): string {
  if (v <= 0) return '#9a968e';
  if (v === 10) return '#F0C040';
  if (v >= 7) return '#22c55e';
  if (v >= 4) return '#e8930c';
  return '#dc2626';
}

interface EvalHeaderProps {
  jerseyNumber: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  positions: Position[];
  onPositionsChange: (positions: Position[]) => void;
  overallRating: number;
  onRatingChange: (value: number) => void;
  transfermarktUrl?: string;
  clubLogoUrl?: string | null;
  /** Anzeigename des Vereins (z.B. "Borussia Dortmund U19") */
  clubName?: string;
  leagueName?: string | null;
  contractUntil?: string | null; // ISO "YYYY-MM-DD"
  marketValue?: string | null;
  agentName?: string | null;
  agentUrl?: string | null;
}

/**
 * Kopfbereich des Scoutingberichts als Karten-Raster wie im Spielerprofil:
 * ALLGEMEINES (Nummer/Name/TM · Alter · Position) · VEREIN · VERTRAG ·
 * POTENTIAL (vollflächig gefärbt, Zahl + Slider).
 */
export function EvalHeader({
  jerseyNumber,
  firstName,
  lastName,
  birthDate,
  positions,
  onPositionsChange,
  overallRating,
  onRatingChange,
  transfermarktUrl,
  clubLogoUrl,
  clubName,
  leagueName,
  contractUntil,
  marketValue,
  agentName,
  agentUrl,
}: EvalHeaderProps) {
  const { colors } = useTheme();
  // Anzeige als "Name, Vorname" (wie in der Aufstellung)
  const displayName = [lastName, firstName].filter(Boolean).join(', ') || 'Spieler';
  const age = useMemo(() => (birthDate ? calculateAge(birthDate) : null), [birthDate]);

  // "15 J. (11.03.11)" — Geburtsjahr zweistellig
  const birthShort = birthDate ? birthDate.replace(/\.(\d{2})(\d{2})$/, '.$2') : null;
  const alterDisplay =
    age !== null ? `${age} J.${birthShort ? ` (${birthShort})` : ''}` : birthShort || '—';

  const chip = (label: string) => (
    <View style={styles.chip}>
      <Text style={RETRO_CHIP_TEXT as any}>{label}</Text>
    </View>
  );

  const row = (label: string, value: React.ReactNode, last = false) => (
    <View style={[styles.cardRow, last && { borderBottomWidth: 0 }]}>
      <Text style={styles.cardRowLabel}>{label}</Text>
      {typeof value === 'string' ? (
        <Text style={styles.cardRowValue} numberOfLines={1}>{value}</Text>
      ) : (
        value
      )}
    </View>
  );

  return (
    <View style={styles.grid}>
      {/* ALLGEMEINES: Nummer + Name + TM · Alter · Position */}
      <View style={[styles.card, HARD_SHADOW]}>
        {chip('ALLGEMEINES')}
        <View style={styles.nameRow}>
          <View style={[styles.jerseyBadge, { borderColor: colors.inputBorder, backgroundColor: colors.surfaceSecondary }]}>
            <Text style={[styles.jerseyBadgeText, { color: RETRO.text }]}>{jerseyNumber || '?'}</Text>
          </View>
          <Text style={styles.nameText} numberOfLines={1}>{displayName}</Text>
          {transfermarktUrl ? (
            <TouchableOpacity onPress={() => openUrl(transfermarktUrl)} activeOpacity={0.7} hitSlop={6}>
              <Image source={require('../../../assets/tm-icon.png')} style={styles.tmIconSmall} />
            </TouchableOpacity>
          ) : null}
        </View>
        {row('Alter', alterDisplay)}
        {row(
          'Position',
          <Dropdown
            options={POSITION_OPTIONS}
            value={positions as string[]}
            onChange={(val) => onPositionsChange(val as Position[])}
            placeholder="Pos."
            multiSelect
            compact
          />,
          true
        )}
      </View>

      {/* VEREIN */}
      <View style={[styles.card, HARD_SHADOW]}>
        {chip('VEREIN')}
        {row(
          'Verein',
          <View style={styles.clubValue}>
            {clubLogoUrl ? <Image source={{ uri: clubLogoUrl }} style={styles.clubLogo} resizeMode="contain" /> : null}
            <Text style={styles.cardRowValue} numberOfLines={1}>{clubName || '—'}</Text>
          </View>
        )}
        {row('Liga', leagueName || '—', true)}
      </View>

      {/* VERTRAG */}
      <View style={[styles.card, HARD_SHADOW]}>
        {chip('VERTRAG')}
        {row('Vertrag bis', formatIsoDate(contractUntil) || '—')}
        {row('Marktwert', marketValue || '—')}
        {row(
          'Berater',
          agentName && agentName !== 'kein Beratereintrag' ? (
            <View style={styles.clubValue}>
              <Text style={styles.cardRowValue} numberOfLines={1}>{agentName}</Text>
              {agentUrl ? (
                <TouchableOpacity onPress={() => openUrl(agentUrl)} hitSlop={6}>
                  <Image source={require('../../../assets/tm-icon.png')} style={styles.tmIconSmall} />
                </TouchableOpacity>
              ) : null}
            </View>
          ) : (
            'kein Eintrag'
          ),
          true
        )}
      </View>

      {/* POTENTIAL: vollflächig in der Bewertungsfarbe, Zahl + Slider */}
      <View style={[styles.card, styles.cardPotential, HARD_SHADOW, { backgroundColor: potentialColor(overallRating) }]}>
        {chip('POTENTIAL')}
        {/* − Score + in einer Reihe, Zahl mittig wie im Spielerprofil */}
        <View style={styles.ratingRow}>
          <TouchableOpacity
            style={[styles.stepBtn, HARD_SHADOW]}
            onPress={() => onRatingChange(Math.max(1, overallRating - 1))}
            activeOpacity={0.7}
            hitSlop={4}
          >
            <Text style={styles.stepBtnText}>−</Text>
          </TouchableOpacity>
          <Text style={styles.potentialNumber}>{overallRating || '—'}</Text>
          <TouchableOpacity
            style={[styles.stepBtn, HARD_SHADOW]}
            onPress={() => onRatingChange(Math.min(10, overallRating + 1))}
            activeOpacity={0.7}
            hitSlop={4}
          >
            <Text style={styles.stepBtnText}>+</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    marginBottom: 6,
  },
  card: {
    flex: 1,
    minWidth: 260,
    backgroundColor: '#ffffff',
    borderRadius: 2,
    paddingHorizontal: 12,
    paddingTop: 16,
    paddingBottom: 6,
  },
  cardPotential: {
    flex: 0,
    minWidth: 150,
    maxWidth: 190,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 14,
    paddingHorizontal: 14,
  },
  chip: {
    ...(RETRO_CHIP as any),
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e1d8',
  },
  jerseyBadge: {
    width: 22,
    height: 22,
    borderRadius: 2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  jerseyBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  nameText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: RETRO.text,
  },
  tmIconSmall: {
    width: 20,
    height: 20,
    borderRadius: 2,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e1d8',
    minHeight: 34,
  },
  cardRowLabel: {
    fontSize: 13,
    color: RETRO.text,
  },
  cardRowValue: {
    fontSize: 13,
    fontWeight: '700',
    color: RETRO.text,
    flexShrink: 1,
  },
  clubValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  clubLogo: {
    width: 18,
    height: 18,
  },
  potentialNumber: {
    fontSize: 52,
    fontWeight: '800',
    color: '#ffffff',
    lineHeight: 60,
  },
  ratingRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    gap: 8,
  },
  // randlos + HARD_SHADOW wie alle Buttons, graue Retro-Fläche
  stepBtn: {
    width: 22,
    height: 22,
    borderRadius: 0,
    backgroundColor: '#e6e2da',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#14141e',
    lineHeight: 16,
  },
});
