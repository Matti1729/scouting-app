/** Farbe wie im Potential-Schiebebalken (1-3 rot, 4-6 orange, 7-9 grün, 10 gold) */
export function potentialColor(v: number): string {
  if (v === 10) return '#F0C040';
  if (v >= 7) return '#22c55e';
  if (v >= 4) return '#e8930c';
  return '#dc2626';
}
