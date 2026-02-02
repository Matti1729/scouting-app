// ============================================
// SPIELER TYPEN
// ============================================

export interface Player {
  id: string;
  created_at: string;
  updated_at: string;
  scout_id: string;

  // Basis-Infos
  first_name: string;
  last_name: string;
  birth_date: string;
  age_group: AgeGroup;
  position: Position;
  preferred_foot: 'left' | 'right' | 'both';

  // Körperliche Daten
  height_cm?: number;
  weight_kg?: number;
  development_stage: DevelopmentStage;
  physical_tags: PhysicalTag[];

  // Bewertungen
  overall_rating: number; // 1-10
  technical_rating?: number;
  tactical_rating?: number;
  mental_rating?: number;
  physical_rating?: number;

  // Zusätzliche Infos
  current_club?: string;
  notes?: string;
  strengths?: string[];
  weaknesses?: string[];

  // Medien
  photo_url?: string;
  video_urls?: string[];

  // Externe Links
  fussball_de_url?: string;
  transfermarkt_url?: string;

  // Berater-Info (von Transfermarkt)
  agent_name?: string;
  agent_company?: string;
  has_agent?: boolean;
}

// ============================================
// ALTERSKLASSEN & ENTWICKLUNG
// ============================================

export type AgeGroup = 'U14' | 'U15' | 'U16' | 'U17' | 'U19' | 'Herren';

export type DevelopmentStage =
  | 'vor_wachstumsschub'    // U14, noch alles offen
  | 'im_wachstumsschub'     // U15-U16, gerade im Schub
  | 'nach_wachstumsschub'   // U17+, Wachstum verlangsamt
  | 'ausgewachsen';         // U19+, Endgröße erreicht

// Durchschnittsgröße pro Altersklasse (WHO 50. Perzentil)
export const AVG_HEIGHT_BY_AGE: Record<AgeGroup, number> = {
  'U14': 156,
  'U15': 163,
  'U16': 169,
  'U17': 174,
  'U19': 176,
  'Herren': 178,
};

// ============================================
// KÖRPERLICHE TAGS
// ============================================

export type PhysicalTag =
  // Körperbau & Robustheit
  | 'klein'           // < 165cm
  | 'mittel'          // 165-180cm
  | 'gross'           // > 180cm
  | 'schmaechtig'
  | 'athletisch'
  | 'robust'
  | 'zweikampfstark'
  | 'kopfballstark'
  // Schnelligkeit & Athletik
  | 'explosiver_antritt'
  | 'sprintstark'
  | 'sprungkraft'
  | 'ausdauernd'
  | 'eher_langsam'
  // Beweglichkeit & Koordination
  | 'wendig'
  | 'tiefer_schwerpunkt'
  | 'gute_koerperbeherrschung'
  | 'beidfuessig'
  | 'starker_linker_fuss'
  | 'starker_rechter_fuss';

// Labels für die Tags (für die Anzeige)
export const PHYSICAL_TAG_LABELS: Record<PhysicalTag, string> = {
  // Körperbau
  'klein': 'Klein (< 165cm)',
  'mittel': 'Mittel (165-180cm)',
  'gross': 'Groß (> 180cm)',
  'schmaechtig': 'Schmächtig',
  'athletisch': 'Athletisch',
  'robust': 'Robust/Kräftig',
  'zweikampfstark': 'Zweikampfstark',
  'kopfballstark': 'Kopfballstark',
  // Schnelligkeit
  'explosiver_antritt': 'Explosiver Antritt',
  'sprintstark': 'Sprintstark',
  'sprungkraft': 'Sprungkraft',
  'ausdauernd': 'Ausdauernd',
  'eher_langsam': 'Eher langsam',
  // Beweglichkeit
  'wendig': 'Wendig',
  'tiefer_schwerpunkt': 'Tiefer Schwerpunkt',
  'gute_koerperbeherrschung': 'Gute Körperbeherrschung',
  'beidfuessig': 'Beidfüßig',
  'starker_linker_fuss': 'Starker linker Fuß',
  'starker_rechter_fuss': 'Starker rechter Fuß',
};

// Tag-Kategorien für gruppierte Anzeige
export const PHYSICAL_TAG_CATEGORIES = {
  'Körperbau & Robustheit': [
    'klein', 'mittel', 'gross', 'schmaechtig', 'athletisch',
    'robust', 'zweikampfstark', 'kopfballstark'
  ] as PhysicalTag[],
  'Schnelligkeit & Athletik': [
    'explosiver_antritt', 'sprintstark', 'sprungkraft',
    'ausdauernd', 'eher_langsam'
  ] as PhysicalTag[],
  'Beweglichkeit & Koordination': [
    'wendig', 'tiefer_schwerpunkt', 'gute_koerperbeherrschung',
    'beidfuessig', 'starker_linker_fuss', 'starker_rechter_fuss'
  ] as PhysicalTag[],
};

// ============================================
// POSITIONEN
// ============================================

export type Position =
  | 'TW'   // Torwart
  | 'IV'   // Innenverteidiger
  | 'LV'   // Linker Verteidiger
  | 'RV'   // Rechter Verteidiger
  | 'DM'   // Defensives Mittelfeld
  | 'ZM'   // Zentrales Mittelfeld
  | 'LM'   // Linkes Mittelfeld
  | 'RM'   // Rechtes Mittelfeld
  | 'OM'   // Offensives Mittelfeld
  | 'LF'   // Linker Flügel
  | 'RF'   // Rechter Flügel
  | 'ST';  // Stürmer

export const POSITION_LABELS: Record<Position, string> = {
  'TW': 'Torwart',
  'IV': 'Innenverteidiger',
  'LV': 'Linker Verteidiger',
  'RV': 'Rechter Verteidiger',
  'DM': 'Defensives Mittelfeld',
  'ZM': 'Zentrales Mittelfeld',
  'LM': 'Linkes Mittelfeld',
  'RM': 'Rechtes Mittelfeld',
  'OM': 'Offensives Mittelfeld',
  'LF': 'Linker Flügel',
  'RF': 'Rechter Flügel',
  'ST': 'Stürmer',
};

// ============================================
// EVENTS (Spiele/Turniere)
// ============================================

export interface ScoutingEvent {
  id: string;
  created_at: string;
  scout_id: string;

  name: string;
  event_type: 'game' | 'tournament' | 'training';
  date: string;
  location?: string;

  home_team?: string;
  away_team?: string;
  score_home?: number;
  score_away?: number;

  age_group: AgeGroup;
  notes?: string;
}

// ============================================
// SCOUT PROFIL
// ============================================

export interface ScoutProfile {
  id: string;
  created_at: string;
  email: string;
  name: string;
  organization?: string;
}

// ============================================
// KÖRPERBAU (Body Structure)
// ============================================

// Körperbau-Merkmale
export type RelativeHeight = 'unterdurchschnittlich' | 'durchschnittlich' | 'ueberdurchschnittlich';
export type Proportion = 'langbeinig' | 'ausgeglichen' | 'kompakt';
export type Pelvis = 'schmal' | 'mittel' | 'breit';
export type ShoulderLine = 'schmal' | 'mittel' | 'breit';
export type Musculature = 'wenig_aufbau' | 'altersgerecht' | 'kraeftig';
export type MovementPattern = 'leichtfuessig' | 'neutral' | 'schwerfaellig';

// Gesamter Körperbau-State (Alter kommt aus Spielerdaten)
export interface BodyStructureData {
  relativeHeight: RelativeHeight | null;
  proportion: Proportion | null;
  pelvis: Pelvis | null;
  shoulderLine: ShoulderLine | null;
  musculature: Musculature | null;
  movementPattern: MovementPattern | null;
}

// Prognose-Output
export type Tendency = 'im_aufbau' | 'altersgerecht' | 'koerperlich_weit';
export type Upside = 'LOW' | 'MEDIUM' | 'HIGH';

export interface BodyStructurePrognosis {
  tendency: Tendency;
  upside: Upside;
  isComplete: boolean;
}

// Labels für die Körperbau-Merkmale
export const BODY_STRUCTURE_LABELS = {
  relativeHeight: {
    unterdurchschnittlich: 'unterdurchschn.',
    durchschnittlich: 'durchschnittlich',
    ueberdurchschnittlich: 'überdurchschn.',
  },
  proportion: {
    langbeinig: 'langbeinig',
    ausgeglichen: 'ausgeglichen',
    kompakt: 'kompakt',
  },
  pelvis: {
    schmal: 'schmal',
    mittel: 'mittel',
    breit: 'breit',
  },
  shoulderLine: {
    schmal: 'schmal',
    mittel: 'mittel',
    breit: 'breit',
  },
  musculature: {
    wenig_aufbau: 'wenig Aufbau',
    altersgerecht: 'altersgerecht',
    kraeftig: 'kräftig',
  },
  movementPattern: {
    leichtfuessig: 'leichtfüßig',
    neutral: 'neutral',
    schwerfaellig: 'schwerfällig',
  },
  tendency: {
    im_aufbau: 'im Aufbau',
    altersgerecht: 'altersgerecht',
    koerperlich_weit: 'körperlich weit',
  },
} as const;

// ============================================
// KÖRPERBAU FÜR ERWACHSENE
// ============================================

export type AdultBodyType = 'schmaechtig' | 'normal' | 'athletisch' | 'robust';

export const ADULT_BODY_TYPE_LABELS: Record<AdultBodyType, string> = {
  schmaechtig: 'Schmächtig',
  normal: 'Normal',
  athletisch: 'Athletisch',
  robust: 'Robust',
};

// ============================================
// SCHNELLIGKEIT & ATHLETIK
// ============================================

// Bewertungsstufen für Antritt, Beschleunigung, Endspeed
export type SpeedRating = 'top' | 'gut' | 'durchschnitt' | 'schwach';

// Bewegungsökonomie (Laufstil)
export type MovementEconomy = 'leichtfuessig' | 'neutral' | 'schwerfaellig';

// Intensität (Motor)
export type Intensity = 'hoch' | 'mittel' | 'niedrig';

// Beweglichkeit
export type Flexibility = 'sehr_beweglich' | 'beweglich' | 'durchschnittlich' | 'steif';

// Koordination
export type Coordination = 'sauber' | 'normal' | 'wacklig';

// Gesamtdaten für Schnelligkeit & Athletik
export interface SpeedAthleticismData {
  antritt: SpeedRating | null;           // 0-20m (Antritt + Beschleunigung)
  endspeed: SpeedRating | null;          // 20m+
  bewegungsoekonomie: MovementEconomy | null;
  intensitaet: Intensity | null;
  beweglichkeit: Flexibility | null;
  koordination: Coordination | null;
}

// Labels
export const SPEED_RATING_LABELS: Record<SpeedRating, string> = {
  top: 'Top',
  gut: 'Gut',
  durchschnitt: 'Durchschnitt',
  schwach: 'Schwach',
};

export const MOVEMENT_ECONOMY_LABELS: Record<MovementEconomy, string> = {
  leichtfuessig: 'Leichtfüßig',
  neutral: 'Neutral',
  schwerfaellig: 'Schwerfällig',
};

export const INTENSITY_LABELS: Record<Intensity, string> = {
  hoch: 'Hoch',
  mittel: 'Mittel',
  niedrig: 'Niedrig',
};

export const FLEXIBILITY_LABELS: Record<Flexibility, string> = {
  sehr_beweglich: 'Sehr beweglich',
  beweglich: 'Beweglich',
  durchschnittlich: 'Durchschnittlich',
  steif: 'Steif',
};

export const COORDINATION_LABELS: Record<Coordination, string> = {
  sauber: 'Sauber',
  normal: 'Normal',
  wacklig: 'Wacklig',
};
