import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Image, Linking, StyleSheet, Platform, ActivityIndicator, TextInput, Modal } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { MONO, HARD_SHADOW, HARD_SHADOW_LG, RETRO_CHIP, RETRO_CHIP_TEXT, RETRO } from '../../theme/retro';
import { Position } from '../../types';
import { Dropdown } from '../Dropdown';
import { Ionicons } from '@expo/vector-icons';
import { loadPlayerHistory, BeraterChange, MatchEvaluation } from '../../services/beraterService';
import { agentDisplayName, tmFlagUrl, flagForNationalTeam, PlayerNationalTeam, PlayerTmDetails, PlayerTmSeasonStats } from '../../services/stipendiumService';
import { supabase } from '../../config/supabase';

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

/** Saison-Kurzlabel aus TM-Saisonstartjahr: 2026 -> "26/27" */
function seasonLabel(startYear: number): string {
  return `${String(startYear).slice(-2)}/${String(startYear + 1).slice(-2)}`;
}

/** "3 Spiele | 4 Tore | 3 Vorlagen" (Fallback nur Spiele, wenn keine Detailstatistik da ist) */
function seasonStatsText(
  stats: PlayerTmSeasonStats | null | undefined,
  games: number | null | undefined
): string {
  if (!stats) return `${games ?? '—'} Spiele`;
  const spiele = `${stats.games} ${stats.games === 1 ? 'Spiel' : 'Spiele'}`;
  const tore = `${stats.goals} ${stats.goals === 1 ? 'Tor' : 'Tore'}`;
  const vorlagen = `${stats.assists} ${stats.assists === 1 ? 'Vorlage' : 'Vorlagen'}`;
  return `${spiele} | ${tore} | ${vorlagen}`;
}

/** ISO-Timestamp -> "28.08.2026" (für den Beraterverlauf) */
function formatDateDE(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

/** Dauer zwischen zwei ISO-Daten, z.B. "4 Monate" */
function formatDurationBetween(fromDate: string, toDate: string): string {
  const diffDays = Math.floor((new Date(toDate).getTime() - new Date(fromDate).getTime()) / 86400000);
  if (diffDays < 1) return '< 1 Tag';
  if (diffDays < 7) return `${diffDays} ${diffDays === 1 ? 'Tag' : 'Tage'}`;
  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return `${weeks} ${weeks === 1 ? 'Woche' : 'Wochen'}`;
  }
  if (diffDays < 365) {
    const months = Math.floor(diffDays / 30);
    return `${months} ${months === 1 ? 'Monat' : 'Monate'}`;
  }
  const years = Math.floor(diffDays / 365);
  return `${years} ${years === 1 ? 'Jahr' : 'Jahre'}`;
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
  /** Aktuelle Nationalmannschaft (aus den TM-Details), null = kein Nationalspieler */
  nationalTeam?: PlayerNationalTeam | null;
  /** berater_players.id — schaltet den aufklappbaren Beraterverlauf frei */
  beraterPlayerId?: string | null;
  /** TM-Details für die EINSÄTZE-Karte (Spiele/Tore/Vorlagen je Saison) */
  tmDetails?: PlayerTmDetails | null;
  tmLoading?: boolean;
  /** Alle Berichte zum Spieler (BERICHTE-Karte); Klick öffnet den Bericht */
  reports?: MatchEvaluation[];
  onOpenReport?: (ev: MatchEvaluation) => void;
  /** ID des gerade geöffneten Berichts (wird nicht erneut geöffnet) */
  currentReportId?: string | null;
  /** Name eintippbar (k.A.-Spieler ohne fussball.de-/TM-Eintrag) */
  nameEditable?: boolean;
  onNameChange?: (lastName: string, firstName: string) => void;
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
  nationalTeam,
  beraterPlayerId,
  tmDetails,
  tmLoading,
  reports,
  onOpenReport,
  currentReportId,
  nameEditable,
  onNameChange,
}: EvalHeaderProps) {
  const { colors } = useTheme();

  // Editierbarer Name für k.A.-Spieler — zwei Felder, weil manchmal nur der
  // Vorname bekannt ist (beim Spiel gehört); Platzhalter leer starten
  const isPlaceholderLast = /^k\.?\s?a\.?$/i.test((lastName || '').trim());
  const [lastDraft, setLastDraft] = useState(isPlaceholderLast ? '' : lastName || '');
  const [firstDraft, setFirstDraft] = useState(firstName || '');

  // Aufklappbarer Beraterverlauf (wie im Spielerprofil-Modal)
  const [verlaufOpen, setVerlaufOpen] = useState(false);
  const [verlaufLoading, setVerlaufLoading] = useState(false);
  const [verlauf, setVerlauf] = useState<BeraterChange[] | null>(null);
  const [verlaufUrls, setVerlaufUrls] = useState<Map<string, string>>(new Map());

  const toggleVerlauf = () => {
    if (!beraterPlayerId) return;
    const next = !verlaufOpen;
    setVerlaufOpen(next);
    if (next && verlauf === null && !verlaufLoading) {
      setVerlaufLoading(true);
      loadPlayerHistory(beraterPlayerId)
        .then(async (hist) => {
          setVerlauf(hist);
          // Agentur-URL über irgendeinen aktuellen Spieler derselben Agentur finden
          const keys = new Set<string>();
          for (const c of hist) {
            if (!agentDisplayName(c.previous_agent_name, c.previous_agent_company)) continue;
            const k = c.previous_agent_company || c.previous_agent_name;
            if (k) keys.add(k);
          }
          const urls = new Map<string, string>();
          await Promise.all(
            [...keys].map(async (k) => {
              let r = await supabase
                .from('berater_players')
                .select('agent_url')
                .eq('current_agent_company', k)
                .not('agent_url', 'is', null)
                .limit(1);
              if (!r.data?.length) {
                r = await supabase
                  .from('berater_players')
                  .select('agent_url')
                  .eq('current_agent_name', k)
                  .not('agent_url', 'is', null)
                  .limit(1);
              }
              const url = (r.data?.[0] as any)?.agent_url;
              if (url) urls.set(k, url);
            })
          );
          setVerlaufUrls(urls);
        })
        .finally(() => setVerlaufLoading(false));
    }
  };

  // "Familienangehörige" wird angezeigt, gilt farblich aber als beraterlos (grün)
  const beraterlos =
    !agentName ||
    agentName === 'kein Beratereintrag' ||
    agentName.toLowerCase().includes('familienangehörige');
  const beraterLabel = agentName || 'kein Beratereintrag';
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

  const reportList = reports || [];

  // Hinweis beim Klick auf den gerade geöffneten Bericht (statt Doppel-Öffnen)
  const [currentHint, setCurrentHint] = useState(false);
  const showCurrentHint = () => setCurrentHint(true);

  return (
    <View style={styles.wrap}>
    <View style={styles.grid}>
      {/* ALLGEMEINES: Nummer + Name + TM · Alter · Position */}
      <View style={[styles.card, HARD_SHADOW]}>
        {chip('ALLGEMEINES')}
        <View style={styles.nameRow}>
          <View style={[styles.jerseyBadge, { borderColor: colors.inputBorder, backgroundColor: colors.surfaceSecondary }]}>
            <Text style={[styles.jerseyBadgeText, { color: RETRO.text }]}>{jerseyNumber || '?'}</Text>
          </View>
          {nameEditable ? (
            <View style={styles.nameInputs}>
              <TextInput
                value={lastDraft}
                onChangeText={(t) => {
                  setLastDraft(t);
                  onNameChange?.(t.trim(), firstDraft.trim());
                }}
                placeholder="Nachname"
                placeholderTextColor="#8a867e"
                style={[styles.nameText, styles.nameInput, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null]}
              />
              <TextInput
                value={firstDraft}
                onChangeText={(t) => {
                  setFirstDraft(t);
                  onNameChange?.(lastDraft.trim(), t.trim());
                }}
                placeholder="Vorname"
                placeholderTextColor="#8a867e"
                style={[styles.nameText, styles.nameInput, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null]}
              />
            </View>
          ) : (
            <Text style={styles.nameText} numberOfLines={1}>{displayName}</Text>
          )}
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
        {row('Liga', leagueName || '—')}
        {/* Aktueller Nationalspieler: Mannschaft + Länderflagge */}
        {row(
          'Nationalspieler',
          nationalTeam ? (
            <View style={styles.clubValue}>
              {/* Emoji-Flagge (gleicher Typ wie im Land-Dropdown), sonst TM-PNG */}
              {flagForNationalTeam(nationalTeam.name) ? (
                <Text style={styles.natFlagEmoji}>{flagForNationalTeam(nationalTeam.name)}</Text>
              ) : nationalTeam.countryId ? (
                <Image source={{ uri: tmFlagUrl(nationalTeam.countryId) }} style={styles.natFlag} resizeMode="contain" />
              ) : null}
              <Text style={styles.cardRowValue} numberOfLines={1}>{nationalTeam.name}</Text>
            </View>
          ) : (
            '—'
          ),
          true
        )}
      </View>

      {/* VERTRAG (zIndex: Beraterverlauf-Dropdown liegt über dem Inhalt darunter) */}
      <View style={[styles.card, HARD_SHADOW, { zIndex: 30 }]}>
        {chip('VERTRAG')}
        {row('Vertrag bis', formatIsoDate(contractUntil) || '—')}
        {row('Marktwert', marketValue || '—')}
        {/* Berater-Zeile: Klick klappt den Beraterverlauf auf */}
        <View style={{ zIndex: 40 }}>
          {row(
            'Berater',
            <TouchableOpacity style={styles.clubValue} onPress={toggleVerlauf} activeOpacity={0.7} hitSlop={4}>
              <Text style={[styles.cardRowValue, beraterlos && { color: '#15803d' }]} numberOfLines={1}>
                {beraterLabel}
              </Text>
              {agentUrl && !beraterlos ? (
                <TouchableOpacity onPress={() => openUrl(agentUrl)} hitSlop={6}>
                  <Image source={require('../../../assets/tm-icon.png')} style={styles.tmIconSmall} />
                </TouchableOpacity>
              ) : null}
              {beraterPlayerId ? <Text style={styles.verlaufChevron}>{verlaufOpen ? '▾' : '▸'}</Text> : null}
            </TouchableOpacity>,
            true
          )}
          {verlaufOpen && (
            <View style={[styles.verlaufDropdown, HARD_SHADOW_LG]}>
              <View style={styles.verlaufHeader}>
                <Text style={styles.verlaufHeaderText}>BERATERVERLAUF</Text>
              </View>
              {verlaufLoading || verlauf === null ? (
                <ActivityIndicator size="small" color="#2b3f96" style={{ margin: 10 }} />
              ) : (
                <>
                  {/* Aktuelle Phase */}
                  <View style={[styles.verlaufRow, styles.verlaufRowCurrent]}>
                    <View style={styles.verlaufAgentRow}>
                      <Text style={[styles.verlaufAgent, beraterlos && { color: '#15803d' }]} numberOfLines={1}>
                        {beraterLabel}
                      </Text>
                      {agentUrl && !beraterlos ? (
                        <TouchableOpacity onPress={() => openUrl(agentUrl)} hitSlop={6}>
                          <Image source={require('../../../assets/tm-icon.png')} style={styles.verlaufTmIcon} />
                        </TouchableOpacity>
                      ) : null}
                    </View>
                    <Text style={styles.verlaufMeta}>
                      {verlauf[0] ? `seit ${formatDateDE(verlauf[0].detected_at)}` : 'aktuell'}
                    </Text>
                  </View>
                  {/* Frühere Phasen (neueste zuerst) */}
                  {verlauf.map((change, index) => {
                    const start = verlauf[index + 1]?.detected_at || null;
                    const agentKey = change.previous_agent_company || change.previous_agent_name;
                    const hasRealAgent = !!agentDisplayName(change.previous_agent_name, change.previous_agent_company);
                    const prevUrl = hasRealAgent && agentKey ? verlaufUrls.get(agentKey) : undefined;
                    return (
                      <View
                        key={change.id}
                        style={[styles.verlaufRow, index === verlauf.length - 1 && { borderBottomWidth: 0 }]}
                      >
                        <View style={styles.verlaufAgentRow}>
                          <Text style={styles.verlaufAgent} numberOfLines={1}>
                            {agentDisplayName(change.previous_agent_name, change.previous_agent_company) || 'kein Beratereintrag'}
                          </Text>
                          {prevUrl ? (
                            <TouchableOpacity onPress={() => openUrl(prevUrl)} hitSlop={6}>
                              <Image source={require('../../../assets/tm-icon.png')} style={styles.verlaufTmIcon} />
                            </TouchableOpacity>
                          ) : null}
                        </View>
                        <Text style={styles.verlaufMeta}>
                          {start
                            ? `${formatDateDE(start)} - ${formatDateDE(change.detected_at)} · ${formatDurationBetween(start, change.detected_at)}`
                            : `bis ${formatDateDE(change.detected_at)}`}
                        </Text>
                      </View>
                    );
                  })}
                  {verlauf.length === 0 && (
                    <Text style={[styles.verlaufMeta, { padding: 10 }]}>Keine Wechsel erfasst</Text>
                  )}
                </>
              )}
            </View>
          )}
        </View>
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

    {/* Zeile 2: Einsätze + Berichte (wie im Spielerprofil) */}
    <View style={styles.gridLower}>
      <View style={[styles.card, styles.cardEinsaetze, HARD_SHADOW]}>
        {chip('EINSÄTZE')}
        {row(
          `Saison ${tmDetails ? seasonLabel(tmDetails.seasonYear) : 'aktuell'}`,
          tmLoading ? (
            <ActivityIndicator size="small" color="#2b3f96" />
          ) : (
            seasonStatsText(tmDetails?.statsCurrentSeason, tmDetails?.gamesCurrentSeason)
          )
        )}
        {row(
          `Saison ${tmDetails ? seasonLabel(tmDetails.seasonYear - 1) : 'letzte'}`,
          tmLoading ? ' ' : seasonStatsText(tmDetails?.statsLastSeason, tmDetails?.gamesLastSeason),
          true
        )}
      </View>
      <View style={[styles.card, styles.cardBerichte, HARD_SHADOW]}>
        {chip(`BERICHTE${reportList.length > 0 ? ` (${reportList.length})` : ''}`)}
        {reportList.length === 0 ? (
          <Text style={styles.reportEmpty}>Noch keine Berichte</Text>
        ) : (
          reportList.map((ev, idx) => {
            const isCurrent = !!currentReportId && ev.id === currentReportId;
            return (
              <TouchableOpacity
                key={ev.id}
                style={[styles.reportRow, idx === reportList.length - 1 && { borderBottomWidth: 0 }]}
                disabled={!onOpenReport}
                onPress={() => (isCurrent ? showCurrentHint() : onOpenReport?.(ev))}
                activeOpacity={0.7}
              >
                <Text style={styles.reportDate} numberOfLines={1}>{ev.match_date || '—'}</Text>
                <Text style={styles.reportMatch} numberOfLines={1}>
                  {[ev.match_name, ev.age_group, ev.match_type].filter(Boolean).join(' · ') || 'Spiel unbekannt'}
                </Text>
                {ev.overall_rating ? (
                  <View style={[styles.reportRatingBadge, { backgroundColor: potentialColor(ev.overall_rating) }]}>
                    <Text style={styles.reportRatingText}>{ev.overall_rating}</Text>
                  </View>
                ) : null}
                {!isCurrent && onOpenReport ? (
                  <Ionicons name="chevron-forward" size={14} color="#55524e" />
                ) : null}
              </TouchableOpacity>
            );
          })
        )}
      </View>
    </View>

    {/* Hinweis-Modal: Klick auf den gerade geöffneten Bericht */}
    {currentHint && (
      <Modal visible transparent animationType="fade" onRequestClose={() => setCurrentHint(false)}>
        <View style={styles.confirmOverlay}>
          <View style={[styles.confirmBox, HARD_SHADOW_LG]}>
            <View style={[styles.confirmBar, HARD_SHADOW]}>
              <Text style={styles.confirmTitle}>Hinweis</Text>
            </View>
            <Text style={styles.confirmText}>Du bist bereits in diesem Bericht.</Text>
            <View style={styles.confirmActions}>
              <TouchableOpacity
                style={[styles.confirmBtn, HARD_SHADOW]}
                onPress={() => setCurrentHint(false)}
                activeOpacity={0.7}
              >
                <Text style={styles.confirmBtnText}>Ok</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    // Beraterverlauf-Dropdown muss über den Inhalt darunter ragen
    zIndex: 30,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    marginBottom: 6,
    zIndex: 30,
  },
  gridLower: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    marginTop: 10,
    marginBottom: 6,
    zIndex: 1,
  },
  cardEinsaetze: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
  },
  cardBerichte: {
    flexGrow: 1.6,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 320,
  },
  reportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#c6c2ba',
  },
  reportDate: {
    fontSize: 11,
    fontWeight: '600',
    color: '#4a4a55',
    minWidth: 78,
  },
  reportMatch: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: RETRO.text,
  },
  reportRatingBadge: {
    minWidth: 24,
    height: 20,
    paddingHorizontal: 4,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reportRatingText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#ffffff',
  },
  reportEmpty: {
    fontSize: 13,
    color: '#8a867e',
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  // Retro-Hinweis-Dialog (wie die Nachfrage-Dialoge im Spielerprofil)
  confirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  confirmBox: {
    backgroundColor: '#e9e5dd',
    borderRadius: 2,
    width: 380,
    maxWidth: '92%',
    paddingBottom: 14,
  },
  confirmBar: {
    backgroundColor: RETRO.yellow,
    paddingVertical: 9,
    paddingHorizontal: 14,
    margin: 10,
    marginBottom: 4,
  },
  confirmTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: RETRO.text,
  },
  confirmText: {
    fontSize: 14,
    color: RETRO.text,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  confirmActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    paddingHorizontal: 14,
  },
  confirmBtn: {
    backgroundColor: '#ffffff',
    borderRadius: 0,
    paddingHorizontal: 10,
    paddingVertical: 5,
    minHeight: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: RETRO.text,
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
  nameInputs: {
    flex: 1,
    flexDirection: 'row',
    gap: 8,
  },
  nameInput: {
    minWidth: 0,
    paddingVertical: 0,
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
  // Länderflagge (breiter als hoch, wie TM sie liefert)
  natFlag: {
    width: 20,
    height: 13,
  },
  natFlagEmoji: {
    fontSize: 14,
  },
  // Aufklappbarer Beraterverlauf (Dropdown unter der Berater-Zeile, wie im Spielerprofil)
  verlaufChevron: {
    fontSize: 14,
    color: '#4a4a55',
    marginLeft: 4,
  },
  verlaufDropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    backgroundColor: '#ffffff',
    borderRadius: 2,
    zIndex: 100,
  },
  verlaufHeader: {
    backgroundColor: '#14141e',
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  verlaufHeaderText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    fontFamily: MONO,
    color: RETRO.yellow,
  },
  verlaufRow: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e1d8',
    gap: 2,
  },
  verlaufRowCurrent: {
    backgroundColor: '#f7f0da',
  },
  verlaufAgentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  verlaufAgent: {
    fontSize: 13,
    fontWeight: '700',
    color: RETRO.text,
    flexShrink: 1,
  },
  verlaufTmIcon: {
    width: 16,
    height: 16,
    borderRadius: 2,
  },
  verlaufMeta: {
    fontSize: 10,
    fontFamily: MONO,
    color: '#4a4a55',
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
