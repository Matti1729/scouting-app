import { Platform } from 'react-native';
import { ThemeColors } from '../contexts/ThemeContext';

// Retro-Farbschema (Anstoss-3-Optik) — Design-Referenz ist die Spiele-Übersicht
export const RETRO = {
  page: '#e9e5dd',
  titleBar: 'rgba(210, 206, 198, 0.92)',
  panel: 'rgba(228, 224, 216, 0.68)',
  face: 'rgba(230, 226, 218, 0.80)',
  faceSelected: 'rgba(169, 187, 223, 0.92)',
  shadowDark: '#55524e',
  text: '#14141e',
  textMuted: '#4a4a55',
  headerBg: '#2b3f96',
  headerText: '#ffffff',
  inputBg: 'rgba(255, 255, 255, 0.92)',
  yellow: '#f2c230',
  rowBorder: '#c6c2ba',
  white: '#ffffff',
};

// Monospace-Schrift für Retro-Labels (wie "tt.mm.jjjj" in der Spiele-Übersicht)
export const MONO = Platform.select({ web: 'monospace', ios: 'Menlo', default: 'monospace' });

export const HARD_SHADOW = Platform.OS === 'web'
  ? ({ boxShadow: '2px 2px 3px rgba(20, 20, 45, 0.45)' } as any)
  : { shadowColor: '#14142d', shadowOffset: { width: 2, height: 2 }, shadowOpacity: 0.45, shadowRadius: 2, elevation: 3 };

export const HARD_SHADOW_LG = Platform.OS === 'web'
  ? ({ boxShadow: '3px 4px 9px rgba(10, 10, 45, 0.5)' } as any)
  : { shadowColor: '#0a0a2d', shadowOffset: { width: 3, height: 4 }, shadowOpacity: 0.5, shadowRadius: 5, elevation: 4 };

export const BLUE_GRADIENT = Platform.OS === 'web'
  ? ({ backgroundImage: 'linear-gradient(180deg, #4058b6 0%, #2b3f96 55%, #223077 100%)' } as any)
  : {};

// Retro-Button: erhabene Fläche, randlos — Tiefe kommt vom HARD_SHADOW
export const RETRO_BTN = {
  backgroundColor: RETRO.face,
  borderRadius: 0,
} as const;

// Blauer Karten-Chip: Sektionstitel auf der Oberkante einer Karte
// (wie ALLGEMEINES/VEREIN im Spielerprofil)
export const RETRO_CHIP = {
  position: 'absolute' as const,
  top: -10,
  left: 10,
  backgroundColor: RETRO.headerBg,
  borderRadius: 2,
  paddingHorizontal: 8,
  paddingVertical: 2,
  ...HARD_SHADOW,
};

export const RETRO_CHIP_TEXT = {
  fontSize: 10,
  fontWeight: '700' as const,
  letterSpacing: 1.5,
  fontFamily: MONO,
  color: '#ffffff',
};

// Retro-Palette als Theme-Farben: für Modals/Screens, die per ThemeOverride
// zur Anstoss-Optik der Spiele-Übersicht passen sollen statt zum Dark/Light-Theme.
export const RETRO_THEME: ThemeColors = {
  background: RETRO.page,
  surface: RETRO.white,
  surfaceSecondary: RETRO.face,
  primary: '#1a5f2a',
  primaryLight: '#2d8a3e',
  primaryText: '#ffffff',
  text: RETRO.text,
  textSecondary: RETRO.textMuted,
  border: RETRO.rowBorder,
  inputBackground: RETRO.inputBg,
  inputBorder: RETRO.shadowDark,
  cardBackground: RETRO.white,
  cardBorder: RETRO.rowBorder,
  success: '#15803d',
  warning: '#b45309',
  error: '#dc2626',
  accent: '#1d4ed8',
};
