import { RETRO } from './retro';

// Tabellenkopf wie in der Topscorer-Liste: blau, weiße Schrift, sortierte Spalte gelb (Matti 2026-11-15)
export const RETRO_TABLE_HEADER_COLORS = {
  surfaceSecondary: RETRO.headerBg,
  border: RETRO.headerBg,
  text: RETRO.yellow,
  textSecondary: RETRO.headerText,
  primary: RETRO.yellow,
};
export const RETRO_TABLE_HEADER_STYLE = { height: 32, paddingVertical: 0, borderBottomWidth: 0 };
export const RETRO_TABLE_HEADER_TEXT = { fontSize: 11, fontWeight: '600' as const, letterSpacing: 0.3, color: RETRO.headerText };
export const RETRO_TABLE_LINE = 'rgba(255,255,255,0.5)';
