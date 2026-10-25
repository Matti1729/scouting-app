// Abstand zum unteren Bildschirmrand am iPhone (Matti 2026-10-25): Die runden Display-Ecken und der
// Home-Balken schnitten Knöpfe und die Karten-Legende unten ab. Schwebende Elemente unten rechnen
// SAFE_BOTTOM auf ihren Abstand drauf (Web-App vom Home-Bildschirm: Home-Balken ca. 34 px).
import { Platform } from 'react-native';

function detect(): number {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof document === 'undefined') return 0;
  // 1) echte Angabe des Geräts (nur mit viewport-fit=cover > 0)
  let env = 0;
  try {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;bottom:0;height:0;padding-bottom:env(safe-area-inset-bottom);visibility:hidden';
    document.body.appendChild(probe);
    env = parseFloat(getComputedStyle(probe).paddingBottom) || 0;
    probe.remove();
  } catch { /* egal */ }
  if (env > 0) return env;
  // 2) iPhone ohne Home-Taste (rund): als Web-App vom Home-Bildschirm reicht der Inhalt bis unten
  const ua = navigator.userAgent || '';
  const iPhone = /iPhone/.test(ua);
  const standalone = (navigator as any).standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;
  const tall = Math.max(window.screen?.height || 0, window.screen?.width || 0) >= 812;
  if (iPhone && tall) return standalone ? 30 : 12;
  return 0;
}

export const SAFE_BOTTOM: number = detect();
