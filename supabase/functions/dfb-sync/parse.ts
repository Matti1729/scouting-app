// dfb-sync/parse.ts — reine Parser-Logik (ohne Netz/DB), damit sie lokal mit
// `deno run` gegen echte DFB-Seiten getestet werden kann.
//
// Quellen (alle serverseitig gerendert, kein Browser nötig):
//  - Termine:   https://www.dfb.de/page-data/maenner/nationalmannschaften/u-16/spiele-und-termine/page-data.json
//               → Gatsby-page-data, darin ein m_richtext mit einer HTML-Tabelle
//                 (Datum | Uhrzeit | Veranstaltung | Ort [| TV])
//  - Team:      .../u-16/team/page-data.json
//               → Überschrift "Kader für …", m_data_center /lineups/{id}/people_list
//                 (aktueller Kader als HTML-Tabelle im Datencenter) und ein
//                 Akkordeon "Weitere Kader" mit PDF-Links (assets.dfb.de)

export interface DfbTermin {
  age: string;            // "U16"
  start: string;          // ISO "2026-08-17"
  end: string | null;     // ISO oder null (eintägig)
  time: string | null;    // "11:00" oder null (tbc/leer)
  title: string;          // Original-Veranstaltung ("Deutschland - Polen (LSP)")
  homeTeam: string;       // Spiel: Heim; Event: Titel ("Lehrgang")
  awayTeam: string;       // Spiel: Gast; Event: ""
  isGame: boolean;
  location: string | null;
  sourceKey: string;      // "U16|2026-08-17|lehrgang"
}

export interface DfbTerminePage {
  age: string;
  season: string | null;      // "2026/2027"
  seasonStartYear: number | null;
  jahrgang: string | null;    // "2011"
  termine: DfbTermin[];
}

export interface DfbKaderSource {
  age: string;
  kind: 'datencenter' | 'pdf';
  title: string;           // "Kader für den Lehrgang in Duisburg (17.-20.08.2026)"
  url: string;             // people_list-URL oder PDF-URL
  dates: string[];         // aus dem Titel extrahierte ISO-Daten (sortiert)
}

export interface DfbKaderPlayer {
  nummer: string | null;
  vorname: string;
  name: string;
  club: string | null;
  isGoalkeeper: boolean;
  profileUrl: string | null;
  games: number | null;
  goals: number | null;
  birthDate: string | null;   // "04.02.2010" falls bekannt
}

export const AGES = [15, 16, 17, 18, 19, 20, 21] as const;

export const termineUrl = (age: number) =>
  `https://www.dfb.de/page-data/maenner/nationalmannschaften/u-${age}/spiele-und-termine/page-data.json`;
export const teamUrl = (age: number) =>
  `https://www.dfb.de/page-data/maenner/nationalmannschaften/u-${age}/team/page-data.json`;

// ---------------------------------------------------------------------------
// Helfer
// ---------------------------------------------------------------------------

export function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/ /g, ' ');
}

export function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

const pad = (n: number | string) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Body-Komponenten (JSON-Strings) aus einer Gatsby-page-data.json ziehen */
export function pageBodyComponents(pageData: any): any[] {
  try {
    const content = JSON.parse(pageData.result.data.page.internal.content);
    const body: string[] = content?.content?.body || [];
    return body.map((b) => {
      try { return JSON.parse(b); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Termine
// ---------------------------------------------------------------------------

/**
 * Datumszelle der Termintabelle → [start, end].
 * Formen: "28.09.2026" | "17. – 20.08.2026" | "31.08. – 03.09.2026" |
 *         "22.09.-04.10.2026" | "06. - 16.01.2027" | "28.06. bis 11.07.2026"
 */
export function parseDateCell(raw: string): { start: string; end: string | null } | null {
  const s = decodeEntities(raw).replace(/[–—]/g, '-').replace(/\s*bis\s*/gi, '-').replace(/\s+/g, ' ').trim();
  let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return { start: iso(+m[3], +m[2], +m[1]), end: null };
  m = s.match(/^(\d{1,2})\.\s*(?:(\d{1,2})\.?)?\s*-\s*(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) {
    const endY = +m[5], endM = +m[4], endD = +m[3];
    const startD = +m[1];
    const startM = m[2] ? +m[2] : endM;
    const startY = startM > endM ? endY - 1 : endY;
    return { start: iso(startY, startM, startD), end: iso(endY, endM, endD) };
  }
  // Voll-Voll: "27.03.2027 - 30.03.2027"
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\s*-\s*(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return { start: iso(+m[3], +m[2], +m[1]), end: iso(+m[6], +m[5], +m[4]) };
  return null;
}

export function parseTimeCell(raw: string): string | null {
  const s = decodeEntities(raw).trim();
  const m = s.match(/(\d{1,2})[.:](\d{2})/);
  if (!m) return null;
  const h = +m[1], min = +m[2];
  if (h > 23 || min > 59) return null;
  return `${pad(h)}:${pad(min)}`;
}

/** "Deutschland - Polen (LSP)" → Spiel; "Lehrgang mit Länderspielen" → Event */
export function splitEvent(title: string): { isGame: boolean; home: string; away: string } {
  const t = title.replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
  const parts = t.split(/\s-\s/);
  if (parts.length === 2) {
    const home = parts[0].trim();
    const away = parts[1].replace(/\s*\([^)]*\)\s*$/, '').trim();
    if (home && away) return { isGame: true, home, away };
  }
  return { isGame: false, home: t, away: '' };
}

export function parseTerminePage(age: number, pageData: any): DfbTerminePage {
  const ageLabel = `U${age}`;
  const out: DfbTerminePage = { age: ageLabel, season: null, seasonStartYear: null, jahrgang: null, termine: [] };
  const comps = pageBodyComponents(pageData);
  const rich = comps.filter((c) => c.component === 'm_richtext' && /<table/i.test(c.text || ''));
  for (const c of rich) {
    const html: string = c.text;
    const plain = stripTags(html);
    const sm = plain.match(/Saison\s+(\d{4})\s*\/\s*(\d{2,4})/);
    if (sm && !out.season) {
      out.season = `${sm[1]}/${sm[2].length === 2 ? sm[1].slice(0, 2) + sm[2] : sm[2]}`;
      out.seasonStartYear = +sm[1];
    }
    const jm = plain.match(/Jahrgang\s+(\d{4})/);
    if (jm && !out.jahrgang) out.jahrgang = jm[1];

    const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
    for (const row of rows) {
      const cells = (row.match(/<td[^>]*>[\s\S]*?<\/td>/gi) || []).map((c) => stripTags(c));
      if (cells.length < 3) continue;
      const d = parseDateCell(cells[0]);
      if (!d) continue;
      const time = parseTimeCell(cells[1]);
      const title = cells[2];
      if (!title) continue;
      const locRaw = (cells[3] || '').trim();
      const location = locRaw && !/^(tbd|tba|n\.n\.?|-)$/i.test(locRaw) ? locRaw : null;
      const ev = splitEvent(title);
      out.termine.push({
        age: ageLabel,
        start: d.start,
        end: d.end,
        time,
        title,
        homeTeam: ev.home,
        awayTeam: ev.away,
        isGame: ev.isGame,
        location,
        sourceKey: `${ageLabel}|${d.start}|${slug(title)}`,
      });
    }
  }
  // Saison-Jahr notfalls aus den Terminen ableiten (U17-U21 nennen keine Saison)
  if (!out.seasonStartYear && out.termine.length) {
    const first = out.termine[0].start;
    const y = +first.slice(0, 4), m = +first.slice(5, 7);
    out.seasonStartYear = m >= 7 ? y : y - 1;
  }
  if (!out.season && out.seasonStartYear) out.season = `${out.seasonStartYear}/${out.seasonStartYear + 1}`;
  // Jahrgang: U15 in Saison 2026/27 = 2012, U16 = 2011 … → Saisonjahr + 1 − Alter
  if (!out.jahrgang && out.seasonStartYear) out.jahrgang = String(out.seasonStartYear + 1 - age);
  return out;
}

// ---------------------------------------------------------------------------
// Kader-Quellen (Team-Seite)
// ---------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  januar: 1, februar: 2, märz: 3, maerz: 3, april: 4, mai: 5, juni: 6, juli: 7,
  august: 8, september: 9, oktober: 10, november: 11, dezember: 12,
};

/**
 * Alle Daten aus einem deutschen Freitext ziehen, z. B.
 *  "Kader für die Länderspiele gegen die Niederlande am 5. und 7. Mai 2026 in Oldenzaal"
 *  "Kader für den Lehrgang in Schöneck (31.08-03.09.2026)"
 *  "… gegen die Tschechische Republik (23. März) in Berlin und Polen (31. März 2026) …"
 *  "Kader für die Europameisterschaft in Wales (28.06. bis 11.07.2026)"
 * Fehlende Monate/Jahre werden vom nächsten vollständigen Datum rechts übernommen;
 * fehlt auch das, greift das Saisonjahr.
 */
export function extractDates(text: string, seasonStartYear: number | null): string[] {
  const t = decodeEntities(text).replace(/[–—]/g, '-');
  type Tok = { day: number; month: number | null; year: number | null };
  const toks: Tok[] = [];
  const re = /(\d{1,2})\.\s*(?:(\d{1,2})(?!\d)\.?|(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember))?\s*(\d{4})?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const day = +m[1];
    if (day < 1 || day > 31) continue;
    let month: number | null = null;
    if (m[2]) month = +m[2];
    else if (m[3]) month = MONTHS[m[3].toLowerCase()] ?? null;
    if (month !== null && (month < 1 || month > 12)) continue;
    const year = m[4] ? +m[4] : null;
    // Reine Zahl wie "5." ohne Monat: nur zulassen, wenn ein Verbinder folgt (und/bis/-)
    if (month === null && !/^\s*(und|bis|-|\/|,)/i.test(t.slice(m.index + m[0].length))) continue;
    toks.push({ day, month, year });
  }
  // Rückwärts auffüllen: Monat/Jahr vom nächsten vollständigen Token rechts
  let nextMonth: number | null = null, nextYear: number | null = null;
  for (let i = toks.length - 1; i >= 0; i--) {
    const tk = toks[i];
    if (tk.month === null) tk.month = nextMonth;
    if (tk.year === null) tk.year = nextYear;
    if (tk.month !== null) nextMonth = tk.month;
    if (tk.year !== null) nextYear = tk.year;
  }
  const out: string[] = [];
  for (const tk of toks) {
    if (tk.month === null) continue;
    let y = tk.year;
    if (y === null) {
      if (seasonStartYear === null) continue;
      y = tk.month >= 7 ? seasonStartYear : seasonStartYear + 1;
    }
    out.push(iso(y, tk.month, tk.day));
  }
  return [...new Set(out)].sort();
}

export function parseTeamPage(age: number, pageData: any, seasonStartYear: number | null): DfbKaderSource[] {
  const ageLabel = `U${age}`;
  const comps = pageBodyComponents(pageData);
  const out: DfbKaderSource[] = [];
  let lastHeading = '';
  for (const c of comps) {
    if (c.component === 'm_richtext') {
      const txt = stripTags(c.text || '');
      if (/^Kader/i.test(txt)) lastHeading = txt;
    } else if (c.component === 'm_data_center' && /\/lineups\/\d+\/people_list/.test(c.path_segment || '')) {
      const title = lastHeading || `Aktueller Kader ${ageLabel}`;
      out.push({
        age: ageLabel,
        kind: 'datencenter',
        title,
        url: `https://datencenter.dfb.de${c.path_segment}`,
        dates: extractDates(title, seasonStartYear),
      });
    } else if (c.component === 'm_accordion_element') {
      for (const el of c.accordion_element || []) {
        const html: string = el.accordion_text || '';
        const linkRe = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
        let m: RegExpExecArray | null;
        while ((m = linkRe.exec(html))) {
          const url = decodeEntities(m[1]).trim();
          const title = stripTags(m[2]);
          if (!/\.pdf(\?|$)/i.test(url)) continue;
          out.push({ age: ageLabel, kind: 'pdf', title, url, dates: extractDates(title, seasonStartYear) });
        }
      }
    }
  }
  return out;
}

/** Termin passt zu einer Kader-Quelle, wenn sich die Zeiträume überschneiden */
export function kaderMatchesTermin(src: DfbKaderSource, t: DfbTermin): boolean {
  if (!src.dates.length) return false;
  const dMin = src.dates[0], dMax = src.dates[src.dates.length - 1];
  const tEnd = t.end || t.start;
  return t.start <= dMax && tEnd >= dMin;
}

// ---------------------------------------------------------------------------
// Kader-Inhalte
// ---------------------------------------------------------------------------

const PARTICLES = new Set(['van', 'von', 'de', 'da', 'del', 'della', 'di', 'do', 'dos', 'el', 'al', 'le', 'la', 'der', 'den', 'ten', 'ter', 'bin', 'ben']);

/** "Jacob Esser" → {vorname:"Jacob", name:"Esser"}; "Kevin van der Berg" → name "van der Berg" */
export function splitFullName(full: string): { vorname: string; name: string } {
  const parts = full.replace(/\s+/g, ' ').trim().split(' ');
  if (parts.length <= 1) return { vorname: '', name: parts[0] || '' };
  let i = parts.length - 1;
  while (i - 1 > 0 && PARTICLES.has(parts[i - 1].toLowerCase())) i--;
  return { vorname: parts.slice(0, i).join(' '), name: parts.slice(i).join(' ') };
}

/** Datencenter people_list (HTML-Tabelle: Funktion | Name | Geburtstag | Verein | Spiele | Tore) */
export function parsePeopleListHtml(html: string): DfbKaderPlayer[] {
  const out: DfbKaderPlayer[] = [];
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  let section = '';
  for (const row of rows) {
    const cellsHtml = row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || [];
    const cells = cellsHtml.map((c) => stripTags(c));
    if (cells.length === 1) { section = cells[0]; continue; }
    if (cells.length < 4) continue;
    if (/^Funktion$/i.test(cells[0])) continue; // Kopfzeile
    const [funktion, fullName, birth, club, games, goals] = cells;
    if (!fullName) continue;
    // Betreuer/Trainer (Funktion gesetzt oder Abschnitt ohne Spieler) überspringen
    if (funktion && funktion.trim()) continue;
    if (/trainer|betreuer|staff|arzt|physio/i.test(section)) continue;
    const link = row.match(/href="(https?:\/\/datencenter\.dfb\.de\/profil\/\d+)[^"]*"/i);
    const { vorname, name } = splitFullName(fullName);
    out.push({
      nummer: null,
      vorname,
      name,
      club: club || null,
      isGoalkeeper: /torh|torwart|goalkeeper/i.test(section),
      profileUrl: link ? link[1] : null,
      games: games && /^\d+$/.test(games) ? +games : null,
      goals: goals && /^\d+$/.test(goals) ? +goals : null,
      birthDate: birth && /\d{2}\.\d{2}\.\d{4}/.test(birth) ? birth : null,
    });
  }
  return out;
}

/**
 * Kader-PDF: Text-Items mit Koordinaten → Zeilen → Spalten nach Kopfzeile
 * (NUMMER | NACHNAME | VORNAME | VEREIN). Abschnitte TORHÜTER / FELDSPIELER.
 */
export interface PdfTextItem { str: string; x: number; y: number }

export function parseKaderPdfItems(items: PdfTextItem[]): DfbKaderPlayer[] {
  // Zeilen clustern (gleiche y ± 2)
  const rows: { y: number; items: PdfTextItem[] }[] = [];
  const sorted = [...items].filter((i) => i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  for (const it of sorted) {
    const r = rows.find((r) => Math.abs(r.y - it.y) <= 2.5);
    if (r) r.items.push(it); else rows.push({ y: it.y, items: [it] });
  }
  rows.forEach((r) => r.items.sort((a, b) => a.x - b.x));

  // Kopfzeile finden → Spalten-x
  let cols: { nummer: number; nachname: number; vorname: number; verein: number } | null = null;
  for (const r of rows) {
    const txt = r.items.map((i) => i.str.toUpperCase());
    const idx = (k: string) => r.items[txt.findIndex((s) => s.includes(k))];
    const n = idx('NUMMER'), nn = idx('NACHNAME'), vn = idx('VORNAME'), v = idx('VEREIN');
    if (nn && vn && v) { cols = { nummer: n ? n.x : -1, nachname: nn.x, vorname: vn.x, verein: v.x }; break; }
  }
  const out: DfbKaderPlayer[] = [];
  let section = '';
  for (const r of rows) {
    const line = r.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
    if (/^TORH/i.test(line)) { section = 'tw'; continue; }
    if (/^FELDSPIELER/i.test(line)) { section = 'fs'; continue; }
    if (/^(KADER|NUMMER|TRAINER|BETREUER|STAFF)/i.test(line)) continue;
    if (!section) continue;
    let nummer: string | null = null, nachname = '', vorname = '', verein = '';
    if (cols) {
      const c = cols;
      const bucket = (x: number) => {
        // Spalte = letzte Kopf-x, die <= x + Toleranz liegt
        const b = [['nummer', c.nummer], ['nachname', c.nachname], ['vorname', c.vorname], ['verein', c.verein]] as const;
        let best = b[0][0];
        for (const [k, cx] of b) if (cx >= 0 && x + 3 >= cx) best = k;
        return best;
      };
      const parts: Record<string, string[]> = { nummer: [], nachname: [], vorname: [], verein: [] };
      for (const it of r.items) parts[bucket(it.x)].push(it.str.trim());
      // Ziffern kommen teils als getrennte Items ("1","3") → ohne Leerzeichen zusammensetzen
      nummer = parts.nummer.join('').trim() || null;
      nachname = parts.nachname.join(' ').trim();
      vorname = parts.vorname.join(' ').trim();
      verein = parts.verein.join(' ').trim();
      // Nummer ohne eigene Spalte: steht evtl. am Anfang von "nachname"
      if (!nummer) {
        const m = nachname.match(/^(\d{1,2})\s+(.*)$/);
        if (m) { nummer = m[1]; nachname = m[2]; }
      }
    } else {
      // Fallback ohne Kopfzeile: "12 Nachname Vorname Verein" (unsicher bei Mehrfachnamen)
      const m = line.match(/^(\d{1,2})\s+(\S+)\s+(\S+)\s+(.+)$/);
      if (!m) continue;
      nummer = m[1]; nachname = m[2]; vorname = m[3]; verein = m[4];
    }
    if (!nachname || !/[a-zäöü]/i.test(nachname)) continue;
    // Die Zahl in DFB-Kaderlisten ist nur eine laufende Nummer, keine Rückennummer → nicht übernehmen
    out.push({
      nummer: null,
      vorname,
      name: nachname,
      club: verein || null,
      isGoalkeeper: section === 'tw',
      profileUrl: null,
      games: null,
      goals: null,
      birthDate: null,
    });
  }
  return out;
}

/** Stabiler Hash über den Kader-Inhalt (Änderungserkennung) */
export async function kaderHash(players: DfbKaderPlayer[]): Promise<string> {
  const norm = players
    .map((p) => `${p.name}|${p.vorname}|${p.club || ''}|${p.nummer || ''}|${p.isGoalkeeper ? 1 : 0}`)
    .sort()
    .join('\n');
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(norm));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Datencenter: Saisonplan einer Mannschaft (alle Spiele mit Link zur Spielseite)
// https://datencenter.dfb.de/teams/deutschland-u-20-m/seasonplan
// ---------------------------------------------------------------------------
export interface DfbSeasonGame {
  date: string;          // ISO "2026-09-25"
  time: string | null;   // "17:30"
  home: string;          // "Deutschland" (ohne "U 20 (m)")
  away: string;          // "Frankreich"
  url: string;           // Spielseite (…/saison/… oder …/spieltag/…)
}

export const seasonplanUrl = (age: number) =>
  `https://datencenter.dfb.de/teams/deutschland-u-${age}-m/seasonplan`;

/** "Deutschland U&nbsp;20 (m)" → "Deutschland" */
export function stripNationalTeamSuffix(s: string): string {
  return decodeEntities(s)
    .replace(/ /g, ' ')
    .replace(/\s*\(m\)\s*/gi, ' ')
    .replace(/\bU\s?-?\s?\d{2}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseSeasonplanHtml(html: string): DfbSeasonGame[] {
  const out: DfbSeasonGame[] = [];
  // Jede Spielzeile beginnt mit der Info-Zelle id="match_<id>"
  const chunks = html.split(/id="match_\d+"/).slice(1);
  for (const c of chunks) {
    const d = c.match(/(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}:\d{2}))?/);
    const homeHtml = c.match(/c-MatchTable-team--home[^>]*>([\s\S]*?)<\/div>/);
    const awayHtml = c.match(/c-MatchTable-team--away[^>]*>([\s\S]*?)<\/div>/);
    const link = c.match(/href="(https?:\/\/datencenter\.dfb\.de\/datencenter\/[^"]*\/(?:saison|spieltag)\/[^"?]+)/);
    if (!d || !homeHtml || !awayHtml || !link) continue;
    out.push({
      date: `${d[3]}-${d[2]}-${d[1]}`,
      time: d[4] || null,
      home: stripNationalTeamSuffix(stripTags(homeHtml[1])),
      away: stripNationalTeamSuffix(stripTags(awayHtml[1])),
      url: link[1],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Datencenter: Aufstellung einer Spielseite (Tabellen "Aufstellung" und
// "Auswechselspieler", je Zeile Heim-Spieler | Nr | Rolle | Nr | Gast-Spieler)
// ---------------------------------------------------------------------------
export interface DfbLineupPlayer {
  nummer: string | null;
  vorname: string;
  name: string;
  isGoalkeeper: boolean;
  profileUrl: string | null;
}
export interface DfbMatchLineup {
  homeName: string;      // "Schweiz"
  awayName: string;      // "Deutschland"
  homeStarters: DfbLineupPlayer[];
  homeSubs: DfbLineupPlayer[];
  awayStarters: DfbLineupPlayer[];
  awaySubs: DfbLineupPlayer[];
}

function lineupPerson(cellHtml: string, nummer: string | null): DfbLineupPlayer | null {
  const link = cellHtml.match(/href="(https?:\/\/datencenter\.dfb\.de\/profil\/\d+)[^"]*"/i);
  let text = stripTags(cellHtml).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const isGoalkeeper = /\(\s*T\s*\)/i.test(text);
  text = text.replace(/\(\s*[A-Z]{1,3}\s*\)/g, '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const { vorname, name } = splitFullName(text);
  return { nummer, vorname, name, isGoalkeeper, profileUrl: link ? link[1] : null };
}

export function parseMatchLineupHtml(html: string): DfbMatchLineup | null {
  const tables = html.match(/<table[^>]*>[\s\S]*?<\/table>/gi) || [];
  const res: DfbMatchLineup = { homeName: '', awayName: '', homeStarters: [], homeSubs: [], awayStarters: [], awaySubs: [] };
  let any = false;
  for (const t of tables) {
    if (!/m-MatchDetails-lineup/.test(t)) continue;
    const title = (t.match(/m-MatchDetails-title[^>]*>\s*([^<]+)/) || [])[1]?.trim() || '';
    const isSubs = /auswechsel|ersatz|bank/i.test(title);
    const alts = [...t.matchAll(/m-MatchDetails-lineup-emblem[^>]*alt="([^"]+)"/g)].map((m) => stripNationalTeamSuffix(m[1]));
    if (!res.homeName && alts[0]) res.homeName = alts[0];
    if (!res.awayName && alts[1]) res.awayName = alts[1];
    for (const row of t.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || []) {
      const hp = row.match(/lineup-person--home[^>]*>([\s\S]*?)<\/td>/);
      const ap = row.match(/lineup-person--away[^>]*>([\s\S]*?)<\/td>/);
      const hn = row.match(/lineup-number--home[^>]*>\s*([^<]*?)\s*<\/td>/);
      const an = row.match(/lineup-number--away[^>]*>\s*([^<]*?)\s*<\/td>/);
      if (!hp && !ap) continue;
      // Zeilen mit Rolle (Trainer/in, Formation) sind keine Spieler
      const role = row.match(/lineup-role[^>]*>([\s\S]*?)<\/td>/);
      if (role && stripTags(role[1]).trim()) continue;
      const h = hp ? lineupPerson(hp[1], hn && hn[1].trim() ? hn[1].trim() : null) : null;
      const a = ap ? lineupPerson(ap[1], an && an[1].trim() ? an[1].trim() : null) : null;
      if (h) { (isSubs ? res.homeSubs : res.homeStarters).push(h); any = true; }
      if (a) { (isSubs ? res.awaySubs : res.awayStarters).push(a); any = true; }
    }
  }
  return any ? res : null;
}
