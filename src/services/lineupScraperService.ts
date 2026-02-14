// lineupScraperService.ts - Lineup Scraping von fussball.de
//
// WICHTIG: Diese Datei definiert das Interface für einen Backend-Scraping-Service.
// Die eigentliche Scraping-Logik muss auf einem Server mit Puppeteer laufen.
//
// Optionen für das Backend:
// 1. Supabase Edge Function (erfordert Pro-Plan für Puppeteer)
// 2. Eigener Node.js Server mit Puppeteer
// 3. Cloud-Service wie Browserless.io, ScrapingBee, etc.

import { extractMatchId, isValidFussballDeUrl } from './fussballDeService';

// Interface für Spieler-Daten aus der Aufstellung
export interface ScrapedPlayer {
  nummer: string;
  name: string;
  vorname: string;
  position: string;
  jahrgang: string;
}

// Interface für das Scraping-Ergebnis
export interface ScrapedLineups {
  homeTeam: string;
  awayTeam: string;
  homeStarters: ScrapedPlayer[];
  homeSubs: ScrapedPlayer[];
  awayStarters: ScrapedPlayer[];
  awaySubs: ScrapedPlayer[];
  result?: string;
  available: boolean;
  error?: string;
  // Match metadata (aus AJAX match.info)
  matchDate?: string;
  matchTime?: string;
  location?: string;
  league?: string;
}

// Supabase Edge Function für Lineup-Scraping
// Nutzt dieselbe Supabase-Instanz wie die KMH-App
const LINEUP_SCRAPER_URL = 'https://ozggtruvnwozhwjbznsm.supabase.co/functions/v1/scrape-lineup';

// Supabase Anon Key für Edge Function Auth
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96Z2d0cnV2bndvemh3amJ6bnNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5NDI5ODYsImV4cCI6MjA4MjUxODk4Nn0.QCaSqAQPrIl-DXKiT82wbWAJ23KbeOTpRvq8YI46hCY';

/**
 * Holt die Aufstellungen von fussball.de über einen Backend-Service mit Puppeteer.
 *
 * Das Backend muss:
 * 1. Die fussball.de Spielseite mit Puppeteer öffnen
 * 2. Auf den "AUFSTELLUNG" Tab klicken
 * 3. Die Spieler-Daten aus dem DOM extrahieren
 * 4. Die Daten als JSON zurückgeben
 */
export async function scrapeLineupsFromFussballDe(
  fussballDeUrl: string
): Promise<{ success: boolean; data?: ScrapedLineups; error?: string }> {

  // Validierung
  if (!isValidFussballDeUrl(fussballDeUrl)) {
    return { success: false, error: 'Ungültige fussball.de URL' };
  }

  const matchId = extractMatchId(fussballDeUrl);
  if (!matchId) {
    return { success: false, error: 'Konnte keine Spiel-ID extrahieren' };
  }


  try {
    console.log('Rufe Lineup-Scraper auf für:', matchId);

    const response = await fetch(LINEUP_SCRAPER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        url: fussballDeUrl,
        matchId: matchId,
      }),
    });

    if (!response.ok) {
      throw new Error(`Scraper returned ${response.status}`);
    }

    const result = await response.json();

    if (result.success && result.data) {
      return {
        success: true,
        data: result.data,
      };
    } else {
      return {
        success: false,
        error: result.error || 'Unbekannter Fehler beim Scraping',
      };
    }

  } catch (err) {
    console.error('Fehler beim Aufrufen des Lineup-Scrapers:', err);
    return {
      success: false,
      error: 'Lineup-Scraper nicht erreichbar. Bitte Aufstellung manuell eingeben.',
    };
  }
}

/**
 * ============================================================
 * BACKEND PUPPETEER CODE
 * ============================================================
 *
 * Der folgende Code zeigt, wie das Puppeteer-Backend implementiert
 * werden sollte. Dies muss auf einem Server laufen, NICHT im React Native App.
 *
 * Beispiel für eine Supabase Edge Function (supabase/functions/scrape-lineup/index.ts):
 *
 * ```typescript
 * import puppeteer from 'puppeteer-core';
 * import chromium from '@sparticuz/chromium';
 *
 * export async function scrapeLineup(matchUrl: string): Promise<ScrapedLineups> {
 *   const browser = await puppeteer.launch({
 *     args: chromium.args,
 *     executablePath: await chromium.executablePath(),
 *     headless: chromium.headless,
 *   });
 *
 *   try {
 *     const page = await browser.newPage();
 *
 *     // User-Agent setzen um Bot-Erkennung zu vermeiden
 *     await page.setUserAgent(
 *       'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
 *     );
 *
 *     // Zur Spielseite navigieren
 *     await page.goto(matchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
 *
 *     // Warte auf die Seite
 *     await page.waitForSelector('.stage-content', { timeout: 10000 });
 *
 *     // Klicke auf den AUFSTELLUNG Tab
 *     const aufstellungTab = await page.$('a[href*="aufstellung"], .tab-item:contains("AUFSTELLUNG")');
 *     if (aufstellungTab) {
 *       await aufstellungTab.click();
 *       await page.waitForTimeout(2000); // Warte auf AJAX-Laden
 *     }
 *
 *     // Extrahiere die Aufstellungsdaten
 *     const lineups = await page.evaluate(() => {
 *       const result: ScrapedLineups = {
 *         homeTeam: '',
 *         awayTeam: '',
 *         homeStarters: [],
 *         homeSubs: [],
 *         awayStarters: [],
 *         awaySubs: [],
 *         available: false,
 *       };
 *
 *       // Team-Namen
 *       const teamElements = document.querySelectorAll('.team-name, .club-name');
 *       if (teamElements.length >= 2) {
 *         result.homeTeam = teamElements[0].textContent?.trim() || '';
 *         result.awayTeam = teamElements[1].textContent?.trim() || '';
 *       }
 *
 *       // Spieler extrahieren
 *       const playerRows = document.querySelectorAll('.lineup-player, .player-row');
 *       playerRows.forEach((row, index) => {
 *         const player: ScrapedPlayer = {
 *           nummer: row.querySelector('.player-number')?.textContent?.trim() || '',
 *           name: row.querySelector('.player-name')?.textContent?.trim() || '',
 *           vorname: '', // Muss aus dem vollen Namen extrahiert werden
 *           position: row.querySelector('.player-position')?.textContent?.trim() || '',
 *           jahrgang: row.querySelector('.player-birth-year')?.textContent?.trim() || '',
 *         };
 *
 *         // Name aufteilen (Format auf fussball.de: "Nachname, Vorname" oder "Vorname Nachname")
 *         if (player.name.includes(',')) {
 *           const parts = player.name.split(',');
 *           player.name = parts[0].trim();
 *           player.vorname = parts[1]?.trim() || '';
 *         } else {
 *           const parts = player.name.split(' ');
 *           if (parts.length > 1) {
 *             player.vorname = parts[0];
 *             player.name = parts.slice(1).join(' ');
 *           }
 *         }
 *
 *         // Zur richtigen Liste hinzufügen (basierend auf Position im DOM)
 *         // Dies muss an die tatsächliche DOM-Struktur angepasst werden
 *         result.homeStarters.push(player);
 *       });
 *
 *       result.available = result.homeStarters.length > 0;
 *
 *       // Ergebnis extrahieren
 *       const scoreElement = document.querySelector('.score, .result');
 *       if (scoreElement) {
 *         result.result = scoreElement.textContent?.trim();
 *       }
 *
 *       return result;
 *     });
 *
 *     return lineups;
 *
 *   } finally {
 *     await browser.close();
 *   }
 * }
 * ```
 *
 * ALTERNATIVE: Browserless.io oder ScrapingBee verwenden
 * Diese Services bieten Headless-Browser-APIs ohne eigenen Server.
 *
 * Beispiel mit Browserless.io:
 * ```typescript
 * const response = await fetch('https://chrome.browserless.io/content?token=YOUR_TOKEN', {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({
 *     url: matchUrl,
 *     waitFor: '.lineup-container',
 *     gotoOptions: { waitUntil: 'networkidle2' },
 *   }),
 * });
 * ```
 */
