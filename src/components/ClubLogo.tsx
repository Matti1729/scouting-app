import React, { useEffect, useState } from 'react';
import { View, Image, Platform } from 'react-native';
import { clubLogoUriFor, resolveClubLogoUri } from '../services/areaGamesService';

// Transfermarkt-Wappen haben unterschiedlich viel transparenten Rand in der
// Datei — dadurch wirken gleiche 16×16-Boxen unterschiedlich groß. Auf Web
// messen wir einmal die tatsächlichen Wappen-Grenzen (Canvas) und skalieren
// so, dass alle Wappen die Box gleich ausfüllen. Ergebnis wird pro URL gecacht.
const scaleCache = new Map<string, number>();

function measureScale(uri: string): Promise<number> {
  return new Promise((resolve) => {
    try {
      const img = new (window as any).Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = img.width;
          c.height = img.height;
          const ctx = c.getContext('2d');
          if (!ctx) return resolve(1);
          ctx.drawImage(img, 0, 0);
          const d = ctx.getImageData(0, 0, c.width, c.height).data;
          let minX = c.width, minY = c.height, maxX = -1, maxY = -1;
          for (let y = 0; y < c.height; y++) {
            for (let x = 0; x < c.width; x++) {
              if (d[(y * c.width + x) * 4 + 3] > 16) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
              }
            }
          }
          if (maxX < 0) return resolve(1);
          const cw = maxX - minX + 1;
          const ch = maxY - minY + 1;
          // Auf gleiche WAPPENHÖHE normalisieren (die vergleicht das Auge in der
          // Zeile); breite, flache Wappen dürfen bis 1.5x Boxbreite hinauswachsen
          const s = Math.min(c.height / ch, (1.5 * c.width) / cw, 4);
          resolve(Math.max(1, s));
        } catch {
          // CORS/Canvas nicht erlaubt -> Original lassen
          resolve(1);
        }
      };
      img.onerror = () => resolve(1);
      img.src = uri;
    } catch {
      resolve(1);
    }
  });
}

export function ClubLogo({ uri, size = 16 }: { uri: string; size?: number }) {
  const [scale, setScale] = useState<number>(scaleCache.get(uri) ?? 1);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const cached = scaleCache.get(uri);
    if (cached != null) {
      setScale(cached);
      return;
    }
    let cancelled = false;
    measureScale(uri).then((s) => {
      scaleCache.set(uri, s);
      if (!cancelled) setScale(s);
    });
    return () => { cancelled = true; };
  }, [uri]);

  const inner = size * scale;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Image source={{ uri }} style={{ width: inner, height: inner }} resizeMode="contain" />
    </View>
  );
}

/** Wappen für einen Teamnamen: erst DB-Lookup (map), dann On-Demand-Auflösung
 *  über die TM-Schnellsuche (gecacht). Rendert nichts, wenn kein Wappen. */
export function TeamLogo({ name, map, size = 16 }: { name: string; map: Map<string, string>; size?: number }) {
  const direct = clubLogoUriFor(map, name);
  const [resolved, setResolved] = useState<string | null>(null);
  useEffect(() => {
    if (direct) return;
    let cancelled = false;
    setResolved(null);
    resolveClubLogoUri(name).then((u) => {
      if (!cancelled) setResolved(u);
    });
    return () => { cancelled = true; };
  }, [name, direct]);
  const uri = direct || resolved;
  if (!uri) return null;
  return <ClubLogo uri={uri} size={size} />;
}

export default ClubLogo;
