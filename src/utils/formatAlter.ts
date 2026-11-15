/** "16 J. (08.03.10)" — Alter + Geburtsdatum kurz für die Alter-Spalte (Watchlist, Topscorer) */
export function formatAlter(birthDate: string | null): string {
  if (!birthDate) return '–';
  const parts = birthDate.split('.');
  if (parts.length !== 3) return birthDate;
  const birth = new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) {
    age--;
  }
  const short = birthDate.replace(/\.(\d{2})(\d{2})$/, '.$2');
  if (age < 10 || age > 50) return short; // unplausibel -> nur das Datum zeigen
  return `${age} J. (${short})`;
}
