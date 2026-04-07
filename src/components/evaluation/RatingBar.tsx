import React, { useRef, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, Platform, PanResponder, LayoutChangeEvent } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';

interface RatingBarProps {
  value: number;
  onChange: (value: number) => void;
  compact?: boolean;
  compactSize?: number;
}

/** Generate flat-top hexagon polygon points as CSS clip-path */
function hexClipPath(): string {
  // Flat-top hexagon: 6 points
  return 'polygon(50% 0%, 93.3% 25%, 93.3% 75%, 50% 100%, 6.7% 75%, 6.7% 25%)';
}

/** Cyber Hex badge with glow effect — true 6-sided hexagon via clip-path (web) */
function HexBadge({ value, size, color, bgColor, isGold }: { value: number; size: number; color: string; bgColor: string; isGold?: boolean }) {
  const glowSize = size > 50 ? 12 : 6;
  const borderW = size > 50 ? 2.5 : 1.5;
  const innerInset = size > 50 ? 8 : 5;
  const clip = hexClipPath();

  return (
    <View style={{ width: size, height: size * 1.1, alignItems: 'center', justifyContent: 'center' }}>
      {/* Glow layers — soft falloff, close range */}
      <View style={{
        position: 'absolute',
        width: size + glowSize * 2,
        height: (size + glowSize * 2) * 1.1,
        borderRadius: size * 0.4,
        backgroundColor: color + (isGold ? '12' : '08'),
        ...(Platform.OS === 'web' ? {
          filter: `blur(${glowSize}px)`,
        } as any : {}),
      }} />
      <View style={{
        position: 'absolute',
        width: size + glowSize,
        height: (size + glowSize) * 1.1,
        ...(Platform.OS === 'web' ? {
          clipPath: clip,
          backgroundColor: color + (isGold ? '20' : '12'),
          boxShadow: isGold
            ? `0 0 ${glowSize * 2}px ${color}35, 0 0 ${glowSize * 4}px #FFE08040, 0 0 ${glowSize * 6}px #FFD70020`
            : `0 0 ${glowSize * 2}px ${color}20, 0 0 ${glowSize * 4}px ${color}10`,
        } as any : {
          backgroundColor: color + '10',
          borderRadius: size * 0.15,
        }),
      }} />
      {/* Outer hex — solid border via layered clip-paths */}
      <View style={{
        position: 'absolute',
        width: size,
        height: size * 1.1,
        ...(Platform.OS === 'web' ? {
          clipPath: clip,
          backgroundColor: color,
        } as any : {
          backgroundColor: color,
          borderRadius: size * 0.12,
        }),
      }} />
      {/* Inner fill (bg color) */}
      <View style={{
        position: 'absolute',
        width: size - borderW * 2,
        height: (size - borderW * 2) * 1.1,
        ...(Platform.OS === 'web' ? {
          clipPath: clip,
          backgroundColor: bgColor,
        } as any : {
          backgroundColor: bgColor,
          borderRadius: size * 0.1,
        }),
      }} />
      {/* Inner "naht" hex — solid thin line inside */}
      <View style={{
        position: 'absolute',
        width: size - innerInset * 2,
        height: (size - innerInset * 2) * 1.1,
        ...(Platform.OS === 'web' ? {
          clipPath: clip,
          backgroundColor: color + '35',
        } as any : {
          backgroundColor: color + '35',
          borderRadius: size * 0.08,
        }),
      }} />
      <View style={{
        position: 'absolute',
        width: size - innerInset * 2 - borderW,
        height: ((size - innerInset * 2 - borderW) * 1.1),
        ...(Platform.OS === 'web' ? {
          clipPath: clip,
          backgroundColor: bgColor,
        } as any : {
          backgroundColor: bgColor,
          borderRadius: size * 0.07,
        }),
      }} />
      {/* Value with glow */}
      <Text style={{
        fontSize: size * 0.36,
        fontWeight: '800',
        color,
        marginTop: size > 50 ? -4 : -2,
        ...(Platform.OS === 'web' ? {
          textShadow: `0 0 ${glowSize}px ${color}80, 0 0 ${glowSize * 2}px ${color}40`,
        } as any : {}),
      }}>
        {value || '-'}
      </Text>
    </View>
  );
}

export function RatingBar({ value, onChange, compact, compactSize }: RatingBarProps) {
  const { colors } = useTheme();
  const trackRef = useRef<View>(null);
  const trackLayoutRef = useRef({ x: 0, width: 0 });
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const isGold = value === 10;
  const ratingColor = value === 0 ? colors.border
    : isGold ? '#F0C040'
    : value >= 7 ? colors.primary
    : value >= 4 ? '#e8930c'
    : colors.error;

  const valueFromPageX = useCallback((pageX: number) => {
    const { x, width } = trackLayoutRef.current;
    if (width === 0) return 0;
    const ratio = Math.max(0, Math.min(1, (pageX - x) / width));
    return Math.round(ratio * 10);
  }, []);

  const handleTrackLayout = useCallback((_e: LayoutChangeEvent) => {
    trackRef.current?.measureInWindow((x, _y, w) => {
      trackLayoutRef.current = { x, width: w };
    });
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = trackRef.current as any;
    if (!node) return;
    const el: HTMLElement | null = node._nativeTag ?? node.getNode?.() ?? node;
    if (!el || !el.addEventListener) return;

    const handlePointerDown = (e: PointerEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      trackLayoutRef.current = { x: rect.left, width: rect.width };
      onChangeRef.current(valueFromPageX(e.clientX));

      const handlePointerMove = (ev: PointerEvent) => {
        onChangeRef.current(valueFromPageX(ev.clientX));
      };
      const handlePointerUp = () => {
        document.removeEventListener('pointermove', handlePointerMove);
        document.removeEventListener('pointerup', handlePointerUp);
      };
      document.addEventListener('pointermove', handlePointerMove);
      document.addEventListener('pointerup', handlePointerUp);
    };

    el.addEventListener('pointerdown', handlePointerDown);
    return () => el.removeEventListener('pointerdown', handlePointerDown);
  }, [valueFromPageX]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        trackRef.current?.measureInWindow((x, _y, w) => {
          trackLayoutRef.current = { x, width: w };
          onChangeRef.current(valueFromPageX(e.nativeEvent.pageX));
        });
      },
      onPanResponderMove: (e) => {
        onChangeRef.current(valueFromPageX(e.nativeEvent.pageX));
      },
    })
  ).current;

  const fillPercent = (value / 10) * 100;

  const renderSlider = () => (
    <View
      ref={trackRef}
      onLayout={handleTrackLayout}
      style={[styles.trackWrap, compact && styles.trackWrapCompact, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
      {...(Platform.OS !== 'web' ? panResponder.panHandlers : {})}
    >
      <View style={[styles.track, compact && styles.trackCompact, { backgroundColor: colors.border }]}>
        <View style={[styles.trackFill, { width: `${fillPercent}%`, backgroundColor: ratingColor }]} />
      </View>
      <View style={[
        styles.thumb, compact && styles.thumbCompact,
        { left: `${fillPercent}%`, backgroundColor: ratingColor, borderColor: colors.surface },
      ]} />
    </View>
  );

  if (compact) {
    return (
      <View style={styles.compactContainer}>
        <HexBadge value={value} size={compactSize || 36} color={ratingColor} bgColor={colors.surface} isGold={isGold} />
        {renderSlider()}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <HexBadge value={value} size={80} color={ratingColor} bgColor={colors.surface} isGold={isGold} />
      {renderSlider()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 12,
    width: '100%',
  },
  compactContainer: {
    alignItems: 'center',
    gap: 2,
    width: '100%',
  },
  trackWrap: {
    width: '70%',
    height: 36,
    justifyContent: 'center',
    position: 'relative',
  },
  trackWrapCompact: {
    height: 24,
  },
  track: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  trackCompact: {
    height: 3,
  },
  trackFill: {
    height: '100%',
    borderRadius: 2,
  },
  thumb: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 3,
    marginLeft: -10,
    top: 8,
  },
  thumbCompact: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    marginLeft: -7,
    top: 5,
  },
});
