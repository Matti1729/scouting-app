import { useEffect } from 'react';
import { Platform } from 'react-native';

// Fenster nach unten wegwischen (Matti 2026-10-25), passend zum Zurückwischen (SwipeBack, aus der KMH-App):
// Am Handy sind die Fenster Bottom-Sheets (Aufstellung, Bewertungsbogen, Spielerprofil …). Wischen am KOPF des
// Sheets (obere 90 px, gelbe Titelleiste) nach unten: das Sheet wandert mit dem Finger, ab 25 % der Sheet-Höhe
// oder schnellem Wischen schließt es (Escape → onRequestClose des Modals), sonst federt es zurück.
// Nur am Kopf, damit Scrollen in Listen und Tippen in Felder nicht ausgelöst wird.
const HEAD_ZONE = 90;
const THRESHOLD = 0.25;
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

/** Bottom-Sheet unter dem Finger: volle Breite, schließt unten bündig ab, beginnt unterhalb des Seitenanfangs */
function findSheet(target: Element | null, dialog: HTMLElement): HTMLElement | null {
  let el = target as HTMLElement | null;
  let found: HTMLElement | null = null;
  while (el && el !== dialog && el !== document.body) {
    const r = el.getBoundingClientRect();
    if (r.width >= window.innerWidth - 2 && r.bottom >= window.innerHeight - 2 && r.top > 8) found = el;
    el = el.parentElement;
  }
  return found;
}

export function SwipeDownClose() {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined' || !('ontouchstart' in window)) return;
    let startY = 0, startX = 0, startT = 0, active = false, decided = false, dy = 0, raf = 0;
    let sheet: HTMLElement | null = null;

    const openModals = () => Array.from(document.querySelectorAll('[aria-modal="true"][role="dialog"]')) as HTMLElement[];
    const paint = () => { raf = 0; if (sheet) sheet.style.transform = `translate3d(0,${dy}px,0)`; };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(paint); };
    const cleanup = () => {
      if (sheet) { sheet.style.transition = ''; sheet.style.transform = ''; sheet.style.willChange = ''; }
      sheet = null;
    };

    const onStart = (e: TouchEvent) => {
      active = false;
      if (e.touches.length !== 1 || sheet) return;
      const modals = openModals();
      if (!modals.length) return;
      const dialog = modals[modals.length - 1]; // oberstes Fenster
      const t = e.touches[0];
      // Felder/Knöpfe am Kopf (✕, Links) behalten ihr Tippen; Ziehen beginnt erst nach 8 px
      const s = findSheet(document.elementFromPoint(t.clientX, t.clientY), dialog);
      if (!s || t.clientY - s.getBoundingClientRect().top > HEAD_ZONE) return;
      sheet = s; active = true; decided = false; dy = 0;
      startX = t.clientX; startY = t.clientY; startT = Date.now();
    };
    const onMove = (e: TouchEvent) => {
      if (!active || !sheet) return;
      const t = e.touches[0];
      const mx = t.clientX - startX, my = t.clientY - startY;
      if (!decided) {
        if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
        // seitlich (z. B. Zurückwischen vom Rand) oder nach oben: nicht unser Fall
        if (Math.abs(mx) > Math.abs(my) || my < 0) { active = false; sheet = null; return; }
        decided = true;
        sheet.style.willChange = 'transform';
      }
      dy = Math.max(0, my);
      schedule();
      if (e.cancelable) e.preventDefault();
    };
    const onEnd = () => {
      if (!active || !decided || !sheet) { active = false; sheet = null; return; }
      active = false;
      if (raf) { cancelAnimationFrame(raf); raf = 0; paint(); }
      const h = sheet.getBoundingClientRect().height + dy;
      const fast = dy > 40 && dy / Math.max(1, Date.now() - startT) > 0.5;
      const close = dy > h * THRESHOLD || fast;
      const dur = 220;
      sheet.style.transition = `transform ${dur}ms ${EASE}`;
      sheet.style.transform = `translate3d(0,${close ? window.innerHeight : 0}px,0)`;
      const el = sheet;
      setTimeout(() => {
        if (close) document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }));
        // Stile kurz nach dem Schließen zurücksetzen (setTimeout statt rAF: läuft auch, wenn das Bild gerade nicht malt)
        setTimeout(() => {
          el.style.transition = ''; el.style.transform = ''; el.style.willChange = '';
          if (sheet === el) sheet = null;
        }, 50);
      }, dur);
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
  }, []);
  return null;
}
