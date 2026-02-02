// fussballDeService.ts - Integration mit fussball.de
// Holt Spieldaten von fussball.de URLs

// Supabase Edge Function Proxy URL (gleicher wie in KMH-App)
const SUPABASE_PROXY_URL = 'https://ozggtruvnwozhwjbznsm.supabase.co/functions/v1/proxy';

// Supabase Edge Function für Aufstellungen (mit Browserless.io)
const SCRAPE_LINEUP_URL = 'https://ozggtruvnwozhwjbznsm.supabase.co/functions/v1/scrape-lineup';

// API Token für fussball.de (aus KMH-App Supabase)
const FUSSBALL_DE_API_TOKEN = 'r1S7u6K7w6s8Y31448X9o5e9S4hF1b83w7G0JWqZnl';

export interface MatchData {
  homeTeam: string;
  awayTeam: string;
  date: string;        // Deutsches Format: TT.MM.JJJJ
  time: string;        // HH:MM format
  league?: string;
  matchday?: string;
  location?: string;
  matchType?: string;  // Punktspiel, Pokalspiel, Freundschaftsspiel, Turnier, Hallenturnier
  result?: string;     // z.B. "2:1"
  ageGroup?: string;   // U14, U15, U16, U17, U19, Herren
}

// Debug-Info für Scraping-Fehler
export interface ScrapeDebug {
  htmlSnippet?: string;      // Relevanter HTML-Ausschnitt (max 500 Zeichen)
  locationHtml?: string;     // HTML um class="location" herum
  foundPatterns?: string[];  // Welche Patterns gematcht haben
  url: string;
}

// Erweiterter Rückgabetyp mit Debug-Info
export interface ScrapeResult {
  success: boolean;
  data?: MatchData;
  error?: string;
  debug?: ScrapeDebug;
}

export interface PlayerLineupData {
  nummer: string;
  vorname: string;
  name: string;
  position: string;
  jahrgang: string;
}

export interface LineupsData {
  homeStarters: PlayerLineupData[];
  homeSubs: PlayerLineupData[];
  awayStarters: PlayerLineupData[];
  awaySubs: PlayerLineupData[];
  available: boolean;
  result?: string;
}

// Match-ID aus fussball.de URL extrahieren
// URL Format: https://www.fussball.de/spiel/[name]/-/spiel/[MATCH_ID]
export function extractMatchId(fussballDeUrl: string): string | null {
  if (!fussballDeUrl) return null;

  // URL Format: /spiel/[MATCH_ID] am Ende
  const matchIdPattern = /\/spiel\/([A-Z0-9]+)(?:[\/\?#]|$)/i;
  const match = fussballDeUrl.match(matchIdPattern);

  if (match) {
    return match[1];
  }

  return null;
}

// Team-ID aus fussball.de URL extrahieren (für Team-Seiten)
export function extractTeamId(fussballDeUrl: string): string | null {
  if (!fussballDeUrl) return null;

  const teamIdMatch = fussballDeUrl.match(/team-id\/([A-Z0-9]+)/i);
  if (teamIdMatch) {
    return teamIdMatch[1];
  }

  const altMatch = fussballDeUrl.match(/\/([A-Z0-9]{20,})(?:\?|#|$)/i);
  if (altMatch) {
    return altMatch[1];
  }

  return null;
}

// Deutsches Datum "Sa, 25.01.2025" oder "25.01.2025" in deutsches Format TT.MM.JJJJ umwandeln
function extractGermanDate(germanDate: string): string {
  if (!germanDate) return '';

  // Entferne Wochentag falls vorhanden
  const cleanDate = germanDate.replace(/^[A-Za-z]{2},?\s*/, '');

  // Format: DD.MM.YYYY
  const match = cleanDate.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (match) {
    const day = match[1].padStart(2, '0');
    const month = match[2].padStart(2, '0');
    const year = match[3];
    return `${day}.${month}.${year}`;
  }

  // Format: DD.MM.YY
  const shortMatch = cleanDate.match(/(\d{1,2})\.(\d{1,2})\.(\d{2})/);
  if (shortMatch) {
    const day = shortMatch[1].padStart(2, '0');
    const month = shortMatch[2].padStart(2, '0');
    const year = parseInt(shortMatch[3]) > 50 ? `19${shortMatch[3]}` : `20${shortMatch[3]}`;
    return `${day}.${month}.${year}`;
  }

  // Falls bereits ISO Format, in deutsches Format umwandeln
  if (/^\d{4}-\d{2}-\d{2}$/.test(germanDate)) {
    const [year, month, day] = germanDate.split('-');
    return `${day}.${month}.${year}`;
  }

  return '';
}

// Team-Namen formatieren mit Abkürzungen
export function formatTeamName(name: string): string {
  if (!name) return '';

  let formatted = name;

  // Bekannte Langformen zu Kürzeln
  const abbreviations: Record<string, string> = {
    'Sport-Club': 'SC',
    'Sportclub': 'SC',
    'Fußball-Club': 'FC',
    'Fussball-Club': 'FC',
    'Fußballclub': 'FC',
    'Fussballclub': 'FC',
    'Sportverein': 'SV',
    'Sport-Verein': 'SV',
    'Turn- und Sportverein': 'TSV',
    'Turnverein': 'TV',
    'Ballspielverein': 'BV',
    'Ballspiel-Verein': 'BV',
    'Verein für Bewegungsspiele': 'VfB',
    'Verein für Leibesübungen': 'VfL',
    'Rasenballsport': 'RB',
    'Rasenball': 'RB',
    'Rot-Weiss': 'RW',
    'Rot-Weiß': 'RW',
    'Schwarz-Weiss': 'SW',
    'Schwarz-Weiß': 'SW',
    'Blau-Weiss': 'BW',
    'Blau-Weiß': 'BW',
    'Sportfreunde': 'SF',
    'Spielvereinigung': 'SpVgg',
    'Sportgemeinschaft': 'SG',
    'Turn- und Spielvereinigung': 'TSG',
    'Turngemeinde': 'TG',
  };

  // Ersetze Langformen durch Kürzel (case-insensitive)
  for (const [long, short] of Object.entries(abbreviations)) {
    const regex = new RegExp(long, 'gi');
    formatted = formatted.replace(regex, short);
  }

  // Entferne Mannschaftsnummern und Altersklassen am Ende
  // Diese sind redundant wenn die Altersklasse separat angezeigt wird
  formatted = formatted
    .replace(/\s+U\d{2}\s*2?$/i, '') // " U16", " U16 2", " U19" am Ende
    .replace(/\s+2$/, '')            // " 2" am Ende
    .replace(/\s+II$/, '')           // " II" am Ende
    .replace(/\s*\(2\)$/, '')        // "(2)" am Ende
    .replace(/\s*\(II\)$/, '')       // "(II)" am Ende
    .trim();

  return formatted;
}

// Altersklasse aus Liga-Name oder Team-Namen extrahieren
export function extractAgeGroup(league: string, homeTeam?: string, awayTeam?: string): string {
  // Kombiniere alle verfügbaren Infos
  const combined = `${league} ${homeTeam || ''} ${awayTeam || ''}`.toLowerCase();

  // Prüfe auf Altersklassen-Patterns
  if (combined.match(/\bu14\b/)) return 'U14';
  if (combined.match(/\bu15\b/)) return 'U15';
  if (combined.match(/\bu16\b/)) return 'U16';
  if (combined.match(/\bu17\b/)) return 'U17';
  if (combined.match(/\bu18\b/)) return 'U17'; // U18 → U17 (nächste verfügbare)
  if (combined.match(/\bu19\b/)) return 'U19';
  if (combined.match(/\bu2[0-3]\b/)) return 'Herren'; // U20-U23 sind eher Herren-Niveau

  // Prüfe auf Jugend-Bezeichnungen
  if (combined.match(/a-jugend|a-junioren/)) return 'U19';
  if (combined.match(/b-jugend|b-junioren/)) return 'U17';
  if (combined.match(/c-jugend|c-junioren/)) return 'U15';
  if (combined.match(/d-jugend|d-junioren/)) return 'U14';

  return 'Herren'; // Default
}

// Datum in Display-Format umwandeln (mit Wochentag)
// Akzeptiert: DD.MM.YYYY (deutsch) oder YYYY-MM-DD (ISO)
export function formatDateForDisplay(dateStr: string): string {
  if (!dateStr) return '';

  let day: number, month: number, year: number;

  // Prüfe ob deutsches Format (DD.MM.YYYY)
  const germanMatch = dateStr.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (germanMatch) {
    day = parseInt(germanMatch[1]);
    month = parseInt(germanMatch[2]) - 1; // JS months are 0-indexed
    year = parseInt(germanMatch[3]);
  } else {
    // Ansonsten ISO Format (YYYY-MM-DD)
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr; // Ungültiges Datum, zurückgeben wie es ist
    day = date.getDate();
    month = date.getMonth();
    year = date.getFullYear();
  }

  const date = new Date(year, month, day);
  const days = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const dayName = days[date.getDay()];
  const dd = String(day).padStart(2, '0');
  const mm = String(month + 1).padStart(2, '0');

  return `${dayName}, ${dd}.${mm}.${year}`;
}

// Spieldaten von fussball.de URL abrufen
export async function fetchMatchFromUrl(
  fussballDeUrl: string,
  apiToken?: string
): Promise<ScrapeResult> {
  try {
    const matchId = extractMatchId(fussballDeUrl);

    if (!matchId) {
      return {
        success: false,
        error: 'Konnte keine Spiel-ID aus der URL extrahieren. Bitte prüfe die URL.'
      };
    }

    // Verwende den gespeicherten Token oder den übergebenen
    const token = apiToken || FUSSBALL_DE_API_TOKEN;

    // Versuche zuerst die API für Spieldetails
    const apiUrl = `https://api-fussball.de/api/match/${matchId}`;
    const proxyUrl = `${SUPABASE_PROXY_URL}?type=fussball&url=${encodeURIComponent(apiUrl)}`;

    console.log('Fetching match data from API:', apiUrl);

    const response = await fetch(proxyUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-token': token,
      },
    });

    if (response.ok) {
      const result = await response.json();

      if (result.success && result.data) {
        const game = result.data;
        const homeTeam = game.homeTeam || game.heimmannschaft || game.home || '';
        const awayTeam = game.awayTeam || game.gastmannschaft || game.away || '';
        const league = game.competition || game.league || game.liga || game.wettbewerb || '';

        return {
          success: true,
          data: {
            homeTeam: formatTeamName(homeTeam),
            awayTeam: formatTeamName(awayTeam),
            date: extractGermanDate(game.date || game.datum || ''),
            time: game.time || game.uhrzeit || '',
            league,
            matchday: game.matchday || game.spieltag || '',
            location: game.location || game.ort || game.spielort || '',
            matchType: determineMatchType(league),
            ageGroup: extractAgeGroup(league, homeTeam, awayTeam),
          },
        };
      }
    }

    // Versuche die fussball.de Seite direkt zu laden und zu parsen
    console.log('API failed, trying to scrape page directly...');
    const scrapeResult = await scrapeMatchPage(fussballDeUrl);
    if (scrapeResult.success && scrapeResult.data) {
      return scrapeResult;
    }

    // Fallback: Versuche Daten aus der URL zu parsen
    return parseMatchFromUrl(fussballDeUrl);

  } catch (err) {
    console.error('Fehler beim Abrufen der Spieldaten:', err);
    return {
      success: false,
      error: 'Fehler beim Abrufen der Spieldaten. Bitte manuell eingeben.'
    };
  }
}

// Versuche die fussball.de Seite zu scrapen
async function scrapeMatchPage(url: string): Promise<ScrapeResult> {
  try {
    // Lade die Seite über den Proxy (type=transfermarkt für Browser-Headers)
    const proxyUrl = `${SUPABASE_PROXY_URL}?type=transfermarkt&url=${encodeURIComponent(url)}`;

    console.log('Scraping fussball.de page:', url);

    const response = await fetch(proxyUrl, {
      method: 'GET',
    });

    if (!response.ok) {
      console.log('Scraping failed:', response.status);
      return { success: false, error: 'Konnte Seite nicht laden' };
    }

    const html = await response.text();
    console.log('Got HTML, length:', html.length);

    // Parse HTML nach Spielinformationen

    // Teams aus dem Title-Tag: "Team1 - Team2 Ergebnis: Liga - ..."
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    let homeTeam = '';
    let awayTeam = '';
    let league = '';

    if (titleMatch) {
      const title = titleMatch[1];
      console.log('Page title:', title);

      // Format: "Team1 - Team2 Ergebnis: Liga - Kategorie - Datum"
      // Der Trenner zwischen Teams ist " - " (mit Leerzeichen), nicht nur "-"
      // Beispiel: "Sport-Club Freiburg - 1. FC Köln Ergebnis: ..."
      const teamsMatch = title.match(/^(.+?)\s+-\s+(.+?)(?:\s+Ergebnis|\s*\|)/);
      if (teamsMatch) {
        homeTeam = teamsMatch[1].trim();
        awayTeam = teamsMatch[2].trim();
      }

      // Liga aus Title - VERBESSERT: Erlaube Bindestriche in Liga-Namen wie "B-Junioren Regional-FS"
      // Stoppe erst bei " - " (mit Leerzeichen) statt bei jedem "-"
      const leagueMatch = title.match(/Ergebnis:\s*(.+?)\s+-\s+/);
      if (leagueMatch) {
        league = leagueMatch[1].trim();
        console.log('Extracted league from title:', league);
      }
    }

    // Datum: Suche nach Mustern wie "25.01.2026" im Kontext von Spielinfo
    // Typischerweise im Format: "Sa, 25.01.2026" oder "25.01.2026"
    let date = '';
    const datePatterns = [
      /data-date="(\d{4}-\d{2}-\d{2})"/,  // data-attribute (ISO)
      /"date":\s*"(\d{4}-\d{2}-\d{2})"/,   // JSON (ISO)
      /(\d{1,2}\.\d{1,2}\.\d{4})/,          // German format
    ];

    for (const pattern of datePatterns) {
      const match = html.match(pattern);
      if (match) {
        // Konvertiere zu deutschem Format TT.MM.JJJJ
        date = extractGermanDate(match[1]);
        if (date) break;
      }
    }

    // Uhrzeit: Suche nach Anstoßzeit (NICHT Magazin-Zeiten!)
    // fussball.de verwendet verschiedene Formate:
    // - "25.01.2026 17:30" (Datum + Zeit im HTML)
    // - "SONNTAG, 25.01.2026, 17:30 UHR" (sichtbar auf Seite)
    // - "20:31Uhr" (ohne Leerzeichen, bei gespielten Spielen)
    // ACHTUNG: "Magazin DD.MM.YYYY | HH:MM" sind Artikel-Zeiten (mit Pipe!)
    let time = '';

    // Spezielle Suche für Datum+Zeit Format (ohne Pipe!)
    // Finde alle "DD.MM.YYYY HH:MM" Muster und nehme das erste OHNE Pipe
    const dateTimeMatches = html.match(/\d{1,2}\.\d{1,2}\.\d{4}[^|]{0,5}(\d{1,2}:\d{2})/g);
    if (dateTimeMatches) {
      for (const match of dateTimeMatches) {
        // Überspringe Magazin-Zeiten (enthalten Pipe)
        if (match.includes('|')) continue;
        // Extrahiere die Zeit
        const timeMatch = match.match(/(\d{1,2}:\d{2})$/);
        if (timeMatch) {
          time = timeMatch[1];
          console.log('Found time from date+time pattern:', time);
          break;
        }
      }
    }

    // Fallback: Andere Patterns probieren
    if (!time) {
      const timePatterns = [
        /,\s*(\d{1,2}:\d{2})\s*UHR/i,         // ", 17:30 UHR"
        /(\d{1,2}:\d{2})\s+UHR/i,             // "17:30 UHR" (mit Leerzeichen)
        /Anpfiff[:\s]*(\d{1,2}:\d{2})/i,      // "Anpfiff: 20:31"
        /Anstoß[:\s]*(\d{1,2}:\d{2})/i,       // "Anstoß: 15:30"
        /Anstoss[:\s]*(\d{1,2}:\d{2})/i,      // "Anstoss: 15:30"
        /data-time="(\d{1,2}:\d{2})"/,        // data-attribute
        /"time":\s*"(\d{1,2}:\d{2})"/,        // JSON
        /<span>(\d{1,2}:\d{2})Uhr<\/span>/,   // <span>20:31Uhr</span>
        />(\d{1,2}:\d{2})Uhr</,               // >20:31Uhr<
      ];

      for (const pattern of timePatterns) {
        const match = html.match(pattern);
        if (match) {
          time = match[1];
          console.log('Found time with fallback pattern:', pattern, '-> ', time);
          break;
        }
      }
    }

    // Spielort/Location extrahieren
    // fussball.de Format:
    // <a href="https://www.google.de/maps?q=..." class="location" target="_blank">
    //   Rasenplatz, Millerntor-Stadion, Harald-Stender-Platz 1, 20359 Hamburg
    //   <span class="icon-location"></span>
    // </a>
    let location = '';
    const triedLocationPatterns: string[] = [];
    let locationHtmlSnippet = '';

    // Exaktes Pattern für fussball.de Location-Link
    const locationLinkPattern = /<a[^>]*class="location"[^>]*>\s*([^<]+?)\s*<span/i;
    triedLocationPatterns.push('class="location"');
    const locationMatch = html.match(locationLinkPattern);
    if (locationMatch && locationMatch[1]) {
      location = locationMatch[1].trim()
        .replace(/&amp;/g, '&')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      console.log('Found location from class="location":', location);
    }

    // Fallback: Google Maps Link parsen
    if (!location) {
      triedLocationPatterns.push('Google Maps href');
      const mapsLinkPattern = /href="https?:\/\/(?:www\.)?google\.[a-z]+\/maps\?q=([^"]+)"/i;
      const mapsMatch = html.match(mapsLinkPattern);
      if (mapsMatch && mapsMatch[1]) {
        location = decodeURIComponent(mapsMatch[1].replace(/\+/g, ' ')).trim();
        console.log('Found location from Google Maps link:', location);
      }
    }

    // Debug: HTML-Ausschnitt um "location" speichern wenn nicht gefunden
    if (!location) {
      // Suche nach class="location" im HTML und extrahiere Kontext
      const locationClassIndex = html.indexOf('class="location"');
      if (locationClassIndex !== -1) {
        const start = Math.max(0, locationClassIndex - 100);
        const end = Math.min(html.length, locationClassIndex + 400);
        locationHtmlSnippet = html.substring(start, end);
      } else {
        // Suche nach google.de/maps für alternativen Kontext
        const mapsIndex = html.indexOf('google.de/maps');
        if (mapsIndex !== -1) {
          const start = Math.max(0, mapsIndex - 100);
          const end = Math.min(html.length, mapsIndex + 400);
          locationHtmlSnippet = html.substring(start, end);
        }
      }
      console.log('Location not found. Tried patterns:', triedLocationPatterns);
    }

    // Ergebnis extrahieren
    // Das Endergebnis ist leider obfuskiert, aber das Halbzeitergebnis steht im Klartext
    let result = '';

    // Versuche zuerst das Halbzeitergebnis: <span class="half-result">[0 : 1]</span>
    const halfResultMatch = html.match(/class="half-result"[^>]*>\[(\d+)\s*:\s*(\d+)\]/i);
    if (halfResultMatch) {
      // Halbzeitergebnis gefunden - nutze es als Hinweis dass Spiel beendet ist
      // Das echte Endergebnis müsste separat eingegeben werden
      console.log('Found half-time result:', halfResultMatch[1], ':', halfResultMatch[2]);
    }

    // Team-Namen formatieren mit Abkürzungen (Sport-Club → SC)
    const formattedHomeTeam = formatTeamName(homeTeam);
    const formattedAwayTeam = formatTeamName(awayTeam);

    console.log('Scraped data:', { homeTeam: formattedHomeTeam, awayTeam: formattedAwayTeam, date, time, league, result });

    if (formattedHomeTeam && formattedAwayTeam) {
      // Extrahiere Altersklasse aus Liga oder Teamnamen
      const ageGroup = extractAgeGroup(league, homeTeam, awayTeam);
      console.log('Extracted age group:', ageGroup, 'from league:', league);

      // Debug-Info nur wenn Location nicht gefunden
      const debug: ScrapeDebug | undefined = !location ? {
        locationHtml: locationHtmlSnippet || 'Keine location-Elemente gefunden',
        foundPatterns: triedLocationPatterns,
        url,
      } : undefined;

      return {
        success: true,
        data: {
          homeTeam: formattedHomeTeam,
          awayTeam: formattedAwayTeam,
          date,
          time,
          league,
          location,
          matchType: determineMatchType(league),
          result: result || undefined,
          ageGroup,
        },
        debug,
      };
    }

    return {
      success: false,
      error: 'Konnte Daten nicht aus Seite extrahieren',
      debug: {
        htmlSnippet: html.substring(0, 500),
        url,
      },
    };

  } catch (err) {
    console.error('Scraping error:', err);
    return {
      success: false,
      error: 'Fehler beim Laden der Seite',
      debug: { url },
    };
  }
}

// Versuche Spieldaten aus der URL zu parsen (Fallback)
function parseMatchFromUrl(url: string): { success: boolean; data?: MatchData; error?: string } {
  try {
    // URL Format: /spiel/[team1]-[team2]/-/spiel/[ID]
    // Beispiele:
    // - /spiel/fc-energie-cottbus-u16-tennis-borussia-berlin-u16/-/spiel/...
    // - /spiel/sport-club-freiburg-1-fc-koeln/-/spiel/...

    const pathMatch = url.match(/\/spiel\/([^\/]+)\/-\/spiel\//i);
    if (!pathMatch) {
      return { success: false, error: 'URL-Format nicht erkannt' };
    }

    const matchPart = pathMatch[1];

    // Prioritäts-Patterns: Diese starten DEFINITIV ein neues Team (mit Zahl vorne)
    const priorityPatterns = [
      '-1-fc-', '-1-fsv-', '-1-ffc-', '-1-sv-',
    ];

    // Suche zuerst nach Prioritäts-Patterns
    let bestSplitIndex = -1;

    for (const pattern of priorityPatterns) {
      const index = matchPart.indexOf(pattern);
      if (index > 3) { // Mindestens ein paar Zeichen für Team 1
        bestSplitIndex = index + 1; // +1 um das führende "-" zu überspringen
        break;
      }
    }

    // Wenn kein Prioritäts-Pattern gefunden, suche nach normalen Patterns
    if (bestSplitIndex === -1) {
      // Bekannte Vereinsnamen-Muster die einen neuen Verein einleiten
      const teamStartPatterns = [
        'fc-', 'sv-', 'tsg-', 'vfb-', 'vfl-', 'sc-', 'fsv-', 'bsc-', 'ssc-',
        'rb-', 'rw-', 'sw-', 'bv-', 'tsv-', 'spvgg-',
        'borussia-', 'bayern-', 'hertha-', 'eintracht-', 'fortuna-', 'arminia-',
        'tennis-', 'viktoria-', 'alemannia-', 'energie-', 'dynamo-', 'hansa-',
        'union-', 'werder-', 'schalke-', 'hoffenheim-', 'mainz-',
        'koeln-', 'köln-', 'leverkusen-', 'dortmund-', 'gladbach-', 'wolfsburg-',
        'augsburg-', 'bremen-', 'hamburg-', 'hannover-', 'nuernberg-', 'nürnberg-',
        'kaiserslautern-', 'stuttgart-', 'berlin-', 'muenchen-', 'münchen-',
      ];

      let bestPatternLength = 0;

      for (const pattern of teamStartPatterns) {
        // Suche nach "-pattern" um sicherzustellen dass es ein Wortanfang ist
        const searchPattern = '-' + pattern;
        const index = matchPart.indexOf(searchPattern);
        if (index > 3 && pattern.length > bestPatternLength) {
          bestSplitIndex = index + 1; // +1 um das führende "-" zu überspringen
          bestPatternLength = pattern.length;
        }
      }
    }

    // Fallback: Mitte
    if (bestSplitIndex === -1) {
      const words = matchPart.split('-');
      const midPoint = Math.ceil(words.length / 2);
      const homeTeam = words.slice(0, midPoint).join('-');
      const awayTeam = words.slice(midPoint).join('-');
      bestSplitIndex = homeTeam.length + 1;
    }

    // Teile den String
    const homeTeamRaw = matchPart.substring(0, bestSplitIndex).replace(/-$/, '');
    const awayTeamRaw = matchPart.substring(bestSplitIndex);

    // Formatiere URL-Team-Namen (aus URL-Slug wie "sport-club-freiburg")
    const formatUrlTeamName = (name: string) => {
      // Zuerst Umlaute konvertieren
      let formatted = name
        .replace(/oe/g, 'ö')
        .replace(/ae/g, 'ä')
        .replace(/ue/g, 'ü')
        .replace(/Oe/g, 'Ö')
        .replace(/Ae/g, 'Ä')
        .replace(/Ue/g, 'Ü');

      // Bekannte URL-Langformen zu Kürzeln
      const abbreviations: Record<string, string> = {
        'sport-club': 'SC',
        'sportclub': 'SC',
        'fussball-club': 'FC',
        'fussballclub': 'FC',
        'sportverein': 'SV',
        'sport-verein': 'SV',
        'turn-und-sportverein': 'TSV',
        'turnverein': 'TV',
        'ballspielverein': 'BV',
        'ballspiel-verein': 'BV',
        'verein-für-bewegungsspiele': 'VfB',
        'verein-fuer-bewegungsspiele': 'VfB',
        'verein-für-leibesübungen': 'VfL',
        'verein-fuer-leibesuebungen': 'VfL',
        'rasenballsport': 'RB',
        'rasenball': 'RB',
        'rot-weiss': 'RW',
        'rot-weiß': 'RW',
        'schwarz-weiss': 'SW',
        'schwarz-weiß': 'SW',
        'blau-weiss': 'BW',
        'blau-weiß': 'BW',
        'sportfreunde': 'SF',
        'spielvereinigung': 'SpVgg',
        'sportgemeinschaft': 'SG',
      };

      // Ersetze Langformen durch Kürzel
      for (const [long, short] of Object.entries(abbreviations)) {
        const regex = new RegExp(long, 'gi');
        formatted = formatted.replace(regex, short);
      }

      let result = formatted
        .split('-')
        .map(word => {
          // Spezialfälle für Abkürzungen (bereits gekürzte)
          const upperAbbrevs = ['fc', 'sv', 'sc', 'vfb', 'vfl', 'tsg', 'fsv', 'bsc', 'rb', 'bv', 'tsv', 'rw', 'sw', 'bw', 'sf', 'sg', 'tv', 'ssc', 'ffc'];
          if (upperAbbrevs.includes(word.toLowerCase())) {
            return word.toUpperCase();
          }
          // SpVgg bleibt so
          if (word.toLowerCase() === 'spvgg') {
            return 'SpVgg';
          }
          // Zahlen behalten
          if (/^\d+$/.test(word)) {
            return word + '.';
          }
          return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        })
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      // Entferne Altersklassen und Mannschaftsnummern am Ende
      result = result
        .replace(/\s+U\d{2}\s*2?$/i, '') // " U16", " U16 2" am Ende
        .replace(/\s+2$/, '')            // " 2" am Ende
        .replace(/\s+II$/, '')           // " II" am Ende
        .trim();

      return result;
    };

    const homeTeam = formatUrlTeamName(homeTeamRaw);
    const awayTeam = formatUrlTeamName(awayTeamRaw);

    return {
      success: true,
      data: {
        homeTeam,
        awayTeam,
        date: '',
        time: '',
        matchType: 'Punktspiel',
        ageGroup: extractAgeGroup('', homeTeamRaw, awayTeamRaw),
      },
    };

  } catch (err) {
    return { success: false, error: 'Fehler beim Parsen der URL' };
  }
}

// Bestimme Spieltyp basierend auf Liga/Wettbewerb
function determineMatchType(league: string): string {
  const leagueLower = league.toLowerCase();

  console.log('Determining match type for league:', league);

  if (leagueLower.includes('pokal')) {
    return 'Pokalspiel';
  }
  // ERWEITERT: Auch "FS" (Abkürzung), "friendly" und "Regional-FS" erkennen
  if (leagueLower.includes('freundschaft') || leagueLower.includes('test') ||
      leagueLower.includes('friendly') || leagueLower.match(/\bfs\b/) ||
      leagueLower.includes('-fs') || leagueLower.includes('fs-')) {
    return 'Freundschaftsspiel';
  }
  if (leagueLower.includes('halle') && leagueLower.includes('turnier')) {
    return 'Hallenturnier';
  }
  if (leagueLower.includes('turnier')) {
    return 'Turnier';
  }
  if (leagueLower.includes('liga') || leagueLower.includes('league') || leagueLower.includes('meisterschaft') || leagueLower.includes('bundesliga')) {
    return 'Punktspiel';
  }

  return 'Punktspiel'; // Default
}

// Validiere fussball.de URL
export function isValidFussballDeUrl(url: string): boolean {
  if (!url) return false;

  try {
    const parsed = new URL(url);
    return parsed.hostname.includes('fussball.de');
  } catch {
    return false;
  }
}

// Spieler-Info aus dem AJAX-HTML extrahieren (URL und Trikotnummer)
interface RawPlayerInfo {
  profileUrl: string;
  nummer: string;
  team: 'home' | 'away';
}

// Spieler aus HTML-Block extrahieren (nur URLs und Nummern, Namen werden separat geladen)
function extractPlayerInfoFromHtml(html: string): RawPlayerInfo[] {
  const players: RawPlayerInfo[] = [];
  const seenUrls = new Set<string>();

  // Pattern 1: Standard player-wrapper mit home/away Klasse
  // Flexibler: Klassen können in beliebiger Reihenfolge sein
  const playerPattern1 = /<a[^>]*href="([^"]*spielerprofil[^"]*)"[^>]*class="[^"]*(?:player-wrapper[^"]*(?:home|away)|(?:home|away)[^"]*player-wrapper)[^"]*"[^>]*>[\s\S]*?<span[^>]*class="[^"]*player-number[^"]*"[^>]*>(\d+)<\/span>/gi;

  let match;
  while ((match = playerPattern1.exec(html)) !== null) {
    const profileUrl = match[1];
    const nummer = match[2];

    // Team aus der Klasse extrahieren
    const classMatch = match[0].match(/class="[^"]*\b(home|away)\b[^"]*"/i);
    const team = (classMatch ? classMatch[1].toLowerCase() : 'home') as 'home' | 'away';

    if (!seenUrls.has(profileUrl)) {
      seenUrls.add(profileUrl);
      players.push({ profileUrl, nummer, team });
    }
  }

  // Pattern 2: Fallback - Suche nach allen Spielerprofil-Links mit Nummern
  // Wenn wir noch nicht genug Spieler haben
  if (players.length < 20) {
    // Finde alle Links zu Spielerprofilen
    const linkPattern = /<a[^>]*href="([^"]*spielerprofil[^"]*)"[^>]*>/gi;
    const numberPattern = /<span[^>]*class="[^"]*player-number[^"]*"[^>]*>(\d+)<\/span>/gi;

    // Extrahiere Abschnitte für home und away
    const homeSection = html.match(/class="[^"]*lineup-home[^"]*"[\s\S]*?(?=class="[^"]*lineup-away|$)/i);
    const awaySection = html.match(/class="[^"]*lineup-away[^"]*"[\s\S]*$/i);

    const extractFromSection = (section: string, team: 'home' | 'away') => {
      // Reset regex
      linkPattern.lastIndex = 0;
      numberPattern.lastIndex = 0;

      // Finde alle player-wrapper Blöcke
      const wrapperPattern = /<a[^>]*class="[^"]*player-wrapper[^"]*"[^>]*href="([^"]*spielerprofil[^"]*)"[^>]*>[\s\S]*?<span[^>]*player-number[^>]*>(\d+)<\/span>[\s\S]*?<\/a>/gi;

      let wMatch;
      while ((wMatch = wrapperPattern.exec(section)) !== null) {
        const profileUrl = wMatch[1];
        const nummer = wMatch[2];

        if (!seenUrls.has(profileUrl)) {
          seenUrls.add(profileUrl);
          players.push({ profileUrl, nummer, team });
        }
      }
    };

    if (homeSection) {
      extractFromSection(homeSection[0], 'home');
    }
    if (awaySection) {
      extractFromSection(awaySection[0], 'away');
    }
  }

  // Pattern 3: Noch flexibler - suche nach allen a-Tags mit spielerprofil und einer Nummer in der Nähe
  if (players.length < 20) {
    // Suche nach Mustern wie: <a href="...spielerprofil...">...<span...>NUMMER</span>...</a>
    const flexPattern = /<a[^>]*href="([^"]*\/spielerprofil\/[^"]*)"[^>]*>[\s\S]*?<span[^>]*>(\d{1,2})<\/span>[\s\S]*?<\/a>/gi;

    while ((match = flexPattern.exec(html)) !== null) {
      const profileUrl = match[1];
      const nummer = match[2];

      if (!seenUrls.has(profileUrl) && parseInt(nummer) <= 99) {
        seenUrls.add(profileUrl);
        // Bestimme Team basierend auf Position im HTML
        const posInHtml = match.index;
        const homeSectionEnd = html.indexOf('lineup-away');
        const team: 'home' | 'away' = homeSectionEnd === -1 || posInHtml < homeSectionEnd ? 'home' : 'away';
        players.push({ profileUrl, nummer, team });
      }
    }
  }

  console.log('Extracted', players.length, 'players from HTML');
  return players;
}

// Spielername aus Spielerprofil-Seite extrahieren
async function fetchPlayerNameFromProfile(profileUrl: string): Promise<{ vorname: string; name: string } | null> {
  try {
    // Stelle sicher, dass die URL vollständig ist
    const fullUrl = profileUrl.startsWith('http')
      ? profileUrl
      : `https://www.fussball.de${profileUrl}`;

    const proxyUrl = `${SUPABASE_PROXY_URL}?type=transfermarkt&url=${encodeURIComponent(fullUrl)}`;

    const response = await fetch(proxyUrl, { method: 'GET' });
    if (!response.ok) return null;

    const html = await response.text();

    // Name aus dem Title extrahieren
    // Format 1: "Vorname Nachname (Team) Spielerprofil | FUSSBALL.DE"
    // Format 2: "Vorname Nachname Basisprofil | FUSSBALL.DE"
    // Format 3: "Vorname Nachname Spielerprofil | FUSSBALL.DE"
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    if (titleMatch) {
      const title = titleMatch[1];

      // Versuche Format 1: Mit Verein in Klammern
      let nameMatch = title.match(/^([^(]+)\s*\(/);

      // Versuche Format 2/3: Ohne Klammern - Name vor "Basisprofil" oder "Spielerprofil"
      if (!nameMatch) {
        nameMatch = title.match(/^(.+?)\s+(?:Basisprofil|Spielerprofil)/i);
      }

      if (nameMatch) {
        const fullName = nameMatch[1].trim();
        const nameParts = fullName.split(' ');

        if (nameParts.length >= 2) {
          // Letztes Wort ist Nachname, Rest ist Vorname
          const name = nameParts.pop() || '';
          const vorname = nameParts.join(' ');
          return { vorname, name };
        } else if (nameParts.length === 1) {
          return { vorname: '', name: nameParts[0] };
        }
      }
    }

    return null;
  } catch (err) {
    console.error('Error fetching player profile:', err);
    return null;
  }
}

// Alle Spielernamen parallel laden (mit Rate-Limiting)
async function fetchAllPlayerNames(
  playerInfos: RawPlayerInfo[]
): Promise<Map<string, { vorname: string; name: string }>> {
  const nameMap = new Map<string, { vorname: string; name: string }>();

  // Lade Namen in Batches von 5 um Rate-Limiting zu vermeiden
  const BATCH_SIZE = 5;

  for (let i = 0; i < playerInfos.length; i += BATCH_SIZE) {
    const batch = playerInfos.slice(i, i + BATCH_SIZE);

    const results = await Promise.all(
      batch.map(async (info) => {
        const playerName = await fetchPlayerNameFromProfile(info.profileUrl);
        return { url: info.profileUrl, playerName };
      })
    );

    for (const result of results) {
      if (result.playerName) {
        nameMap.set(result.url, result.playerName);
      }
    }

    // Kurze Pause zwischen Batches
    if (i + BATCH_SIZE < playerInfos.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return nameMap;
}

// Aufstellungen von fussball.de abrufen via Edge Function mit Browserless.io
// Die Edge Function nutzt Browserless um die JavaScript-gerenderte Seite zu laden
// und holt dann die Aufstellungsdaten via AJAX-Endpoint
export async function fetchLineupsFromUrl(
  fussballDeUrl: string
): Promise<{ success: boolean; data?: LineupsData; error?: string }> {
  try {
    if (!isValidFussballDeUrl(fussballDeUrl)) {
      return { success: false, error: 'Ungültige fussball.de URL' };
    }

    console.log('Fetching lineup via Edge Function for:', fussballDeUrl);

    // Rufe Edge Function auf
    const response = await fetch(SCRAPE_LINEUP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: fussballDeUrl }),
    });

    if (!response.ok) {
      console.log('Edge Function request failed:', response.status);
      return { success: false, error: 'Konnte Aufstellung nicht laden' };
    }

    const result = await response.json();
    // Die Edge Function gibt {success, data: {...}} zurück
    const lineupData = result.data || result;

    console.log('Edge Function response:', {
      success: result.success,
      available: lineupData.available,
      homeStarters: lineupData.homeStarters?.length || 0,
      homeSubs: lineupData.homeSubs?.length || 0,
      awayStarters: lineupData.awayStarters?.length || 0,
      awaySubs: lineupData.awaySubs?.length || 0,
    });

    if (!result.success) {
      return {
        success: false,
        error: result.error || 'Fehler beim Laden der Aufstellung',
      };
    }

    // Konvertiere Edge Function Response zu LineupsData
    const mapPlayer = (p: { nummer?: string; vorname?: string; name?: string }): PlayerLineupData => ({
      nummer: p.nummer || '',
      vorname: p.vorname || '',
      name: p.name || '',
      position: '',
      jahrgang: '',
    });

    const homeStarters = (lineupData.homeStarters || []).map(mapPlayer);
    const homeSubs = (lineupData.homeSubs || []).map(mapPlayer);
    const awayStarters = (lineupData.awayStarters || []).map(mapPlayer);
    const awaySubs = (lineupData.awaySubs || []).map(mapPlayer);

    return {
      success: true,
      data: {
        homeStarters,
        homeSubs,
        awayStarters,
        awaySubs,
        available: lineupData.available || false,
        result: lineupData.result,
      },
    };

  } catch (err) {
    console.error('Fehler beim Abrufen der Aufstellung:', err);
    return {
      success: false,
      error: 'Fehler beim Abrufen der Aufstellung',
    };
  }
}

// Prüfe ob Spiel beendet ist (basierend auf Datum)
export function isMatchFinished(matchDate: string): boolean {
  if (!matchDate) return false;

  // Parse deutsches Datum
  const match = matchDate.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!match) return false;

  const day = parseInt(match[1]);
  const month = parseInt(match[2]) - 1;
  const year = parseInt(match[3]);

  const matchDateObj = new Date(year, month, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return matchDateObj < today;
}
