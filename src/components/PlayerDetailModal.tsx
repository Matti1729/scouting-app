// PlayerDetailModal — Spieler-Detailansicht im Anstoss-3-Retro-Stil.
// Wird von der Suchmaschine und dem Sportstipendium-Board geteilt, damit das
// Spielerprofil überall identisch aussieht. Lädt die TM-Details (Einsätze,
// Transfers) selbst nach.
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  ActivityIndicator,
  Modal,
  Image,
  Linking,
  Platform,
  TextInput,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  StipendiumSearchPlayer,
  PlayerTmDetails,
  fetchPlayerTmDetails,
  loadPlayerNote,
  savePlayerNote,
} from '../services/stipendiumService';

// Nativer Datums-Picker des Browsers (input type="date") — nur im Web verfügbar
let createDomElement: ((type: string, props: any) => React.ReactElement) | null = null;
if (Platform.OS === 'web') {
  try {
    createDomElement = require('react-native').unstable_createElement;
  } catch {
    createDomElement = null;
  }
}

// Retro-Farbschema (Anstoss-3-Optik) — identisch zur Suchmaschine
const RETRO = {
  shadowDark: '#55524e',
  text: '#14141e',
  headerBg: '#2b3f96',
  yellow: '#f2c230',
};

const HARD_SHADOW = Platform.OS === 'web'
  ? ({ boxShadow: '2px 2px 3px rgba(20, 20, 45, 0.45)' } as any)
  : { shadowColor: '#14142d', shadowOffset: { width: 2, height: 2 }, shadowOpacity: 0.45, shadowRadius: 2, elevation: 3 };

const HARD_SHADOW_LG = Platform.OS === 'web'
  ? ({ boxShadow: '3px 4px 9px rgba(10, 10, 45, 0.5)' } as any)
  : { shadowColor: '#0a0a2d', shadowOffset: { width: 3, height: 4 }, shadowOpacity: 0.5, shadowRadius: 5, elevation: 4 };

// Namenszusätze, die zum Nachnamen gehören ("van", "de", ...)
const NAME_PARTICLES = new Set([
  'van', 'von', 'de', 'der', 'den', 'del', 'della', 'di', 'da', 'dos', 'das',
  'du', 'la', 'le', 'el', 'al', 'ten', 'ter', 'te', 'zu', 'zur', 'vom', 'zum',
  "'t", 'op', 'oude', 'st.',
]);

export function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length <= 1) return { first: '', last: full.trim() };
  for (let i = 1; i < parts.length - 1; i++) {
    if (NAME_PARTICLES.has(parts[i].toLowerCase())) {
      return { first: parts.slice(0, i).join(' '), last: parts.slice(i).join(' ') };
    }
  }
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

/** Saison-Kurzlabel aus TM-Saisonstartjahr: 2026 -> "26/27" */
function seasonLabel(startYear: number): string {
  return `${String(startYear).slice(-2)}/${String(startYear + 1).slice(-2)}`;
}

/** Saison, in der ein Datum "DD.MM.YYYY" liegt (minus 1 Tag, damit der 01.07. noch zur Vorsaison zählt) */
function seasonOfDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const m = dateStr.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!m) return null;
  const d = new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
  d.setDate(d.getDate() - 1);
  const startYear = d.getMonth() + 1 >= 7 ? d.getFullYear() : d.getFullYear() - 1;
  return seasonLabel(startYear);
}

/** ISO "YYYY-MM-DD" -> "DD.MM.YYYY" */
function formatContract(iso: string | null): string | null {
  if (!iso) return null;
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  return `${parts[2]}.${parts[1]}.${parts[0]}`;
}

function openProfile(url: string | null) {
  if (!url) return;
  if (Platform.OS === 'web') {
    window.open(url, '_blank');
  } else {
    Linking.openURL(url);
  }
}

export function PlayerDetailModal({
  player,
  onClose,
  actions,
}: {
  player: StipendiumSearchPlayer;
  onClose: () => void;
  actions?: React.ReactNode;
}) {
  const [tmDetails, setTmDetails] = useState<PlayerTmDetails | null>(null);
  const [tmLoading, setTmLoading] = useState(false);
  // Notizen + Erstkontakt (pro Spieler gespeichert)
  const [notes, setNotes] = useState('');
  const [firstContact, setFirstContact] = useState(''); // ISO "YYYY-MM-DD"
  const savedNote = useRef({ notes: '', firstContact: '' });

  useEffect(() => {
    setTmDetails(null);
    if (player.tm_player_id) {
      setTmLoading(true);
      fetchPlayerTmDetails(player.tm_player_id).then((d) => {
        setTmDetails(d);
        setTmLoading(false);
      });
    }
  }, [player.tm_player_id]);

  useEffect(() => {
    loadPlayerNote(player.id).then((n) => {
      setNotes(n.notes || '');
      setFirstContact(n.first_contact_date || '');
      savedNote.current = { notes: n.notes || '', firstContact: n.first_contact_date || '' };
    });
  }, [player.id]);

  // Speichern, sobald sich etwas geändert hat (Notizen bei Verlassen des Felds,
  // Datum direkt bei Auswahl)
  const persistNote = (nextNotes: string, nextContact: string) => {
    if (nextNotes === savedNote.current.notes && nextContact === savedNote.current.firstContact) return;
    savedNote.current = { notes: nextNotes, firstContact: nextContact };
    savePlayerNote(player.id, {
      notes: nextNotes.trim() || null,
      first_contact_date: nextContact || null,
    });
  };

  const p = player;
  const contract = formatContract(p.contract_until);
  const vereinslosTransfer = tmDetails?.transfers?.find(
    (t) => t.to && /vereinslos|ohne verein|career break/i.test(t.to)
  );
  const lastClubSeason = p.is_vereinslos ? seasonOfDate(vereinslosTransfer?.date || null) : null;

  const infoRow = (label: string, value: React.ReactNode) => (
    <View style={styles.detailRow}>
      <Text style={[styles.detailLabel, { color: RETRO.text }]}>{label}</Text>
      {typeof value === 'string' ? (
        <Text style={[styles.detailValue, { color: RETRO.text }]}>{value}</Text>
      ) : (
        value
      )}
    </View>
  );

  // Gelber Abschnittsbalken wie in der Anstoss-Spielerinfo
  const sectionBar = (title: string) => (
    <View style={[styles.detailSectionBar, HARD_SHADOW]}>
      <Text style={styles.detailSectionBarText}>{title}</Text>
    </View>
  );

  // Grüner Abschnittsbalken (eigene Scouting-Felder: Notizen, Erstkontakt)
  const sectionBarGreen = (title: string) => (
    <View style={[styles.detailSectionBar, styles.detailSectionBarGreen, HARD_SHADOW]}>
      <Text style={[styles.detailSectionBarText, { color: '#ffffff' }]}>{title}</Text>
    </View>
  );

  // Beim Schließen offene Änderungen sichern
  const handleClose = () => {
    persistNote(notes, firstContact);
    onClose();
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={handleClose}>
      <TouchableWithoutFeedback onPress={handleClose}>
        <View style={styles.detailOverlay}>
          <TouchableWithoutFeedback>
            <View style={[styles.detailModal, HARD_SHADOW_LG]}>
              {/* Namens-Balken (gelb): Name links, TM-Link rechtsbündig */}
              <View style={[styles.detailNameBar, HARD_SHADOW]}>
                <Text style={styles.detailName} numberOfLines={1}>
                  {(() => {
                    const n = splitName(p.player_name);
                    return n.first ? `${n.last}, ${n.first}` : n.last;
                  })()}
                </Text>
                {p.tm_profile_url && (
                  <TouchableOpacity onPress={() => openProfile(p.tm_profile_url)} hitSlop={8}>
                    <Image source={require('../../assets/tm-icon.png')} style={styles.tmIcon} />
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={handleClose} hitSlop={8}>
                  <Ionicons name="close" size={20} color={RETRO.text} />
                </TouchableOpacity>
              </View>
              <ScrollView style={styles.detailScroll} showsVerticalScrollIndicator={false}>
              <View style={{ height: 6 }} />
              {infoRow(
                'Alter',
                p.age !== null
                  ? `${p.age} Jahre${p.birth_date ? ` (${p.birth_date})` : ''}`
                  : p.birth_date || '—'
              )}
              {p.position ? infoRow('Position', p.position) : null}
              {infoRow(
                'Berater',
                p.current_agent_name && p.current_agent_name !== 'kein Beratereintrag'
                  ? p.current_agent_name
                  : 'kein Beratereintrag'
              )}

              {/* Aktueller Verein */}
              {sectionBar('Aktueller Verein')}
              {p.is_vereinslos ? (
                <>
                  {infoRow('Verein', 'vereinslos')}
                  {infoRow(
                    'Letzter Verein',
                    <View style={styles.detailClubValue}>
                      {p.club_tm_id && (
                        <Image
                          source={{ uri: `https://tmssl.akamaized.net/images/wappen/head/${p.club_tm_id}.png` }}
                          style={styles.detailClubLogo}
                          resizeMode="contain"
                        />
                      )}
                      <Text style={styles.detailClubText}>
                        {`${p.club_name || '?'}${lastClubSeason ? ` (${lastClubSeason})` : ''}`}
                      </Text>
                    </View>
                  )}
                </>
              ) : (
                infoRow(
                  'Verein',
                  <View style={styles.detailClubValue}>
                    {p.club_tm_id && (
                      <Image
                        source={{ uri: `https://tmssl.akamaized.net/images/wappen/head/${p.club_tm_id}.png` }}
                        style={styles.detailClubLogo}
                        resizeMode="contain"
                      />
                    )}
                    <Text style={styles.detailClubText}>{p.club_name || '—'}</Text>
                  </View>
                )
              )}
              {/* Vereinslos: keine Liga anzeigen (wäre nur die letzte Liga) */}
              {!p.is_vereinslos && infoRow('Liga', p.league_name || '—')}

              {/* Vertrag */}
              {sectionBar('Vertrag')}
              {infoRow('Vertrag bis', contract || '—')}
              {infoRow('Marktwert', p.market_value || '—')}

              {/* Spiele */}
              {sectionBar('Einsätze')}
              {infoRow(
                `Saison ${tmDetails ? seasonLabel(tmDetails.seasonYear) : 'aktuell'}`,
                tmLoading ? (
                  <ActivityIndicator size="small" color={RETRO.headerBg} />
                ) : (
                  `${tmDetails?.gamesCurrentSeason ?? '—'} Spiele`
                )
              )}
              {infoRow(
                `Saison ${tmDetails ? seasonLabel(tmDetails.seasonYear - 1) : 'letzte'}`,
                tmLoading ? ' ' : `${tmDetails?.gamesLastSeason ?? '—'} Spiele`
              )}

              {/* Erstkontakt */}
              {sectionBarGreen('Erstkontakt')}
              <View style={styles.detailRow}>
                <Text style={[styles.detailLabel, { color: RETRO.text }]}>Erstkontakt am</Text>
                <View style={styles.dateInputWrap}>
                  {createDomElement ? (
                    createDomElement('input', {
                      type: 'date',
                      value: firstContact,
                      onChange: (e: any) => {
                        const v = e.target.value || '';
                        setFirstContact(v);
                        persistNote(notes, v);
                      },
                      style: {
                        border: `1px solid ${RETRO.shadowDark}`,
                        background: 'rgba(255, 255, 255, 0.92)',
                        color: RETRO.text,
                        fontSize: 13,
                        fontWeight: 600,
                        padding: '5px 8px',
                        fontFamily: 'inherit',
                        outline: 'none',
                      },
                    })
                  ) : (
                    <TextInput
                      style={styles.dateInputNative}
                      placeholder="JJJJ-MM-TT"
                      placeholderTextColor={'#8a867e'}
                      value={firstContact}
                      onChangeText={setFirstContact}
                      onBlur={() => persistNote(notes, firstContact)}
                    />
                  )}
                </View>
              </View>

              {/* Notizen */}
              {sectionBarGreen('Notizen')}
              <TextInput
                style={styles.notesInput}
                placeholder="Notizen zum Spieler ..."
                placeholderTextColor={'#8a867e'}
                value={notes}
                onChangeText={setNotes}
                onBlur={() => persistNote(notes, firstContact)}
                multiline
              />

              {/* Aktionen (vom Aufrufer definiert, z.B. + Sportstipendium / + Watchlist) */}
              {actions ? <View style={styles.detailActions}>{actions}</View> : null}
              </ScrollView>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
    maxHeight: '92%',
    borderWidth: 1,
    borderColor: RETRO.shadowDark,
    borderRadius: 2,
    padding: 16,
    backgroundColor: 'rgba(238, 234, 226, 0.97)',
  },
  detailScroll: {
    flexGrow: 0,
  },
  detailNameBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: RETRO.yellow,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginRight: 40,
    marginBottom: 6,
    gap: 8,
  },
  detailName: {
    fontSize: 17,
    fontWeight: '700',
    color: RETRO.text,
    flex: 1,
  },
  tmIcon: {
    width: 22,
    height: 22,
    borderRadius: 4,
    marginRight: 4,
  },
  detailClubValue: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  detailClubLogo: {
    width: 20,
    height: 20,
  },
  detailClubText: {
    fontSize: 14,
    fontWeight: '600',
    color: RETRO.text,
    textAlign: 'right',
    flexShrink: 1,
  },
  detailSectionBar: {
    backgroundColor: RETRO.yellow,
    paddingVertical: 4,
    paddingHorizontal: 10,
    marginTop: 10,
    marginBottom: 8,
    marginRight: 120,
  },
  detailSectionBarText: {
    fontSize: 13,
    fontWeight: '700',
    color: RETRO.text,
  },
  // Grüne Variante für die eigenen Scouting-Felder
  detailSectionBarGreen: {
    backgroundColor: '#2f7d36',
  },
  dateInputWrap: {
    flex: 1,
    alignItems: 'flex-end',
  },
  dateInputNative: {
    borderWidth: 1,
    borderColor: RETRO.shadowDark,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    paddingHorizontal: 8,
    paddingVertical: 5,
    fontSize: 13,
    fontWeight: '600',
    color: RETRO.text,
    minWidth: 130,
    textAlign: 'right',
  },
  notesInput: {
    borderWidth: 1,
    borderColor: RETRO.shadowDark,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: RETRO.text,
    minHeight: 64,
    textAlignVertical: 'top',
    marginHorizontal: 4,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    gap: 10,
    paddingHorizontal: 4,
  },
  detailLabel: {
    width: 110,
    fontSize: 13,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
    textAlign: 'right',
  },
  detailActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
});
