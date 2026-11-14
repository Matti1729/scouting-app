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

/** Position unter dem Knopf (x, y, w, h aus measureInWindow), mindestens minWidth breit, nie über den Rand */
export function placeDropdown(x: number, y: number, w: number, h: number, minWidth: number): DropdownPlacement {
  const screenW = Dimensions.get('window').width;
  const width = Math.min(Math.max(w, minWidth), screenW - 2 * EDGE);
  const left = Math.max(EDGE, Math.min(x, screenW - width - EDGE));
  return { top: y + h + 4, left, minWidth: width, maxWidth: screenW - left - EDGE };
}
