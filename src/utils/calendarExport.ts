// Kalender-Export (.ics) für "Meine Spiele": iPhone/Mac öffnen die Datei mit
// "Zum Kalender hinzufügen", Android (Google Kalender) importiert sie.
// - feste UID je Spiel: erneuter Import aktualisiert den Termin statt ihn zu doppeln
// - Zeiten in Europe/Berlin (mit VTIMEZONE), Spiele ohne Uhrzeit / mehrtägige Termine ganztägig
// - Dauer 2 Stunden, Erinnerung 1 Stunde vorher
import { Platform, Share } from 'react-native';

export interface CalendarGame {
  id: string;
  datum: string; // ISO YYYY-MM-DD (oder TT.MM.JJ)
  datumEnde?: string | null;
  zeit?: string | null; // "18:30"
  mannschaft?: string | null;
  art?: string | null;
  spiel: string; // "Heim - Gast" oder Event-Titel
  ort?: string | null;
  fussballDeUrl?: string | null;
  players?: string[]; // unsere Spieler in diesem Spiel
}

const VTIMEZONE_BERLIN = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Berlin',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

function toIso(d: string): string | null {
  const s = (d || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (!m) return null;
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

const ymd = (iso: string) => iso.replace(/-/g, '');

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Text-Escaping nach RFC 5545 */
function esc(s: string): string {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Zeilen über 75 Zeichen falten (Fortsetzung mit führendem Leerzeichen) */
function fold(line: string): string {
  if (line.length <= 73) return line;
  const parts: string[] = [];
  for (let i = 0; i < line.length; i += 73) parts.push((i ? ' ' : '') + line.slice(i, i + 73));
  return parts.join('\r\n');
}

export function buildIcs(games: CalendarGame[]): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//KMH Scouting//Meine Spiele//DE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Meine Spiele (Scouting)',
    ...VTIMEZONE_BERLIN,
  ];
  for (const g of games) {
    const start = toIso(g.datum);
    if (!start) continue;
    const end = g.datumEnde ? toIso(g.datumEnde) : null;
    const time = (g.zeit || '').match(/^(\d{1,2}):(\d{2})/);
    const [home, ...rest] = (g.spiel || '').split(' - ');
    const title = rest.length ? `${home} – ${rest.join(' - ')}` : g.spiel;
    const summary = [g.mannschaft && g.mannschaft !== 'Herren' ? g.mannschaft : '', title].filter(Boolean).join(' · ');
    const desc = [
      [g.mannschaft, g.art].filter(Boolean).join(' · '),
      g.players?.length ? `Unsere Spieler: ${g.players.join(', ')}` : '',
      g.fussballDeUrl || '',
    ].filter(Boolean).join('\n');

    lines.push('BEGIN:VEVENT', `UID:${g.id}@kmh-scouting`, `DTSTAMP:${stamp}`);
    if (time && !(end && end !== start)) {
      const h = parseInt(time[1], 10);
      const mi = time[2];
      const endH = h + 2;
      const endDate = endH >= 24 ? addDays(start, 1) : start;
      lines.push(
        `DTSTART;TZID=Europe/Berlin:${ymd(start)}T${String(h).padStart(2, '0')}${mi}00`,
        `DTEND;TZID=Europe/Berlin:${ymd(endDate)}T${String(endH % 24).padStart(2, '0')}${mi}00`,
      );
    } else {
      // Ganztägig (DTEND exklusiv = Tag nach dem letzten Tag)
      lines.push(`DTSTART;VALUE=DATE:${ymd(start)}`, `DTEND;VALUE=DATE:${ymd(addDays(end && end > start ? end : start, 1))}`);
    }
    lines.push(fold(`SUMMARY:${esc(summary)}`));
    if (g.ort) lines.push(fold(`LOCATION:${esc(g.ort)}`));
    if (desc) lines.push(fold(`DESCRIPTION:${esc(desc)}`));
    if (g.fussballDeUrl) lines.push(fold(`URL:${g.fussballDeUrl}`));
    if (time) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(summary)}`, 'TRIGGER:-PT1H', 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

/** .ics speichern/öffnen: Web = Download (Handy-Browser bietet "Zum Kalender hinzufügen"), nativ = Teilen-Menü */
export async function downloadIcs(games: CalendarGame[], filename: string): Promise<void> {
  const ics = buildIcs(games);
  if (Platform.OS === 'web') {
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return;
  }
  await Share.share({ title: filename, message: ics });
}
