// kickerService.ts - Lineup Scraping von kicker.de
//
// Für 1./2./3. Liga Spiele, wo fussball.de keine Live-Aufstellungen hat.
// Wird automatisch als Fallback genutzt, wenn fussball.de keine Aufstellung liefert
// und die erkannte Liga eine Profi-Liga ist.

import { ScrapedLineups } from './lineupScraperService';

// Supabase Edge Function für Kicker-Lineup-Scraping
const KICKER_SCRAPER_URL = 'https://ozggtruvnwozhwjbznsm.supabase.co/functions/v1/scrape-kicker-lineup';

// Supabase Anon Key
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96Z2d0cnV2bndvemh3amJ6bnNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5NDI5ODYsImV4cCI6MjA4MjUxODk4Nn0.QCaSqAQPrIl-DXKiT82wbWAJ23KbeOTpRvq8YI46hCY';

/**
 * Prüft ob die erkannte Liga eine Profi-Liga ist (1./2./3. Bundesliga)
 */
/**
 * Prüft ob die erkannte Liga über Kicker.de verfügbar ist
 * (1./2./3. Bundesliga + DFB-Pokal)
 */
export function isProLeague(league: string): boolean {
  if (!league) return false;
  const lower = league.toLowerCase();
  return (
    lower.includes('bundesliga') ||
    lower.includes('3. liga') ||
    lower.includes('3.liga') ||
    lower.includes('dritte liga') ||
    lower.includes('dfb-pokal') ||
    lower.includes('dfb pokal') ||
    lower.includes('pokal') ||
    lower.includes('supercup') ||
    lower.includes('relegation') ||
    lower === '1. liga' ||
    lower === '2. liga' ||
    lower === '3. liga'
  );
}

/**
 * Sucht auf Kicker.de nach einem Spiel anhand der Team-Namen und scrapt die Aufstellung.
 * Die Edge Function übernimmt die Suche und das Scraping.
 */
export async function searchAndScrapeKickerLineup(
  homeTeam: string,
  awayTeam: string,
  league: string
): Promise<{ success: boolean; data?: ScrapedLineups; error?: string }> {

  if (!homeTeam || !awayTeam) {
    return { success: false, error: 'Team-Namen fehlen für Kicker-Suche' };
  }

  try {
    console.log(`Kicker-Suche: ${homeTeam} vs ${awayTeam} (${league})`);

    const response = await fetch(KICKER_SCRAPER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        homeTeam,
        awayTeam,
        league,
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
        error: result.error || 'Kicker-Aufstellung nicht gefunden',
      };
    }

  } catch (err) {
    console.error('Fehler beim Kicker-Lineup-Scraper:', err);
    return {
      success: false,
      error: 'Kicker-Scraper nicht erreichbar.',
    };
  }
}
