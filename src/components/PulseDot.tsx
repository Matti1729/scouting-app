import React, { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';

// Pulsierender oranger Punkt: "Bei diesem Spiel bin ich" (in "Meine Spiele" übernommen).
// Sitzt hinter der Nennung der Partie, nicht in der Kopfzeile.
export function PulseDot({ size = 10, color = '#e8930c' }: { size?: number; color?: string }) {
  const scale = useRef(new Animated.Value(1)).current;
  const ring = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(scale, { toValue: 1.25, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(ring, { toValue: 1, duration: 1400, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(ring, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [scale, ring]);

  const ringScale = ring.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] });
  const ringOpacity = ring.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0.45, 0.15, 0] });
  return (
    <Animated.View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        style={{
          position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: color,
          opacity: ringOpacity, transform: [{ scale: ringScale }],
        }}
      />
      <Animated.View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, transform: [{ scale }] }} />
    </Animated.View>
  );
}
