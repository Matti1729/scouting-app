import { SpeedAthleticismData } from '../types';

export function createEmptySpeedAthleticismData(): SpeedAthleticismData {
  return {
    antritt: null,
    endspeed: null,
    koordination: null,
    robustheit: null,
    intensitaet: null,
  };
}

/**
 * Altdaten in das aktuelle Schema heben. Bewegungsqualität = Koordination;
 * fehlt sie, wird Beweglichkeit übersetzt (sehr beweglich/beweglich -> sauber,
 * durchschnittlich -> normal, steif -> wacklig). Bei Widerspruch gewinnt Koordination.
 */
export function normalizeSpeedAthleticism(raw: any): SpeedAthleticismData {
  const empty = createEmptySpeedAthleticismData();
  if (!raw || typeof raw !== 'object') return empty;
  let koordination = raw.koordination ?? null;
  if (koordination == null && raw.beweglichkeit) {
    const map: Record<string, SpeedAthleticismData['koordination']> = {
      sehr_beweglich: 'sauber', beweglich: 'sauber', durchschnittlich: 'normal', steif: 'wacklig',
    };
    koordination = map[raw.beweglichkeit] ?? null;
  }
  return {
    ...empty,
    antritt: raw.antritt ?? null,
    endspeed: raw.endspeed ?? null,
    koordination,
    robustheit: raw.robustheit ?? null,
    intensitaet: raw.intensitaet ?? null,
  };
}
