import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Linking,
  Platform,
  useWindowDimensions,
  RefreshControl,
  Animated,
  PanResponder,
  Modal,
  Image,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import {
  StipendiumEntry,
  StipendiumStatus,
  StipendiumSearchPlayer,
  PlayerClubInfo,
  loadStipendiumEntries,
  updateStipendiumStatus,
  updateStipendiumNotes,
  removeStipendiumEntry,
  fetchSearchPlayer,
  fetchPlayersClubInfo,
} from '../../services/stipendiumService';
import { PlayerDetailModal, splitName } from '../../components/PlayerDetailModal';

/** Anzeige "Nachname, Vorname" (Namenszusätze wie "van" gehören zum Nachnamen) */
function displayName(full: string): string {
  const n = splitName(full);
  return n.first ? `${n.last}, ${n.first}` : n.last;
}

// Retro-Farbschema (Anstoss-3-Optik) — identisch zur Suchmaschine
const RETRO = {
  page: '#e9e5dd',
  titleBar: 'rgba(210, 206, 198, 0.92)',
  panel: 'rgba(228, 224, 216, 0.68)',
  face: 'rgba(230, 226, 218, 0.80)',
  shadow: '#8a867e',
  shadowDark: '#55524e',
  text: '#14141e',
  textMuted: '#4a4a55',
  headerBg: '#2b3f96',
  headerText: '#ffffff',
  yellow: '#f2c230',
  rowBorder: '#c6c2ba',
  white: '#ffffff',
};

// Weicher Versatz-Schatten ("verwischt", wie im Original)
const HARD_SHADOW = Platform.OS === 'web'
  ? ({ boxShadow: '2px 2px 3px rgba(20, 20, 45, 0.45)' } as any)
  : { shadowColor: '#14142d', shadowOffset: { width: 2, height: 2 }, shadowOpacity: 0.45, shadowRadius: 2, elevation: 3 };

const HARD_SHADOW_LG = Platform.OS === 'web'
  ? ({ boxShadow: '3px 4px 9px rgba(10, 10, 45, 0.5)' } as any)
  : { shadowColor: '#0a0a2d', shadowOffset: { width: 3, height: 4 }, shadowOpacity: 0.5, shadowRadius: 5, elevation: 4 };

// Royalblauer Balken-Verlauf (wie die Abschnittsbalken der Suchmaschine)
const BLUE_GRADIENT = Platform.OS === 'web'
  ? ({ backgroundImage: 'linear-gradient(180deg, #4058b6 0%, #2b3f96 55%, #223077 100%)' } as any)
  : {};

const COLUMNS: { key: StipendiumStatus; title: string; icon: string }[] = [
  { key: 'interessant', title: 'Interessante Spieler', icon: '⭐' },
  { key: 'kontaktiert', title: 'Kontaktiert', icon: '💬' },
  { key: 'go', title: 'Go-Kandidaten', icon: '✅' },
];

const ARCHIVE: StipendiumStatus = 'archiviert';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ============================================================================
// Draggable Karte: per PanResponder zwischen Spalten ziehbar
// ============================================================================

function DraggableCard({
  children,
  onDragMove,
  onDragEnd,
}: {
  children: React.ReactNode;
  onDragMove: (pageX: number, pageY: number) => void;
  onDragEnd: (pageX: number, pageY: number) => void;
}) {
  const pan = useRef(new Animated.ValueXY()).current;
  const [dragging, setDragging] = useState(false);

  const panResponder = useRef(
    PanResponder.create({
      // Erst ab kleiner Bewegung übernehmen, damit Klicks (TM-Link, Löschen) funktionieren
      onMoveShouldSetPanResponder: (_evt, g) => Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6,
      onPanResponderGrant: () => setDragging(true),
      onPanResponderMove: (evt, g) => {
        pan.setValue({ x: g.dx, y: g.dy });
        onDragMove(evt.nativeEvent.pageX, evt.nativeEvent.pageY);
      },
      onPanResponderRelease: (evt, _g) => {
        setDragging(false);
        pan.setValue({ x: 0, y: 0 });
        onDragEnd(evt.nativeEvent.pageX, evt.nativeEvent.pageY);
      },
      onPanResponderTerminate: () => {
        setDragging(false);
        pan.setValue({ x: 0, y: 0 });
        onDragEnd(-1, -1);
      },
    })
  ).current;

  return (
    <Animated.View
      {...panResponder.panHandlers}
      style={[
        { transform: pan.getTranslateTransform() },
        dragging && styles.cardDragging,
        Platform.OS === 'web' ? ({ cursor: 'grab', userSelect: 'none' } as any) : null,
      ]}
    >
      {children}
    </Animated.View>
  );
}

export function SportstipendiumScreen() {
  const navigation = useNavigation();
  const { width } = useWindowDimensions();
  const isWide = width > 900;

  const [entries, setEntries] = useState<StipendiumEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hoveredColumn, setHoveredColumn] = useState<StipendiumStatus | null>(null);
  const [showArchive, setShowArchive] = useState(false);
  // Spielerprofil-Modal (identisch zur Suchmaschine)
  const [detailPlayer, setDetailPlayer] = useState<StipendiumSearchPlayer | null>(null);
  // Aktuelle Vereinsinfo (Wappen, vereinslos) pro TM-Spieler-ID
  const [clubInfo, setClubInfo] = useState<Record<string, PlayerClubInfo>>({});
  // Bestätigungs-Dialoge: Löschen bzw. Archivieren (mit Grund)
  const [confirmDelete, setConfirmDelete] = useState<StipendiumEntry | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<StipendiumEntry | null>(null);
  const [archiveReason, setArchiveReason] = useState('');

  // Spalten- und Archiv-Rechtecke für Drop-Erkennung (Fensterkoordinaten)
  const columnRefs = useRef<Partial<Record<StipendiumStatus, View | null>>>({});
  const columnRects = useRef<Partial<Record<StipendiumStatus, Rect>>>({});

  const measureColumns = () => {
    for (const key of [...COLUMNS.map((c) => c.key), ARCHIVE]) {
      columnRefs.current[key]?.measureInWindow((x, y, w, h) => {
        columnRects.current[key] = { x, y, width: w, height: h };
      });
    }
  };

  const columnAt = (pageX: number, pageY: number): StipendiumStatus | null => {
    for (const key of [...COLUMNS.map((c) => c.key), ARCHIVE]) {
      const r = columnRects.current[key];
      if (r && pageX >= r.x && pageX <= r.x + r.width && pageY >= r.y && pageY <= r.y + r.height) {
        return key;
      }
    }
    return null;
  };

  const loadData = async () => {
    const result = await loadStipendiumEntries();
    setEntries(result);
    setLoading(false);
    setRefreshing(false);
    // Vereinsinfo (Wappen + vereinslos-Status) live nachladen
    const tmIds = result.map((e) => e.tm_player_id).filter(Boolean) as string[];
    if (tmIds.length > 0) {
      setClubInfo(await fetchPlayersClubInfo(tmIds));
    }
  };

  // Bei jedem Fokus neu laden (z.B. nach Hinzufügen in der Suchmaschine)
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  const handleMove = async (entry: StipendiumEntry, status: StipendiumStatus) => {
    if (entry.status === status) return;
    // Optimistisch verschieben, bei Fehler zurückrollen
    const prevStatus = entry.status;
    setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, status } : e)));
    const success = await updateStipendiumStatus(entry.id, status);
    if (!success) {
      setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, status: prevStatus } : e)));
    }
  };

  const handleRemove = async (entry: StipendiumEntry) => {
    const success = await removeStipendiumEntry(entry.id);
    if (success) {
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
    }
  };

  // Archivieren nach Bestätigung: Status + Grund (in notes) speichern
  const confirmArchive = async () => {
    const entry = archiveTarget;
    if (!entry) return;
    const reason = archiveReason.trim();
    setArchiveTarget(null);
    setArchiveReason('');
    await handleMove(entry, ARCHIVE);
    if (reason) {
      await updateStipendiumNotes(entry.id, reason);
      setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, notes: reason } : e)));
    }
  };

  // Karte angeklickt: Spieler aus der Datenbank laden und das Profil-Modal öffnen
  const openPlayerDetail = async (entry: StipendiumEntry) => {
    const player = await fetchSearchPlayer(entry.tm_player_id, entry.player_name);
    if (player) {
      setDetailPlayer(player);
    } else if (entry.tm_profile_url) {
      // Fallback: Spieler nicht (mehr) in der Datenbank -> TM-Profil öffnen
      openProfile(entry.tm_profile_url);
    }
  };

  const openProfile = (url: string | null) => {
    if (!url) return;
    if (Platform.OS === 'web') {
      window.open(url, '_blank');
    } else {
      Linking.openURL(url);
    }
  };

  // Akzentfarben (auf Papier-Hintergrund gut lesbar) — für Hover + Zähler
  const columnColor = (key: StipendiumStatus) =>
    key === 'interessant'
      ? RETRO.headerBg
      : key === 'kontaktiert'
      ? '#b07708'
      : key === 'go'
      ? '#1c7a2e'
      : RETRO.textMuted;

  const archivedEntries = entries.filter((e) => e.status === ARCHIVE);

  const onCardDragMove = (pageX: number, pageY: number) => {
    setHoveredColumn(columnAt(pageX, pageY));
  };

  const onCardDragEnd = (entry: StipendiumEntry) => (pageX: number, pageY: number) => {
    setHoveredColumn(null);
    if (pageX < 0) return; // abgebrochen
    const target = columnAt(pageX, pageY);
    if (target && target !== entry.status) {
      // Archivieren immer mit Nachfrage + Grund
      if (target === ARCHIVE) {
        setArchiveReason('');
        setArchiveTarget(entry);
      } else {
        handleMove(entry, target);
      }
    }
  };

  // Vereinszeile der Karte: Wappen + Verein, bzw. vereinslos mit letztem Verein
  const renderClubLine = (entry: StipendiumEntry) => {
    const info = entry.tm_player_id ? clubInfo[entry.tm_player_id] : undefined;
    if (info) {
      if (info.is_vereinslos) {
        return (
          <View style={styles.cardClubRow}>
            <Text style={styles.cardClubMuted} numberOfLines={1}>
              vereinslos{info.club_name ? ` (letzter Verein: ${info.club_name})` : ''}
            </Text>
          </View>
        );
      }
      return (
        <View style={styles.cardClubRow}>
          {info.club_tm_id && (
            <Image
              source={{ uri: `https://tmssl.akamaized.net/images/wappen/head/${info.club_tm_id}.png` }}
              style={styles.cardClubLogo}
              resizeMode="contain"
            />
          )}
          <Text style={styles.cardClub} numberOfLines={1}>{info.club_name || '—'}</Text>
        </View>
      );
    }
    // Fallback: gespeicherter Vereinsname (enthält bei Vereinslosen "vereinslos (zuletzt ...)")
    return entry.club_name ? (
      <View style={styles.cardClubRow}>
        <Text style={styles.cardClubMuted} numberOfLines={1}>{entry.club_name}</Text>
      </View>
    ) : null;
  };

  const renderCard = (entry: StipendiumEntry) => {
    return (
      <DraggableCard
        key={entry.id}
        onDragMove={onCardDragMove}
        onDragEnd={onCardDragEnd(entry)}
      >
        <TouchableOpacity style={[styles.card, HARD_SHADOW]} activeOpacity={0.7} onPress={() => openPlayerDetail(entry)}>
          <View style={styles.cardNameRow}>
            <Text style={styles.cardName} numberOfLines={1}>
              {displayName(entry.player_name)}
            </Text>
            {entry.tm_profile_url && (
              <TouchableOpacity onPress={() => openProfile(entry.tm_profile_url)} hitSlop={8}>
                <Ionicons name="open-outline" size={14} color={RETRO.textMuted} />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.removeButton}
              onPress={() => { setArchiveReason(''); setArchiveTarget(entry); }}
              hitSlop={4}
            >
              <Ionicons name="archive-outline" size={13} color={RETRO.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.removeButton}
              onPress={() => setConfirmDelete(entry)}
              hitSlop={4}
            >
              <Ionicons name="trash-outline" size={13} color="#b02020" />
            </TouchableOpacity>
          </View>
          {renderClubLine(entry)}
        </TouchableOpacity>
      </DraggableCard>
    );
  };

  const renderColumn = (col: { key: StipendiumStatus; title: string; icon: string }) => {
    const colEntries = entries.filter((e) => e.status === col.key);
    const hovered = hoveredColumn === col.key;
    return (
      <View
        key={col.key}
        ref={(r) => {
          columnRefs.current[col.key] = r;
        }}
        onLayout={measureColumns}
        style={[
          styles.column,
          isWide ? styles.columnWide : styles.columnNarrow,
          hovered && { borderColor: columnColor(col.key), borderWidth: 2 },
        ]}
      >
        {/* Royalblauer Spaltenbalken (wie die Abschnittsbalken der Suchmaschine) */}
        {/* Gleicher Schatten wie die Karten, damit beide optisch gleich breit enden */}
        <View style={[styles.columnHeaderBar, HARD_SHADOW, BLUE_GRADIENT]}>
          <Text style={styles.columnTitle}>{col.title}</Text>
          <Text style={styles.columnCount}>{colEntries.length}</Text>
        </View>
        {colEntries.length === 0 ? (
          <Text style={styles.columnEmpty}>
            {col.key === 'interessant'
              ? 'Füge Spieler über die Suchmaschine hinzu.'
              : 'Spieler hierher ziehen.'}
          </Text>
        ) : (
          colEntries.map(renderCard)
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Verwaschenes Hintergrundfoto (schimmert durch die Flächen) */}
      <Image
        source={require('../../../assets/retro-bg.jpg')}
        style={styles.bgImage as any}
        resizeMode="cover"
      />
      {/* Header (Fenster-Titelleiste) */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backArrow}>{'←'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Sportstipendium</Text>
        {/* Archiv: Drop-Ziel beim Ziehen + Klick öffnet die Archiv-Ansicht */}
        <View
          ref={(r) => {
            columnRefs.current[ARCHIVE] = r as any;
          }}
          onLayout={measureColumns}
        >
          <TouchableOpacity
            style={[
              styles.archiveButton,
              HARD_SHADOW,
              hoveredColumn === ARCHIVE && {
                borderColor: RETRO.headerBg,
                borderWidth: 2,
              },
            ]}
            onPress={() => setShowArchive(true)}
          >
            <Text style={styles.archiveIcon}>🗄️</Text>
            <Text style={styles.archiveLabel}>Archiv</Text>
            <Text style={styles.archiveCount}>{archivedEntries.length}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={RETRO.headerBg} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          onScroll={measureColumns}
          scrollEventThrottle={100}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                loadData();
              }}
              tintColor={RETRO.headerBg}
            />
          }
        >
          <View style={[styles.board, isWide && styles.boardWide]}>
            {COLUMNS.map(renderColumn)}
          </View>
        </ScrollView>
      )}

      {/* Spielerprofil (geteilte Komponente, identisch zur Suchmaschine) */}
      {detailPlayer && (
        <PlayerDetailModal player={detailPlayer} onClose={() => setDetailPlayer(null)} />
      )}

      {/* Nachfrage: wirklich löschen? */}
      <Modal visible={!!confirmDelete} transparent animationType="fade" onRequestClose={() => setConfirmDelete(null)}>
        <View style={styles.archiveOverlay}>
          <View style={[styles.confirmModal, HARD_SHADOW_LG]}>
            <View style={[styles.archiveModalHeader, BLUE_GRADIENT]}>
              <Text style={styles.archiveModalTitle}>Spieler löschen</Text>
            </View>
            <Text style={styles.confirmText}>
              {confirmDelete ? `"${confirmDelete.player_name}" wirklich endgültig löschen?` : ''}
            </Text>
            <View style={styles.confirmActions}>
              <TouchableOpacity style={[styles.confirmButton, HARD_SHADOW]} onPress={() => setConfirmDelete(null)}>
                <Text style={styles.confirmButtonText}>Abbrechen</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmButton, styles.confirmButtonDanger, HARD_SHADOW]}
                onPress={() => { const e = confirmDelete; setConfirmDelete(null); if (e) handleRemove(e); }}
              >
                <Text style={[styles.confirmButtonText, { color: '#fff' }]}>Löschen</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Nachfrage: wirklich archivieren? + Grund */}
      <Modal visible={!!archiveTarget} transparent animationType="fade" onRequestClose={() => setArchiveTarget(null)}>
        <View style={styles.archiveOverlay}>
          <View style={[styles.confirmModal, HARD_SHADOW_LG]}>
            <View style={[styles.archiveModalHeader, BLUE_GRADIENT]}>
              <Text style={styles.archiveModalTitle}>Ins Archiv verschieben</Text>
            </View>
            <Text style={styles.confirmText}>
              {archiveTarget ? `"${archiveTarget.player_name}" wirklich ins Archiv verschieben?` : ''}
            </Text>
            <Text style={styles.confirmLabel}>Grund</Text>
            <TextInput
              style={styles.confirmInput}
              placeholder="z.B. abgesagt, aktuell kein Bedarf ..."
              placeholderTextColor={RETRO.textMuted}
              value={archiveReason}
              onChangeText={setArchiveReason}
              multiline
            />
            <View style={styles.confirmActions}>
              <TouchableOpacity style={[styles.confirmButton, HARD_SHADOW]} onPress={() => setArchiveTarget(null)}>
                <Text style={styles.confirmButtonText}>Abbrechen</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmButton, styles.confirmButtonPrimary, HARD_SHADOW]}
                onPress={confirmArchive}
              >
                <Text style={[styles.confirmButtonText, { color: '#fff' }]}>Archivieren</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Archiv-Ansicht */}
      <Modal visible={showArchive} transparent animationType="fade" onRequestClose={() => setShowArchive(false)}>
        <View style={styles.archiveOverlay}>
          <View style={[styles.archiveModal, HARD_SHADOW_LG]}>
            {/* Blauer Titelbalken wie in der Suchmaschine */}
            <View style={[styles.archiveModalHeader, BLUE_GRADIENT]}>
              <Text style={styles.archiveModalTitle}>Archiv ({archivedEntries.length})</Text>
              <TouchableOpacity onPress={() => setShowArchive(false)} hitSlop={8}>
                <Ionicons name="close" size={20} color={RETRO.headerText} />
              </TouchableOpacity>
            </View>
            <Text style={styles.archiveHint}>
              Spieler, die abgesagt haben oder aktuell nicht interessant genug sind. Per "Zurückholen"
              landen sie wieder bei den interessanten Spielern.
            </Text>
            <ScrollView style={styles.archiveList}>
              {archivedEntries.length === 0 ? (
                <Text style={styles.columnEmpty}>
                  Archiv ist leer — ziehe Spieler auf den Archiv-Button.
                </Text>
              ) : (
                archivedEntries.map((entry) => {
                  const details = [entry.birth_date, entry.position, entry.club_name, entry.market_value]
                    .filter(Boolean)
                    .join(' · ');
                  return (
                    <View key={entry.id} style={[styles.card, HARD_SHADOW]}>
                      <View style={styles.cardNameRow}>
                        <Text style={styles.cardName} numberOfLines={1}>
                          {displayName(entry.player_name)}
                        </Text>
                        {entry.tm_profile_url && (
                          <TouchableOpacity onPress={() => openProfile(entry.tm_profile_url)} hitSlop={8}>
                            <Ionicons name="open-outline" size={14} color={RETRO.textMuted} />
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity
                          style={styles.removeButton}
                          onPress={() => setConfirmDelete(entry)}
                          hitSlop={4}
                        >
                          <Ionicons name="trash-outline" size={13} color="#b02020" />
                        </TouchableOpacity>
                      </View>
                      {details ? (
                        <Text style={styles.cardDetails} numberOfLines={2}>
                          {details}
                        </Text>
                      ) : null}
                      {entry.notes ? (
                        <Text style={styles.archiveReason} numberOfLines={2}>
                          Grund: {entry.notes}
                        </Text>
                      ) : null}
                      <TouchableOpacity
                        style={[styles.restoreButton, HARD_SHADOW]}
                        onPress={() => handleMove(entry, 'interessant')}
                      >
                        <Text style={styles.restoreButtonText}>
                          ↩ Zurückholen zu "Interessante Spieler"
                        </Text>
                      </TouchableOpacity>
                    </View>
                  );
                })
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: RETRO.page,
  },
  // RN-Web braucht für absolute BG-Images explizite 100%-Maße plus
  // objectFit/Position UND backgroundSize/Position für zuverlässiges Cover
  bgImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    opacity: 0.55,
    ...(Platform.OS === 'web'
      ? ({
          objectFit: 'cover',
          objectPosition: 'center',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        } as any)
      : {}),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    backgroundColor: RETRO.titleBar,
    borderBottomColor: RETRO.shadowDark,
  },
  backButton: {
    marginRight: 12,
    padding: 4,
  },
  backArrow: {
    fontSize: 24,
    fontWeight: '600',
    color: RETRO.text,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    flex: 1,
    color: RETRO.text,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    padding: 14,
  },
  board: {
    gap: 14,
  },
  boardWide: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  column: {
    borderWidth: 1,
    padding: 10,
    minHeight: 160,
    backgroundColor: RETRO.panel,
    borderColor: RETRO.rowBorder,
  },
  columnWide: {
    flex: 1,
  },
  columnNarrow: {
    width: '100%',
  },
  // Royalblauer Spaltenbalken (Anstoss-Abschnittsbalken) — volle Breite,
  // damit der Abstand zum Spaltenrahmen links und rechts gleich ist
  columnHeaderBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: RETRO.headerBg,
    paddingVertical: 7,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  columnTitle: {
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
    color: RETRO.headerText,
  },
  columnCount: {
    fontSize: 14,
    fontWeight: '700',
    color: RETRO.headerText,
  },
  columnEmpty: {
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 20,
    color: RETRO.textMuted,
  },
  // Weiße Karte mit gelbem Akzent (Anstoss-Spielerinfo) — volle Breite wie der Balken
  card: {
    borderWidth: 1,
    padding: 10,
    marginBottom: 10,
    backgroundColor: RETRO.white,
    borderColor: RETRO.rowBorder,
    borderLeftWidth: 3,
    borderLeftColor: RETRO.yellow,
  },
  cardDragging: {
    zIndex: 1000,
    elevation: 10,
    opacity: 0.92,
    ...(Platform.OS === 'web' ? ({ cursor: 'grabbing' } as any) : {}),
  },
  cardNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cardName: {
    fontSize: 14,
    fontWeight: '600',
    flexShrink: 1,
    flex: 1,
    color: RETRO.text,
  },
  cardDetails: {
    fontSize: 12,
    marginTop: 3,
    color: RETRO.textMuted,
  },
  // Vereinszeile (Wappen + Name) unter dem Spielernamen
  cardClubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  cardClubLogo: {
    width: 16,
    height: 16,
  },
  cardClub: {
    fontSize: 12,
    fontWeight: '600',
    color: RETRO.text,
    flexShrink: 1,
  },
  cardClubMuted: {
    fontSize: 12,
    fontStyle: 'italic',
    color: RETRO.textMuted,
    flexShrink: 1,
  },
  removeButton: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: RETRO.face,
    borderWidth: 1,
    borderColor: RETRO.rowBorder,
  },

  // Archiv (erhabener Retro-Button)
  archiveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: RETRO.face,
    borderColor: RETRO.shadowDark,
  },
  archiveIcon: {
    fontSize: 15,
  },
  archiveLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: RETRO.text,
  },
  archiveCount: {
    fontSize: 13,
    fontWeight: '600',
    color: RETRO.textMuted,
  },
  archiveOverlay: {
    flex: 1,
    backgroundColor: 'rgba(20, 20, 45, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  archiveModal: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '80%',
    borderWidth: 1,
    padding: 14,
    backgroundColor: RETRO.page,
    borderColor: RETRO.shadowDark,
  },
  archiveModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    paddingHorizontal: 12,
    marginBottom: 10,
    backgroundColor: RETRO.headerBg,
  },
  archiveModalTitle: {
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
    color: RETRO.headerText,
  },
  archiveHint: {
    fontSize: 12,
    marginBottom: 12,
    color: RETRO.textMuted,
  },
  archiveList: {
    ...(Platform.OS === 'web' ? ({ overflowY: 'auto' } as any) : {}),
  },
  restoreButton: {
    marginTop: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
    alignSelf: 'flex-start',
    backgroundColor: RETRO.face,
    borderColor: RETRO.shadowDark,
  },
  restoreButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: RETRO.text,
  },
  archiveReason: {
    fontSize: 12,
    fontStyle: 'italic',
    color: RETRO.textMuted,
    marginTop: 4,
  },

  // Bestätigungs-Dialoge (Löschen / Archivieren)
  confirmModal: {
    width: '100%',
    maxWidth: 420,
    borderWidth: 1,
    padding: 14,
    backgroundColor: RETRO.page,
    borderColor: RETRO.shadowDark,
  },
  confirmText: {
    fontSize: 14,
    color: RETRO.text,
    marginBottom: 12,
    paddingHorizontal: 2,
  },
  confirmLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: RETRO.textMuted,
    marginBottom: 4,
  },
  confirmInput: {
    borderWidth: 1,
    borderColor: RETRO.shadowDark,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: RETRO.text,
    minHeight: 56,
    textAlignVertical: 'top',
    marginBottom: 12,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  confirmActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  confirmButton: {
    borderWidth: 1,
    borderColor: RETRO.shadowDark,
    backgroundColor: RETRO.face,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  confirmButtonDanger: {
    backgroundColor: '#b02020',
    borderColor: '#7a1616',
  },
  confirmButtonPrimary: {
    backgroundColor: RETRO.headerBg,
    borderColor: '#223077',
  },
  confirmButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: RETRO.text,
  },
});
