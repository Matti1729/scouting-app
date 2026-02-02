import {
  BodyStructureData,
  BodyStructurePrognosis,
  Tendency,
  Upside,
} from '../types';

/**
 * Berechnet die Körperbau-Prognose basierend auf den eingegebenen Merkmalen.
 *
 * Punktesystem:
 * - U (Upside/im Aufbau): Zeigt Entwicklungspotenzial
 * - W (Weit): Zeigt bereits fortgeschrittene körperliche Entwicklung
 *
 * Gewichtung:
 * - Proportion: U+2 / W+2
 * - Muskulatur: U+2 / W+2
 * - Alle anderen: U+1 / W+1
 */

interface PointWeights {
  u: number; // Upside points
  w: number; // Weit points
}

// Punkte pro Merkmal-Auswahl
const RELATIVE_HEIGHT_POINTS: Record<string, PointWeights> = {
  unterdurchschnittlich: { u: 1, w: 0 },
  durchschnittlich: { u: 0, w: 0 },
  ueberdurchschnittlich: { u: 0, w: 1 },
};

const PROPORTION_POINTS: Record<string, PointWeights> = {
  langbeinig: { u: 2, w: 0 },
  ausgeglichen: { u: 0, w: 0 },
  kompakt: { u: 0, w: 2 },
};

const PELVIS_POINTS: Record<string, PointWeights> = {
  schmal: { u: 1, w: 0 },
  mittel: { u: 0, w: 0 },
  breit: { u: 0, w: 1 },
};

const SHOULDER_LINE_POINTS: Record<string, PointWeights> = {
  schmal: { u: 1, w: 0 },
  mittel: { u: 0, w: 0 },
  breit: { u: 0, w: 1 },
};

const MUSCULATURE_POINTS: Record<string, PointWeights> = {
  wenig_aufbau: { u: 2, w: 0 },
  altersgerecht: { u: 0, w: 0 },
  kraeftig: { u: 0, w: 2 },
};

const MOVEMENT_PATTERN_POINTS: Record<string, PointWeights> = {
  leichtfuessig: { u: 1, w: 0 },
  neutral: { u: 0, w: 0 },
  schwerfaellig: { u: 0, w: 1 },
};

// Altersfaktor (Alter als Zahl, wird aus Spielerdaten berechnet)
function getAgeBonus(age: number): PointWeights {
  if (age <= 15) {
    return { u: 1, w: 0 }; // Jung → mehr Upside
  } else if (age >= 18) {
    return { u: 0, w: 1 }; // Älter → eher "weit"
  }
  return { u: 0, w: 0 }; // 16-17 → neutral
}

/**
 * Prüft ob alle Merkmal-Felder ausgefüllt sind
 */
export function isBodyStructureComplete(data: BodyStructureData): boolean {
  return (
    data.relativeHeight !== null &&
    data.proportion !== null &&
    data.pelvis !== null &&
    data.shoulderLine !== null &&
    data.musculature !== null &&
    data.movementPattern !== null
  );
}

/**
 * Berechnet die Prognose basierend auf den Körperbau-Daten und dem Spieleralter
 * @param data - Die Körperbau-Merkmale
 * @param playerAge - Das Alter des Spielers (aus Geburtsdatum/Jahrgang berechnet)
 */
export function calculateBodyStructurePrognosis(
  data: BodyStructureData,
  playerAge: number | null
): BodyStructurePrognosis | null {
  // Prüfen ob alle Merkmal-Felder ausgefüllt sind
  if (!isBodyStructureComplete(data)) {
    return null;
  }

  // Prüfen ob Alter vorhanden
  if (playerAge === null) {
    return null;
  }

  // U und W Punkte sammeln
  let totalU = 0;
  let totalW = 0;

  // Merkmal-Punkte addieren
  if (data.relativeHeight) {
    const points = RELATIVE_HEIGHT_POINTS[data.relativeHeight];
    totalU += points.u;
    totalW += points.w;
  }

  if (data.proportion) {
    const points = PROPORTION_POINTS[data.proportion];
    totalU += points.u;
    totalW += points.w;
  }

  if (data.pelvis) {
    const points = PELVIS_POINTS[data.pelvis];
    totalU += points.u;
    totalW += points.w;
  }

  if (data.shoulderLine) {
    const points = SHOULDER_LINE_POINTS[data.shoulderLine];
    totalU += points.u;
    totalW += points.w;
  }

  if (data.musculature) {
    const points = MUSCULATURE_POINTS[data.musculature];
    totalU += points.u;
    totalW += points.w;
  }

  if (data.movementPattern) {
    const points = MOVEMENT_PATTERN_POINTS[data.movementPattern];
    totalU += points.u;
    totalW += points.w;
  }

  // Altersfaktor addieren
  const ageBonus = getAgeBonus(playerAge);
  totalU += ageBonus.u;
  totalW += ageBonus.w;

  // Tendenz berechnen: D = U - W
  const difference = totalU - totalW;
  let tendency: Tendency;
  if (difference >= 2) {
    tendency = 'im_aufbau';
  } else if (difference <= -2) {
    tendency = 'koerperlich_weit';
  } else {
    tendency = 'altersgerecht';
  }

  // Upside berechnen
  // HIGH: U ≥ 5 UND Bewegungsbild ≠ schwerfällig
  // MEDIUM: U = 3-4
  // LOW: U ≤ 2 ODER W ≥ 5
  let upside: Upside;
  const isSchwerfaellig = data.movementPattern === 'schwerfaellig';

  if (totalU >= 5 && !isSchwerfaellig) {
    upside = 'HIGH';
  } else if (totalW >= 5 || totalU <= 2) {
    upside = 'LOW';
  } else {
    upside = 'MEDIUM';
  }

  return {
    tendency,
    upside,
    isComplete: true,
  };
}

/**
 * Erstellt ein leeres BodyStructureData-Objekt
 */
export function createEmptyBodyStructureData(): BodyStructureData {
  return {
    relativeHeight: null,
    proportion: null,
    pelvis: null,
    shoulderLine: null,
    musculature: null,
    movementPattern: null,
  };
}

/**
 * Prüft ob ein Spieler noch U19-berechtigt ist (Jugendspieler)
 * Stichtag: 1. Juli (Saisonwechsel in Deutschland)
 *
 * @param birthYear - Geburtsjahr des Spielers
 * @returns true wenn Jugendspieler, false wenn Erwachsener
 */
export function isYouthPlayer(birthYear: number): boolean {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed, Juli = 6

  // Vor Juli: referenceYear = aktuelles Jahr
  // Ab Juli: referenceYear = nächstes Jahr (neue Saison)
  const referenceYear = month < 6 ? year : year + 1;
  const oldestU19Year = referenceYear - 19;

  return birthYear >= oldestU19Year;
}
