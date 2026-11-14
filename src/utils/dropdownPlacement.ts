import { Dimensions } from 'react-native';

// Aufklapp-Listen (Dropdowns) im Bildschirm halten: auf dem Handy lief die Liste
// sonst rechts aus dem Bild, z. B. beim Fuß im Bewertungsbogen (Matti 2026-11-14).
const EDGE = 8;

export interface DropdownPlacement {
  top: number;
  left: number;
  minWidth: number;
  maxWidth: number;
}

/**
 * Position unter dem Knopf (x, y, w, h aus measureInWindow), mindestens minWidth breit, nie über den Rand.
 * align 'right': rechte Kante der Liste an der rechten Kante des Knopfs (beim Pfeil ▼).
 */
export function placeDropdown(x: number, y: number, w: number, h: number, minWidth: number, align: 'left' | 'right' = 'left'): DropdownPlacement {
  const screenW = Dimensions.get('window').width;
  const width = Math.min(Math.max(minWidth, align === 'right' ? 0 : w), screenW - 2 * EDGE);
  const wanted = align === 'right' ? x + w - width : x;
  const left = Math.max(EDGE, Math.min(wanted, screenW - width - EDGE));
  return { top: y + h + 4, left, minWidth: width, maxWidth: screenW - left - EDGE };
}
