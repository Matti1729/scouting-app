import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { ColumnDef } from '../../types/tableColumns';

interface TableHeaderProps {
  columnDefs: ColumnDef[];
  columnOrder: string[];
  getColumnWidth: (key: string) => number;
  onResizeStart: (key: string, e: any) => void;
  onDragStart: (key: string, e: any) => void;
  resizingKey: string | null;
  draggingKey: string | null;
  dragOverKey: string | null;
  onSort?: (key: string) => void;
  sortKey?: string;
  sortAsc?: boolean;
  colors: any;
  style?: any;
  renderHeaderExtra?: (key: string) => React.ReactNode;
  setHeaderRef?: (ref: any) => void;
}

const DIVIDER_WIDTH = 12;

export function TableHeader({
  columnDefs,
  columnOrder,
  getColumnWidth,
  onResizeStart,
  onDragStart,
  resizingKey,
  draggingKey,
  dragOverKey,
  onSort,
  sortKey,
  sortAsc,
  colors,
  style,
  renderHeaderExtra,
  setHeaderRef,
}: TableHeaderProps) {
  const defMap = new Map(columnDefs.map(d => [d.key, d]));

  const headerRefCallback = useCallback((ref: any) => {
    if (setHeaderRef && ref) {
      setHeaderRef(ref);
    }
  }, [setHeaderRef]);

  return (
    <View
      ref={headerRefCallback}
      style={[styles.headerRow, { backgroundColor: colors.surfaceSecondary, borderBottomColor: colors.border }, style]}
    >
      {columnOrder.map((key, idx) => {
        const def = defMap.get(key);
        if (!def) return null;
        // Subtract divider space from the cell width so total stays correct
        const isLast = idx === columnOrder.length - 1;
        const rawWidth = getColumnWidth(key);
        const width = isLast ? rawWidth : rawWidth - DIVIDER_WIDTH;
        const isDragging = draggingKey === key;
        const isDragOver = dragOverKey === key;

        return (
          <React.Fragment key={key}>
            <View
              style={[
                styles.headerCell,
                { width },
                isDragging && styles.headerCellDragging,
                isDragOver && { borderLeftWidth: 2, borderLeftColor: colors.primary },
              ]}
            >
              <View
                style={styles.headerContent}
                {...(Platform.OS === 'web' ? {
                  onPointerDown: (e: any) => onDragStart(key, e),
                } : {})}
              >
                <Text
                  style={[
                    styles.headerText,
                    { color: colors.textSecondary },
                    sortKey === key && { color: colors.text },
                    Platform.OS === 'web' && ({ cursor: draggingKey ? 'grabbing' : 'grab' } as any),
                  ]}
                  onPress={onSort ? () => onSort(key) : undefined}
                  numberOfLines={1}
                >
                  {def.label}
                  {sortKey === key ? (sortAsc ? ' ▲' : ' ▼') : ''}
                </Text>
                {renderHeaderExtra ? renderHeaderExtra(key) : null}
              </View>
            </View>

            {/* Resize divider between cells */}
            {!isLast && (
              <ResizeHandle
                columnKey={key}
                isResizing={resizingKey === key}
                onResizeStart={onResizeStart}
              />
            )}
          </React.Fragment>
        );
      })}
    </View>
  );
}

function ResizeHandle({
  columnKey,
  isResizing,
  onResizeStart,
}: {
  columnKey: string;
  isResizing: boolean;
  onResizeStart: (key: string, e: any) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const visible = hovered || isResizing;

  return (
    <View
      style={[
        styles.resizeHandle,
        Platform.OS === 'web' && ({ cursor: 'col-resize' } as any),
      ]}
      {...(Platform.OS === 'web' ? {
        onPointerDown: (e: any) => onResizeStart(columnKey, e),
        onPointerEnter: () => setHovered(true),
        onPointerLeave: () => setHovered(false),
      } : {})}
    >
      <View
        style={[
          styles.resizeLine,
          { width: visible ? 3 : 1 },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderBottomWidth: 1,
  },
  headerCell: {
    paddingHorizontal: 4,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerCellDragging: {
    opacity: 0.4,
  },
  headerContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  resizeHandle: {
    width: DIVIDER_WIDTH,
    alignSelf: 'stretch',
    justifyContent: 'center',
    alignItems: 'center',
  },
  resizeLine: {
    height: '100%',
    backgroundColor: '#000',
    borderRadius: 1,
  },
});
