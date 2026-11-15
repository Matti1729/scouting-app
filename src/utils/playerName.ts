// Nachname wie in der KMH-App: letztes Wort samt Namenszusatz ("van den Heuvel", "Ben Balla")
const NAME_PARTICLES = new Set(['van', 'von', 'de', 'da', 'di', 'del', 'der', 'den', 'dos', 'das', 'ter', 'ten', 'le', 'la', 'el', 'al', 'ben']);

export function splitPlayerName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return { first: '', last: full.trim() };
  let i = parts.length - 1;
  while (i > 1 && NAME_PARTICLES.has(parts[i - 1].toLowerCase())) i--;
  return { first: parts.slice(0, i).join(' '), last: parts.slice(i).join(' ') };
}
