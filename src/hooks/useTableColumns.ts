import { useState, useRef, useCallback, useEffect } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ColumnDef } from '../types/tableColumns';

export function useTableColumns(defs: ColumnDef[], containerWidth: number, persistKey?: string) {
  const [columnOrder, setColumnOrder] = useState<string[]>(() => defs.map(d => d.key));
  const [columnWidths, setColumnWidths] = useState<Map<string, number>>(new Map());
  const [loaded, setLoaded] = useState(!persistKey);
  const [resizingKey, setResizingKey] = useState<string | null>(null);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  const resizeRef = useRef<{ key: string; startX: number; startWidth: number; nextKey: string | null; nextStartWidth: number } | null>(null);
  const dragRef = useRef<{ key: string; startX: number; headerLeft: number } | null>(null);
  const widthsRef = useRef<Map<string, number>>(columnWidths);
  const orderRef = useRef<string[]>(columnOrder);
  const rafRef = useRef<number | null>(null);
  const headerElRef = useRef<HTMLElement | null>(null);

  // Keep refs in sync
  widthsRef.current = columnWidths;
  orderRef.current = columnOrder;

  // Load persisted state on mount
  useEffect(() => {
    if (!persistKey) return;
    AsyncStorage.getItem(`table_columns_${persistKey}`).then(raw => {
      if (raw) {
        try {
          const saved = JSON.parse(raw);
          if (saved.order) setColumnOrder(saved.order);
          if (saved.widths) setColumnWidths(new Map(Object.entries(saved.widths) as [string, number][]));
        } catch {}
      }
      setLoaded(true);
    });
  }, [persistKey]);

  // Save to AsyncStorage when order or widths change
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!persistKey || !loaded) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const data = {
        order: columnOrder,
        widths: Object.fromEntries(columnWidths),
      };
      AsyncStorage.setItem(`table_columns_${persistKey}`, JSON.stringify(data));
    }, 500);
  }, [persistKey, loaded, columnOrder, columnWidths]);

  // Sync column order when defs change (new columns added/removed)
  useEffect(() => {
    const defKeys = defs.map(d => d.key);
    setColumnOrder(prev => {
      const existing = prev.filter(k => defKeys.includes(k));
      const newKeys = defKeys.filter(k => !prev.includes(k));
      return [...existing, ...newKeys];
    });
  }, [defs.map(d => d.key).join(',')]);

  // Compute/scale widths when containerWidth changes
  const prevContainerWidthRef = useRef(0);
  useEffect(() => {
    if (containerWidth <= 0) return;

    const fixedTotal = defs.reduce((sum, d) => sum + (d.fixedWidth || 0), 0);
    const available = containerWidth - fixedTotal;

    // If we have existing widths, scale them proportionally to fit new container
    if (loaded && columnWidths.size > 0 && defs.every(d => columnWidths.has(d.key)) && prevContainerWidthRef.current > 0) {
      const prevAvailable = prevContainerWidthRef.current - fixedTotal;
      if (prevAvailable > 0 && Math.abs(prevAvailable - available) > 1) {
        const scale = available / prevAvailable;
        const newWidths = new Map<string, number>();
        for (const def of defs) {
          if (def.fixedWidth) {
            newWidths.set(def.key, def.fixedWidth);
          } else {
            const current = columnWidths.get(def.key) || 100;
            newWidths.set(def.key, Math.max(current * scale, def.minWidth));
          }
        }
        setColumnWidths(newWidths);
        prevContainerWidthRef.current = containerWidth;
        return;
      }
    }

    // Initial calculation from flex values
    if (columnWidths.size === 0 || !defs.every(d => columnWidths.has(d.key))) {
      const totalFlex = defs.reduce((sum, d) => sum + (d.fixedWidth ? 0 : d.defaultFlex), 0);
      const newWidths = new Map<string, number>();
      for (const def of defs) {
        if (def.fixedWidth) {
          newWidths.set(def.key, def.fixedWidth);
        } else {
          const w = totalFlex > 0 ? (def.defaultFlex / totalFlex) * available : 100;
          newWidths.set(def.key, Math.max(w, def.minWidth));
        }
      }
      setColumnWidths(newWidths);
    }

    prevContainerWidthRef.current = containerWidth;
  }, [containerWidth, loaded, defs.map(d => `${d.key}:${d.defaultFlex}:${d.fixedWidth}`).join(',')]);

  const getColumnWidth = useCallback((key: string): number => {
    return widthsRef.current.get(key) || 100;
  }, []);

  const getDefByKey = useCallback((key: string) => defs.find(d => d.key === key), [defs]);

  // Callback for TableHeader to register the header DOM element
  const setHeaderRef = useCallback((ref: any) => {
    if (Platform.OS === 'web' && ref) {
      // React Native Web: the ref is a View which renders as a div
      // We can get the underlying DOM node
      headerElRef.current = ref;
    }
  }, []);

  // ─── RESIZE ───
  const onResizeStart = useCallback((key: string, e: any) => {
    if (Platform.OS !== 'web') return;
    e.preventDefault?.();

    const order = orderRef.current;
    const idx = order.indexOf(key);
    const nextKey = idx < order.length - 1 ? order[idx + 1] : null;

    resizeRef.current = {
      key,
      startX: e.clientX ?? e.nativeEvent?.pageX ?? 0,
      startWidth: widthsRef.current.get(key) || 100,
      nextKey,
      nextStartWidth: nextKey ? (widthsRef.current.get(nextKey) || 100) : 0,
    };
    setResizingKey(key);

    const handleMove = (ev: PointerEvent) => {
      if (!resizeRef.current) return;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);

      rafRef.current = requestAnimationFrame(() => {
        const ref = resizeRef.current!;
        const delta = ev.clientX - ref.startX;
        const def = getDefByKey(ref.key);
        const nextDef = ref.nextKey ? getDefByKey(ref.nextKey) : null;

        let newWidth = ref.startWidth + delta;
        let newNextWidth = ref.nextStartWidth - delta;

        // Clamp to min widths
        if (def && newWidth < def.minWidth) {
          newWidth = def.minWidth;
          newNextWidth = ref.nextStartWidth + (ref.startWidth - def.minWidth);
        }
        if (nextDef && newNextWidth < nextDef.minWidth) {
          newNextWidth = nextDef.minWidth;
          newWidth = ref.startWidth + (ref.nextStartWidth - nextDef.minWidth);
        }

        setColumnWidths(prev => {
          const next = new Map(prev);
          next.set(ref.key, newWidth);
          if (ref.nextKey) next.set(ref.nextKey, newNextWidth);
          return next;
        });
      });
    };

    const handleUp = () => {
      resizeRef.current = null;
      setResizingKey(null);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleUp);
    };

    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleUp);
  }, [getDefByKey]);

  // ─── DRAG & DROP REORDER ───
  const onDragStart = useCallback((key: string, e: any) => {
    if (Platform.OS !== 'web') return;
    e.preventDefault?.();

    // Get the header's left position to compute relative X
    let headerLeft = 0;
    if (headerElRef.current) {
      const el = headerElRef.current as any;
      if (el.getBoundingClientRect) {
        headerLeft = el.getBoundingClientRect().left;
      } else if (el.measure) {
        // Fallback for React Native Web
        el.measure((_x: number, _y: number, _w: number, _h: number, pageX: number) => {
          headerLeft = pageX;
        });
      }
    }

    dragRef.current = {
      key,
      startX: e.clientX ?? e.nativeEvent?.pageX ?? 0,
      headerLeft,
    };
    setDraggingKey(key);

    const handleMove = (ev: PointerEvent) => {
      if (!dragRef.current) return;
      const order = orderRef.current;
      const widths = widthsRef.current;
      const relX = ev.clientX - dragRef.current.headerLeft;

      // Determine which column the pointer is over using relative position
      let cumX = 0;
      let overKey: string | null = null;
      for (const k of order) {
        const w = widths.get(k) || 100;
        if (relX >= cumX && relX < cumX + w) {
          overKey = k;
          break;
        }
        cumX += w;
      }
      // If pointer is beyond all columns, use the last one
      if (!overKey && order.length > 0) {
        overKey = order[order.length - 1];
      }

      if (overKey && overKey !== dragRef.current.key) {
        setDragOverKey(overKey);
      } else {
        setDragOverKey(null);
      }
    };

    const handleUp = () => {
      if (dragRef.current) {
        const fromKey = dragRef.current.key;
        setDragOverKey(current => {
          if (current && current !== fromKey) {
            setColumnOrder(prev => {
              const newOrder = [...prev];
              const fromIdx = newOrder.indexOf(fromKey);
              const toIdx = newOrder.indexOf(current);
              if (fromIdx !== -1 && toIdx !== -1) {
                // Swap
                [newOrder[fromIdx], newOrder[toIdx]] = [newOrder[toIdx], newOrder[fromIdx]];
              }
              return newOrder;
            });
          }
          return null;
        });
      }
      dragRef.current = null;
      setDraggingKey(null);
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleUp);
    };

    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleUp);
  }, []);

  return {
    columnOrder,
    columnWidths,
    getColumnWidth,
    onResizeStart,
    onDragStart,
    resizingKey,
    draggingKey,
    dragOverKey,
    setHeaderRef,
  };
}
