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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import {
  StipendiumEntry,
  StipendiumStatus,
  loadStipendiumEntries,
  updateStipendiumStatus,
  removeStipendiumEntry,
} from '../../services/stipendiumService';

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
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const isWide = width > 900;

  const [entries, setEntries] = useState<StipendiumEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hoveredColumn, setHoveredColumn] = useState<StipendiumStatus | null>(null);
  const [showArchive, setShowArchive] = useState(false);

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

  const openProfile = (url: string | null) => {
    if (!url) return;
    if (Platform.OS === 'web') {
      window.open(url, '_blank');
    } else {
      Linking.openURL(url);
    }
  };

  const columnColor = (key: StipendiumStatus) =>
    key === 'interessant'
      ? colors.accent
      : key === 'kontaktiert'
      ? colors.warning
      : key === 'go'
      ? colors.success
      : colors.textSecondary;

  const archivedEntries = entries.filter((e) => e.status === ARCHIVE);

  const onCardDragMove = (pageX: number, pageY: number) => {
    setHoveredColumn(columnAt(pageX, pageY));
  };

  const onCardDragEnd = (entry: StipendiumEntry) => (pageX: number, pageY: number) => {
    setHoveredColumn(null);
    if (pageX < 0) return; // abgebrochen
    const target = columnAt(pageX, pageY);
    if (target && target !== entry.status) {
      handleMove(entry, target);
    }
  };

  const renderCard = (entry: StipendiumEntry) => {
    const details = [entry.birth_date, entry.position, entry.club_name, entry.market_value]
      .filter(Boolean)
      .join(' · ');

    return (
      <DraggableCard
        key={entry.id}
        onDragMove={onCardDragMove}
        onDragEnd={onCardDragEnd(entry)}
      >
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.cardNameRow}>
            <Text style={[styles.cardName, { color: colors.text }]} numberOfLines={1}>
              {entry.player_name}
            </Text>
            {entry.tm_profile_url && (
              <TouchableOpacity onPress={() => openProfile(entry.tm_profile_url)} hitSlop={8}>
                <Ionicons name="open-outline" size={14} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.removeButton, { backgroundColor: colors.textSecondary + '15' }]}
              onPress={() => handleMove(entry, ARCHIVE)}
              hitSlop={4}
            >
              <Ionicons name="archive-outline" size={13} color={colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.removeButton, { backgroundColor: colors.error + '15' }]}
              onPress={() => handleRemove(entry)}
              hitSlop={4}
            >
              <Ionicons name="trash-outline" size={13} color={colors.error} />
            </TouchableOpacity>
          </View>
          {details ? (
            <Text style={[styles.cardDetails, { color: colors.textSecondary }]} numberOfLines={2}>
              {details}
            </Text>
          ) : null}
        </View>
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
          { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
          hovered && { borderColor: columnColor(col.key), borderWidth: 2, backgroundColor: columnColor(col.key) + '10' },
        ]}
      >
        <View style={[styles.columnHeader, { borderBottomColor: columnColor(col.key) }]}>
          <Text style={styles.columnIcon}>{col.icon}</Text>
          <Text style={[styles.columnTitle, { color: colors.text }]}>{col.title}</Text>
          <Text style={[styles.columnCount, { color: columnColor(col.key) }]}>{colEntries.length}</Text>
        </View>
        {colEntries.length === 0 ? (
          <Text style={[styles.columnEmpty, { color: colors.textSecondary }]}>
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
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={[styles.backArrow, { color: colors.text }]}>{'←'}</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Sportstipendium</Text>
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
              { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
              hoveredColumn === ARCHIVE && {
                borderColor: colors.text,
                borderWidth: 2,
                backgroundColor: colors.text + '15',
              },
            ]}
            onPress={() => setShowArchive(true)}
          >
            <Text style={styles.archiveIcon}>🗄️</Text>
            <Text style={[styles.archiveLabel, { color: colors.text }]}>Archiv</Text>
            <Text style={[styles.archiveCount, { color: colors.textSecondary }]}>
              {archivedEntries.length}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
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
              tintColor={colors.primary}
            />
          }
        >
          <View style={[styles.board, isWide && styles.boardWide]}>
            {COLUMNS.map(renderColumn)}
          </View>
        </ScrollView>
      )}

      {/* Archiv-Ansicht */}
      <Modal visible={showArchive} transparent animationType="fade" onRequestClose={() => setShowArchive(false)}>
        <View style={styles.archiveOverlay}>
          <View style={[styles.archiveModal, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={[styles.archiveModalHeader, { borderBottomColor: colors.border }]}>
              <Text style={styles.archiveIcon}>🗄️</Text>
              <Text style={[styles.archiveModalTitle, { color: colors.text }]}>
                Archiv ({archivedEntries.length})
              </Text>
              <TouchableOpacity onPress={() => setShowArchive(false)} hitSlop={8}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <Text style={[styles.archiveHint, { color: colors.textSecondary }]}>
              Spieler, die abgesagt haben oder aktuell nicht interessant genug sind. Per "Zurückholen"
              landen sie wieder bei den interessanten Spielern.
            </Text>
            <ScrollView style={styles.archiveList}>
              {archivedEntries.length === 0 ? (
                <Text style={[styles.columnEmpty, { color: colors.textSecondary }]}>
                  Archiv ist leer — ziehe Spieler auf den Archiv-Button.
                </Text>
              ) : (
                archivedEntries.map((entry) => {
                  const details = [entry.birth_date, entry.position, entry.club_name, entry.market_value]
                    .filter(Boolean)
                    .join(' · ');
                  return (
                    <View
                      key={entry.id}
                      style={[styles.card, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
                    >
                      <View style={styles.cardNameRow}>
                        <Text style={[styles.cardName, { color: colors.text }]} numberOfLines={1}>
                          {entry.player_name}
                        </Text>
                        {entry.tm_profile_url && (
                          <TouchableOpacity onPress={() => openProfile(entry.tm_profile_url)} hitSlop={8}>
                            <Ionicons name="open-outline" size={14} color={colors.textSecondary} />
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity
                          style={[styles.removeButton, { backgroundColor: colors.error + '15' }]}
                          onPress={() => handleRemove(entry)}
                          hitSlop={4}
                        >
                          <Ionicons name="trash-outline" size={13} color={colors.error} />
                        </TouchableOpacity>
                      </View>
                      {details ? (
                        <Text style={[styles.cardDetails, { color: colors.textSecondary }]} numberOfLines={2}>
                          {details}
                        </Text>
                      ) : null}
                      <TouchableOpacity
                        style={[styles.restoreButton, { backgroundColor: colors.accent + '15', borderColor: colors.accent + '40' }]}
                        onPress={() => handleMove(entry, 'interessant')}
                      >
                        <Text style={[styles.restoreButtonText, { color: colors.accent }]}>
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
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
  },
  backButton: {
    marginRight: 12,
    padding: 4,
  },
  backArrow: {
    fontSize: 24,
    fontWeight: '600',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    flex: 1,
  },
  headerCount: {
    fontSize: 16,
    fontWeight: '500',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    padding: 12,
  },
  board: {
    gap: 12,
  },
  boardWide: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  column: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    minHeight: 140,
  },
  columnWide: {
    flex: 1,
  },
  columnNarrow: {
    width: '100%',
  },
  columnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 8,
    marginBottom: 10,
    borderBottomWidth: 2,
  },
  columnIcon: {
    fontSize: 16,
  },
  columnTitle: {
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
  },
  columnCount: {
    fontSize: 15,
    fontWeight: '700',
  },
  columnEmpty: {
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 20,
  },
  card: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
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
  },
  cardDetails: {
    fontSize: 12,
    marginTop: 3,
  },
  removeButton: {
    width: 24,
    height: 24,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Archiv
  archiveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  archiveIcon: {
    fontSize: 15,
  },
  archiveLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  archiveCount: {
    fontSize: 13,
    fontWeight: '600',
  },
  archiveOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  archiveModal: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '80%',
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
  },
  archiveModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 10,
    marginBottom: 10,
    borderBottomWidth: 1,
  },
  archiveModalTitle: {
    fontSize: 17,
    fontWeight: '700',
    flex: 1,
  },
  archiveHint: {
    fontSize: 12,
    marginBottom: 12,
  },
  archiveList: {
    ...(Platform.OS === 'web' ? ({ overflowY: 'auto' } as any) : {}),
  },
  restoreButton: {
    marginTop: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 7,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  restoreButtonText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
