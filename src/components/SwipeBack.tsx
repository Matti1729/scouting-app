import { useEffect } from 'react';
import { Platform } from 'react-native';
import type { NavigationContainerRefWithCurrent } from '@react-navigation/native';

// Übernommen aus der KMH-App (src/components/SwipeBack.tsx, 2026-10-25), Änderungen dort bitte hier nachziehen.
// Zurückwischen wie bei iPhone-Apps (Matti 2026-10-24): Die App läuft vom Home-Bildschirm als Web-App ohne Safari,
// dort gibt es die Safari-Geste nicht. Wischen vom linken Rand nach rechts:
//  - offenes Fenster (Modal): das Fenster wandert mit dem Finger, darunter liegt die Seite → beim Loslassen schließen
//  - sonst wandert die aktuelle Seite mit, dahinter erscheint die VORIGE Seite (native-stack lässt sie im DOM,
//    nur display:none) leicht versetzt wie bei iOS → beim Loslassen goBack().
// Flüssig: Bewegung nur per requestAnimationFrame, will-change/Schatten einmal beim Start (Feedback 2026-10-24: ruckelte).
const EDGE = 24;          // Start nur am linken Rand (px), damit Listen/Karten/Reiter nicht betroffen sind
const THRESHOLD = 0.3;    // ab 30 % der Breite (oder schnellem Wischen) gilt es als „zurück“
const PARALLAX = 0.3;     // vorige Seite startet um 30 % nach links versetzt (wie iOS)
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

/** Bildschirm des Stacks unter dem Finger: absolut positioniert, volle Breite, vorheriges Geschwister versteckt */
function findScreens(x: number, y: number): { cur: HTMLElement; prev: HTMLElement } | null {
  let el = document.elementFromPoint(Math.min(x + 40, window.innerWidth - 1), y) as HTMLElement | null;
  let found: { cur: HTMLElement; prev: HTMLElement } | null = null;
  while (el && el !== document.body) {
    const prev = el.previousElementSibling as HTMLElement | null;
    if (prev && el.offsetWidth >= window.innerWidth - 2) {
      const cs = getComputedStyle(el);
      if (cs.position === 'absolute' && getComputedStyle(prev).display === 'none' && getComputedStyle(prev).position === 'absolute') {
        found = { cur: el, prev }; // äußerster Treffer gewinnt (der Navigations-Stack, nicht innere Reiter)
      }
    }
    el = el.parentElement;
  }
  return found;
}

export function SwipeBack({ navRef }: { navRef: NavigationContainerRefWithCurrent<any> }) {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined' || !('ontouchstart' in window)) return;
    let startX = 0, startY = 0, startT = 0, active = false, decided = false, dx = 0, raf = 0;
    let moving: HTMLElement | null = null;   // was mit dem Finger wandert (Seite oder Fenster)
    let behind: HTMLElement | null = null;   // vorige Seite dahinter (nur bei Seitenwechsel)
    let behindDisplay = '';
    let isModal = false;

    const openModal = () => document.querySelector('[aria-modal="true"][role="dialog"]') as HTMLElement | null;
    const paint = () => {
      raf = 0;
      const w = window.innerWidth;
      if (moving) moving.style.transform = `translate3d(${dx}px,0,0)`;
      if (behind) behind.style.transform = `translate3d(${-(w - dx) * PARALLAX}px,0,0)`;
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(paint); };
    const cleanup = (wentBack = false) => {
      for (const el of [moving, behind]) {
        if (!el) continue;
        el.style.transition = ''; el.style.transform = ''; el.style.willChange = ''; el.style.boxShadow = '';
      }
      // Abgebrochen: vorige Seite wieder verstecken. Zurück gegangen: React zeigt sie jetzt selbst an;
      // nur eine von uns gesetzte Inline-Angabe entfernen, falls die Sichtbarkeit sonst per CSS-Klasse läuft.
      if (behind && (!wentBack || behindDisplay === '')) behind.style.display = behindDisplay;
      moving = null; behind = null; isModal = false;
    };
    const prepare = () => {
      const m = openModal();
      if (m) {
        isModal = true; moving = m;
      } else {
        const s = navRef.current?.canGoBack() ? findScreens(startX, startY) : null;
        if (!s && !navRef.current?.canGoBack()) return false;
        moving = s?.cur || (document.getElementById('root') as HTMLElement);
        if (s) {
          behind = s.prev;
          behindDisplay = behind.style.display;
          behind.style.display = 'flex';
          behind.style.willChange = 'transform';
          behind.style.transform = `translate3d(${-window.innerWidth * PARALLAX}px,0,0)`;
        }
      }
      moving.style.willChange = 'transform';
      moving.style.boxShadow = '-10px 0 30px rgba(0,0,0,0.55)';
      return true;
    };
    const finish = (goBack: boolean) => {
      const w = window.innerWidth;
      const dur = 220;
      for (const el of [moving, behind]) if (el) el.style.transition = `transform ${dur}ms ${EASE}`;
      if (moving) moving.style.transform = `translate3d(${goBack ? w : 0}px,0,0)`;
      if (behind) behind.style.transform = `translate3d(${goBack ? 0 : -w * PARALLAX}px,0,0)`;
      setTimeout(() => {
        if (goBack) {
          if (isModal) document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }));
          else if (navRef.current?.canGoBack()) navRef.current.goBack();
        }
        // Stile erst nach dem Seitenwechsel zurücksetzen, sonst blitzt die alte Seite kurz auf
        requestAnimationFrame(() => requestAnimationFrame(() => cleanup(goBack)));
      }, dur);
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || moving) return;
      const t = e.touches[0];
      active = t.clientX <= EDGE && (!!openModal() || !!navRef.current?.canGoBack());
      decided = false; dx = 0;
      startX = t.clientX; startY = t.clientY; startT = Date.now();
    };
    const onMove = (e: TouchEvent) => {
      if (!active) return;
      const t = e.touches[0];
      const mx = t.clientX - startX, my = t.clientY - startY;
      if (!decided) {
        if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
        // senkrechtes Scrollen hat Vorrang
        if (Math.abs(my) > Math.abs(mx) || mx < 0) { active = false; return; }
        decided = true;
        if (!prepare()) { active = false; return; }
      }
      dx = Math.max(0, mx);
      schedule();
      if (e.cancelable) e.preventDefault();
    };
    const onEnd = () => {
      if (!active || !decided) { active = false; return; }
      active = false;
      if (raf) { cancelAnimationFrame(raf); raf = 0; paint(); }
      const w = window.innerWidth;
      const fast = dx > 40 && dx / Math.max(1, Date.now() - startT) > 0.5;
      finish(dx > w * THRESHOLD || fast);
    };
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
      if (raf) cancelAnimationFrame(raf);
      cleanup();
    };
  }, [navRef]);
  return null;
}
