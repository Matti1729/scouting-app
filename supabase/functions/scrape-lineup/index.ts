// Supabase Edge Function: Scrape Lineup from fussball.de
// Robuste Version mit Retry-Logik, Error-States, und verbessertem Team-Splitting
//
// Verbesserungen v2:
// - Retry mit Exponential Backoff für alle externen Calls
// - Explizite Error-States statt silent fallthrough
// - Verbesserter Team-Splitting Algorithmus mit Validierung
// - Rate-Limiting für Profile-Fetches
// - Strukturierte Fehler-Responses

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// ===========================================
// CONFIGURATION
// ===========================================

const BROWSERLESS_API_KEY = Deno.env.get('BROWSERLESS_API_KEY') || ''
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''

const BROWSERLESS_SCREENSHOT_URL = 'https://chrome.browserless.io/screenshot'

const CONFIG = {
  // Retry settings
  maxRetries: 3,
  initialRetryDelayMs: 1000,
  maxRetryDelayMs: 8000,

  // Timeouts
  screenshotTimeoutMs: 60000,
  claudeTimeoutMs: 30000,
  profileFetchTimeoutMs: 15000,

  // Rate limiting
  profileBatchSize: 10,
  profileBatchDelayMs: 500,

  // Validation
  minPlayersPerTeam: 7,
  maxPlayersPerTeam: 25,
  expectedStartersPerTeam: 11,
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ===========================================
// TYPES
// ===========================================

interface ScrapedPlayer {
  nummer: string
  name: string
  vorname: string
  position: string
  jahrgang: string
  profileUrl?: string
  club?: string  // Club-Name aus Spielerprofil für Team-Zuordnung
  originalIndex?: number  // Position im Original-HTML für korrekte Starter/Subs-Sortierung
  isSub?: boolean  // true wenn Spieler aus Ersatzbank-Sektion kommt
  isGoalkeeper?: boolean  // true wenn Spieler Torwart ist (div.captain > span.c = "T")
  isCaptain?: boolean  // true wenn Spieler Kapitän ist (div.captain > span.c = "C")
}

interface ScrapedLineups {
  homeTeam: string
  awayTeam: string
  homeStarters: ScrapedPlayer[]
  homeSubs: ScrapedPlayer[]
  awayStarters: ScrapedPlayer[]
  awaySubs: ScrapedPlayer[]
  result?: string
  available: boolean
  // Match metadata (aus AJAX match.info)
  matchDate?: string
  matchTime?: string
  location?: string
  league?: string
}

// Explicit error states for better debugging
enum ScrapeErrorCode {
  NONE = 'NONE',
  INVALID_INPUT = 'INVALID_INPUT',
  VISION_SCREENSHOT_FAILED = 'VISION_SCREENSHOT_FAILED',
  VISION_CLAUDE_FAILED = 'VISION_CLAUDE_FAILED',
  VISION_PARSE_FAILED = 'VISION_PARSE_FAILED',
  AJAX_MAIN_PAGE_FAILED = 'AJAX_MAIN_PAGE_FAILED',
  AJAX_LINEUP_FAILED = 'AJAX_LINEUP_FAILED',
  PROFILE_FETCH_FAILED = 'PROFILE_FETCH_FAILED',
  NO_LINEUP_AVAILABLE = 'NO_LINEUP_AVAILABLE',
  TEAM_SPLIT_FAILED = 'TEAM_SPLIT_FAILED',
}

interface ScrapeResult {
  success: boolean
  data?: ScrapedLineups
  error?: string
  errorCode: ScrapeErrorCode
  method?: 'vision' | 'ajax' | 'none'
  debug?: Record<string, unknown>
}

// ===========================================
// UTILITY FUNCTIONS
// ===========================================

/**
 * Retry wrapper with exponential backoff
 * Only retries on transient errors (5xx, timeouts, network errors)
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number
    initialDelayMs?: number
    maxDelayMs?: number
    shouldRetry?: (error: unknown) => boolean
    onRetry?: (attempt: number, error: unknown) => void
  } = {}
): Promise<T> {
  const {
    maxRetries = CONFIG.maxRetries,
    initialDelayMs = CONFIG.initialRetryDelayMs,
    maxDelayMs = CONFIG.maxRetryDelayMs,
    shouldRetry = isTransientError,
    onRetry,
  } = options

  let lastError: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      if (attempt === maxRetries || !shouldRetry(error)) {
        throw error
      }

      const delay = Math.min(initialDelayMs * Math.pow(2, attempt), maxDelayMs)
      onRetry?.(attempt + 1, error)
      console.log(`Retry ${attempt + 1}/${maxRetries} after ${delay}ms:`, String(error))
      await sleep(delay)
    }
  }
  throw lastError
}

/**
 * Check if error is transient (worth retrying)
 */
function isTransientError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    // Network errors
    if (message.includes('network') || message.includes('timeout') ||
        message.includes('econnreset') || message.includes('econnrefused')) {
      return true
    }
  }
  // Response errors
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status: number }).status
    // Retry on 5xx errors and 429 (rate limit)
    return status >= 500 || status === 429
  }
  return false
}

/**
 * Fetch with timeout
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number } = {}
): Promise<Response> {
  const { timeout = 30000, ...fetchOptions } = options

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    })
    return response
  } finally {
    clearTimeout(timeoutId)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ===========================================
// FONT DEOBFUSCATION (fussball.de uses CSS font substitution)
// ===========================================

/** Mapping from PostScript glyph names to actual characters (for special chars in fonts) */
const GLYPH_NAME_TO_CHAR: Record<string, string> = {
  // German umlauts
  'adieresis': 'ä', 'odieresis': 'ö', 'udieresis': 'ü', 'germandbls': 'ß',
  'Adieresis': 'Ä', 'Odieresis': 'Ö', 'Udieresis': 'Ü',
  // Accented characters (common in player names)
  'aacute': 'á', 'agrave': 'à', 'acircumflex': 'â', 'atilde': 'ã',
  'eacute': 'é', 'egrave': 'è', 'ecircumflex': 'ê', 'edieresis': 'ë',
  'iacute': 'í', 'igrave': 'ì', 'icircumflex': 'î', 'idieresis': 'ï',
  'oacute': 'ó', 'ograve': 'ò', 'ocircumflex': 'ô', 'otilde': 'õ',
  'uacute': 'ú', 'ugrave': 'ù', 'ucircumflex': 'û',
  'Eacute': 'É', 'Egrave': 'È',
  'Aacute': 'Á', 'Agrave': 'À',
  // Eastern European (Croatian, Czech, Polish, etc.)
  'ccaron': 'č', 'Ccaron': 'Č', 'cacute': 'ć', 'Cacute': 'Ć',
  'scaron': 'š', 'Scaron': 'Š', 'zcaron': 'ž', 'Zcaron': 'Ž',
  'ntilde': 'ñ', 'Ntilde': 'Ñ', 'ccedilla': 'ç', 'Ccedilla': 'Ç',
  'lslash': 'ł', 'Lslash': 'Ł',
  'rcaron': 'ř', 'Rcaron': 'Ř', 'dcaron': 'ď', 'Dcaron': 'Ď',
  'tcaron': 'ť', 'Tcaron': 'Ť', 'ncaron': 'ň', 'Ncaron': 'Ň',
  'sacute': 'ś', 'Sacute': 'Ś', 'zacute': 'ź', 'Zacute': 'Ź',
  'zdotaccent': 'ż', 'Zdotaccent': 'Ż',
  'aogonek': 'ą', 'Aogonek': 'Ą', 'eogonek': 'ę', 'Eogonek': 'Ę',
  'dcroat': 'đ', 'Dcroat': 'Đ',
  // Nordic
  'oslash': 'ø', 'Oslash': 'Ø', 'aring': 'å', 'Aring': 'Å',
  'eth': 'ð', 'Eth': 'Ð', 'thorn': 'þ', 'Thorn': 'Þ',
  // Turkish
  'gbreve': 'ğ', 'Gbreve': 'Ğ', 'scedilla': 'ş', 'Scedilla': 'Ş',
  'idotless': 'ı',
  // Additional accented
  'yacute': 'ý', 'Yacute': 'Ý', 'ydieresis': 'ÿ',
  // Punctuation
  'hyphen': '-', 'period': '.', 'space': ' ',
  'quotesingle': "'", 'quoteright': '\u2019',
}

/**
 * Minimal TTF cmap format 4 + post table parser.
 * Extracts the codepoint → glyph name mapping from a TrueType font,
 * which fussball.de uses to obfuscate player names via custom fonts.
 */
function parseTTFCmap(buffer: ArrayBuffer): Map<number, string> {
  const view = new DataView(buffer)
  const result = new Map<number, string>()

  // Read table directory
  const numTables = view.getUint16(4)
  let cmapOffset = 0
  let postOffset = 0
  let postLength = 0

  for (let i = 0; i < numTables; i++) {
    const offset = 12 + i * 16
    const tag = String.fromCharCode(
      view.getUint8(offset), view.getUint8(offset + 1),
      view.getUint8(offset + 2), view.getUint8(offset + 3)
    )
    if (tag === 'cmap') cmapOffset = view.getUint32(offset + 8)
    if (tag === 'post') {
      postOffset = view.getUint32(offset + 8)
      postLength = view.getUint32(offset + 12)
    }
  }

  if (!cmapOffset || !postOffset) return result

  // Parse post table to get glyphId → name mapping
  const glyphNames = new Map<number, string>()
  const postFormat = view.getUint32(postOffset) // Fixed-point: 0x00020000 = 2.0

  if (postFormat === 0x00020000) {
    // Format 2.0: has custom glyph names
    const numGlyphs = view.getUint16(postOffset + 32)
    const nameIndices: number[] = []

    for (let i = 0; i < numGlyphs; i++) {
      nameIndices.push(view.getUint16(postOffset + 34 + i * 2))
    }

    // Standard Mac glyph names (first 258)
    const macGlyphNames = [
      '.notdef', '.null', 'nonmarkingreturn', 'space', 'exclam', 'quotedbl', 'numbersign',
      'dollar', 'percent', 'ampersand', 'quotesingle', 'parenleft', 'parenright', 'asterisk',
      'plus', 'comma', 'hyphen', 'period', 'slash', 'zero', 'one', 'two', 'three', 'four',
      'five', 'six', 'seven', 'eight', 'nine', 'colon', 'semicolon', 'less', 'equal', 'greater',
      'question', 'at', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
      'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'bracketleft',
      'backslash', 'bracketright', 'asciicircum', 'underscore', 'grave', 'a', 'b', 'c', 'd',
      'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't',
      'u', 'v', 'w', 'x', 'y', 'z', 'braceleft', 'bar', 'braceright', 'asciitilde',
      'Adieresis', 'Aring', 'Ccedilla', 'Eacute', 'Ntilde', 'Odieresis', 'Udieresis',
      'aacute', 'agrave', 'acircumflex', 'adieresis', 'atilde', 'aring', 'ccedilla', 'eacute',
      'egrave', 'ecircumflex', 'edieresis', 'iacute', 'igrave', 'icircumflex', 'idieresis',
      'ntilde', 'oacute', 'ograve', 'ocircumflex', 'odieresis', 'otilde', 'uacute', 'ugrave',
      'ucircumflex', 'udieresis', 'dagger', 'degree', 'cent', 'sterling', 'section', 'bullet',
      'paragraph', 'germandbls', 'registered', 'copyright', 'trademark', 'acute', 'dieresis',
      'notequal', 'AE', 'Oslash', 'infinity', 'plusminus', 'lessequal', 'greaterequal', 'yen',
      'mu', 'partialdiff', 'summation', 'product', 'pi', 'integral', 'ordfeminine', 'ordmasculine',
      'Omega', 'ae', 'oslash', 'questiondown', 'exclamdown', 'logicalnot', 'radical', 'florin',
      'approxequal', 'Delta', 'guillemotleft', 'guillemotright', 'ellipsis', 'nonbreakingspace',
      'Agrave', 'Atilde', 'Otilde', 'OE', 'oe', 'endash', 'emdash', 'quotedblleft',
      'quotedblright', 'quoteleft', 'quoteright', 'divide', 'lozenge', 'ydieresis', 'Ydieresis',
      'fraction', 'currency', 'guilsinglleft', 'guilsinglright', 'fi', 'fl', 'daggerdbl',
      'periodcentered', 'quotesinglbase', 'quotedblbase', 'perthousand', 'Acircumflex',
      'Ecircumflex', 'Aacute', 'Edieresis', 'Egrave', 'Iacute', 'Icircumflex', 'Idieresis',
      'Igrave', 'Oacute', 'Ocircumflex', 'apple', 'Ograve', 'Uacute', 'Ucircumflex', 'Ugrave',
      'dotlessi', 'circumflex', 'tilde', 'macron', 'breve', 'dotaccent', 'ring', 'cedilla',
      'hungarumlaut', 'ogonek', 'caron', 'Lslash', 'lslash', 'Scaron', 'scaron', 'Zcaron',
      'zcaron', 'brokenbar', 'Eth', 'eth', 'Yacute', 'yacute', 'Thorn', 'thorn', 'minus',
      'multiply', 'onesuperior', 'twosuperior', 'threesuperior', 'onehalf', 'onequarter',
      'threequarters', 'franc', 'Gbreve', 'gbreve', 'Idotaccent', 'Scedilla', 'scedilla',
      'Cacute', 'cacute', 'Ccaron', 'ccaron', 'dcroat',
    ]

    // Read custom name strings after the indices
    let strOffset = postOffset + 34 + numGlyphs * 2
    const customNames: string[] = []
    while (strOffset < postOffset + postLength && customNames.length < 1000) {
      const len = view.getUint8(strOffset)
      strOffset++
      let name = ''
      for (let j = 0; j < len && strOffset + j < buffer.byteLength; j++) {
        name += String.fromCharCode(view.getUint8(strOffset + j))
      }
      customNames.push(name)
      strOffset += len
    }

    // Build glyphId → name mapping
    for (let i = 0; i < numGlyphs; i++) {
      const idx = nameIndices[i]
      if (idx < 258) {
        glyphNames.set(i, macGlyphNames[idx] || '')
      } else {
        glyphNames.set(i, customNames[idx - 258] || '')
      }
    }
  }

  if (glyphNames.size === 0) return result

  // Parse cmap table
  const cmapVersion = view.getUint16(cmapOffset)
  const numSubtables = view.getUint16(cmapOffset + 2)

  for (let i = 0; i < numSubtables; i++) {
    const subtableOffset = cmapOffset + 4 + i * 8
    const platformID = view.getUint16(subtableOffset)
    const encodingID = view.getUint16(subtableOffset + 2)
    const offset = view.getUint32(subtableOffset + 4)
    const tableStart = cmapOffset + offset

    // We want platformID=3 (Windows), encodingID=1 (Unicode BMP), format=4
    if (platformID !== 3 || encodingID !== 1) continue

    const format = view.getUint16(tableStart)
    if (format !== 4) continue

    const segCountX2 = view.getUint16(tableStart + 6)
    const segCount = segCountX2 / 2

    const endCountStart = tableStart + 14
    const startCountStart = endCountStart + segCountX2 + 2 // +2 for reservedPad
    const idDeltaStart = startCountStart + segCountX2
    const idRangeOffsetStart = idDeltaStart + segCountX2

    for (let seg = 0; seg < segCount; seg++) {
      const endCount = view.getUint16(endCountStart + seg * 2)
      const startCount = view.getUint16(startCountStart + seg * 2)
      const idDelta = view.getInt16(idDeltaStart + seg * 2)
      const idRangeOffset = view.getUint16(idRangeOffsetStart + seg * 2)

      if (startCount === 0xFFFF) break

      for (let cp = startCount; cp <= endCount; cp++) {
        let glyphId: number
        if (idRangeOffset === 0) {
          glyphId = (cp + idDelta) & 0xFFFF
        } else {
          const glyphIdOffset = idRangeOffsetStart + seg * 2 + idRangeOffset + (cp - startCount) * 2
          glyphId = view.getUint16(glyphIdOffset)
          if (glyphId !== 0) {
            glyphId = (glyphId + idDelta) & 0xFFFF
          }
        }

        if (glyphId === 0) continue

        // Only care about obfuscated codepoints (Private Use Area)
        if (cp < 0xE000 || cp > 0xF100) continue

        const glyphName = glyphNames.get(glyphId)
        if (!glyphName) continue

        // Single ASCII letters (A-Z, a-z)
        if (glyphName.length === 1 && /^[A-Za-z]$/.test(glyphName)) {
          result.set(cp, glyphName)
        }
        // Special characters: umlauts, accents, ß, hyphens, etc.
        else if (GLYPH_NAME_TO_CHAR[glyphName]) {
          result.set(cp, GLYPH_NAME_TO_CHAR[glyphName])
        }
      }
    }
  }

  return result
}

/**
 * Fetch the obfuscation font from fussball.de and build the decryption mapping.
 * Returns a Map from obfuscated codepoint → real character.
 */
async function fetchDeobfuscationMap(fontKey: string): Promise<Map<number, string>> {
  try {
    const fontUrl = `https://www.fussball.de/export.fontface/-/format/ttf/id/${fontKey}/type/font`
    const response = await fetchWithTimeout(fontUrl, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': '*/*',
      },
    })

    if (!response.ok) {
      console.warn(`Font fetch failed: ${response.status}`)
      return new Map()
    }

    const buffer = await response.arrayBuffer()
    const mapping = parseTTFCmap(buffer)
    console.log(`Font deobfuscation: loaded ${mapping.size} char mappings for key "${fontKey}"`)
    return mapping
  } catch (err) {
    console.warn('Font deobfuscation failed:', err)
    return new Map()
  }
}

/**
 * Decode an obfuscated HTML string using the font mapping.
 * Input: HTML entities like "&#xEA7C;&#xEBF5;" or raw Unicode chars
 * Output: decoded string like "Lu"
 */
function deobfuscateText(text: string, mapping: Map<number, string>): string {
  if (!text || mapping.size === 0) return text

  // First, decode HTML entities to codepoints
  const decoded = text.replace(/&#x([0-9A-Fa-f]+);/g, (_match, hex) => {
    const cp = parseInt(hex, 16)
    return String.fromCodePoint(cp)
  })

  // Then map each char through the font mapping
  let result = ''
  for (const ch of decoded) {
    const cp = ch.codePointAt(0)!
    const mapped = mapping.get(cp)
    if (mapped) {
      result += mapped
    } else if (cp < 0xE000) {
      // Normal character (space, etc.)
      result += ch
    }
    // Skip unmapped PUA characters (decoy glyphs)
  }

  return result
}

/**
 * Parse German name with better handling of compound names
 */
function parseGermanName(fullName: string): { vorname: string; name: string } {
  if (!fullName || fullName.trim().length === 0) {
    return { vorname: '', name: '' }
  }

  fullName = fullName.trim()
    // Remove everything after "|" (e.g. "| FUSSBALL.DE")
    .split('|')[0]
    .trim()
    // IMPORTANT: Remove "Spielerprofil" FIRST, before removing "(Verein)"
    .replace(/\s*-?\s*(?:Spielerprofil|Basisprofil)\s*$/i, '')
    .trim()
    // NOW remove "(Verein)" which is at the end after Spielerprofil was removed
    .replace(/\s*\([^)]+\)\s*$/, '')
    .trim()

  // Handle "Nachname, Vorname" format
  if (fullName.includes(',')) {
    const [nachname, vorname] = fullName.split(',').map(s => s.trim())
    return { vorname: vorname || '', name: nachname || '' }
  }

  const parts = fullName.split(/\s+/)
  if (parts.length === 1) {
    return { vorname: '', name: parts[0] }
  }

  // Last part is surname, rest is first name (handles "Jan-Niklas Müller")
  const name = parts.pop() || ''
  const vorname = parts.join(' ')
  return { vorname, name }
}

// ===========================================
// CLAUDE VISION PROMPT
// ===========================================

const LINEUP_EXTRACTION_PROMPT = `Dies ist ein Screenshot von fussball.de. Analysiere das Bild und extrahiere die Aufstellung des Fußballspiels.

SCHRITT 1: Finde die Mannschaftsnamen
- Der Seitentitel zeigt meist "Team A - Team B"
- Links ist die Heim-Mannschaft (home), rechts die Gast-Mannschaft (away)

SCHRITT 2: Finde die Spielerliste
- Die Aufstellung zeigt Spieler mit Trikotnummer und Namen
- Format ist oft: [Nummer] [Vorname Nachname]
- Startelf: die ersten 11 Spieler pro Team
- Auswechsler/Bank: weitere Spieler darunter

SCHRITT 3: Extrahiere jeden Spieler
Für jeden sichtbaren Spieler notiere:
- nummer: Die Trikotnummer (z.B. "1", "7", "23")
- vorname: Der Vorname (z.B. "Max", "Jan-Niklas")
- name: Der Nachname (z.B. "Müller", "Schmidt")

WICHTIG:
- Schreibe Namen GENAU wie sie angezeigt werden
- Wenn nur ein Name sichtbar ist, setze ihn als "name" (Nachname)
- Bei Doppelnamen behalte die vollständige Schreibweise
- TRENNE Heim- und Gast-Spieler korrekt (links = Heim, rechts = Gast)

Gib das Ergebnis NUR als JSON zurück (KEIN Markdown, KEINE Erklärungen):
{
  "homeTeam": "Mannschaftsname links",
  "awayTeam": "Mannschaftsname rechts",
  "homeStarters": [{"nummer": "1", "vorname": "Max", "name": "Müller"}, ...],
  "homeSubs": [...],
  "awayStarters": [...],
  "awaySubs": []
}

Falls KEINE Spielernamen sichtbar sind (nur Nummern oder leere Seite):
{"homeTeam": "", "awayTeam": "", "homeStarters": [], "homeSubs": [], "awayStarters": [], "awaySubs": [], "noLineup": true}`

// ===========================================
// VISION METHOD (Screenshot + Claude)
// ===========================================

async function scrapeWithVision(
  lineupUrl: string,
  debugInfo: Record<string, unknown>
): Promise<ScrapeResult> {
  if (!BROWSERLESS_API_KEY || !ANTHROPIC_API_KEY) {
    console.log('Vision method: Missing API keys')
    return {
      success: false,
      errorCode: ScrapeErrorCode.VISION_SCREENSHOT_FAILED,
      error: 'Missing API keys for vision method',
    }
  }

  debugInfo.method = 'vision'

  // Step 1: Take screenshot with retry
  let screenshotBase64: string
  try {
    console.log('Taking screenshot of:', lineupUrl)

    const screenshotResponse = await withRetry(
      async () => {
        const response = await fetchWithTimeout(
          `${BROWSERLESS_SCREENSHOT_URL}?token=${BROWSERLESS_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            timeout: CONFIG.screenshotTimeoutMs,
            body: JSON.stringify({
              url: lineupUrl,
              gotoOptions: {
                waitUntil: 'networkidle2',
                timeout: CONFIG.screenshotTimeoutMs,
              },
              waitForTimeout: 12000, // Wait for Angular SPA
              options: {
                fullPage: true,
                type: 'png',
                encoding: 'base64',
              },
            }),
          }
        )

        if (!response.ok) {
          const errorText = await response.text()
          throw Object.assign(new Error(`Screenshot failed: ${errorText.substring(0, 200)}`), { status: response.status })
        }

        return response
      },
      {
        onRetry: (attempt) => {
          debugInfo[`screenshotRetry${attempt}`] = true
        },
      }
    )

    screenshotBase64 = await screenshotResponse.text()
    debugInfo.screenshotSize = screenshotBase64.length
    console.log('Screenshot captured, size:', screenshotBase64.length)

    if (screenshotBase64.length < 1000) {
      return {
        success: false,
        errorCode: ScrapeErrorCode.VISION_SCREENSHOT_FAILED,
        error: 'Screenshot too small (likely error page)',
      }
    }
  } catch (error) {
    console.error('Screenshot failed after retries:', error)
    debugInfo.screenshotError = String(error)
    return {
      success: false,
      errorCode: ScrapeErrorCode.VISION_SCREENSHOT_FAILED,
      error: `Screenshot failed: ${error}`,
    }
  }

  // Step 2: Claude Vision analysis with retry
  try {
    console.log('Sending to Claude Vision for analysis')

    const claudeResponse = await withRetry(
      async () => {
        const response = await fetchWithTimeout(
          'https://api.anthropic.com/v1/messages',
          {
            method: 'POST',
            timeout: CONFIG.claudeTimeoutMs,
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': ANTHROPIC_API_KEY,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: 'claude-sonnet-4-20250514',
              max_tokens: 8192,
              messages: [{
                role: 'user',
                content: [
                  {
                    type: 'image',
                    source: {
                      type: 'base64',
                      media_type: 'image/png',
                      data: screenshotBase64,
                    },
                  },
                  { type: 'text', text: LINEUP_EXTRACTION_PROMPT },
                ],
              }],
            }),
          }
        )

        if (!response.ok) {
          const errorText = await response.text()
          throw Object.assign(new Error(`Claude API error: ${errorText.substring(0, 200)}`), { status: response.status })
        }

        return response
      },
      {
        onRetry: (attempt) => {
          debugInfo[`claudeRetry${attempt}`] = true
        },
      }
    )

    const claudeResult = await claudeResponse.json()
    const responseText = claudeResult.content?.[0]?.text || ''
    debugInfo.claudeResponseLength = responseText.length

    // Parse JSON from response
    let jsonText = responseText.trim()
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.replace(/^```json\s*/, '').replace(/\s*```$/, '')
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```\s*/, '').replace(/\s*```$/, '')
    }

    const lineupData = JSON.parse(jsonText)

    if (lineupData.noLineup) {
      console.log('Claude: No lineup visible in screenshot')
      return {
        success: true,
        errorCode: ScrapeErrorCode.NO_LINEUP_AVAILABLE,
        method: 'vision',
        data: {
          homeTeam: '',
          awayTeam: '',
          homeStarters: [],
          homeSubs: [],
          awayStarters: [],
          awaySubs: [],
          available: false,
        },
      }
    }

    // Format and validate player data
    const formatPlayer = (p: { nummer?: string; vorname?: string; name?: string }): ScrapedPlayer => ({
      nummer: p.nummer || '',
      vorname: p.vorname || '',
      name: p.name || '',
      position: '',
      jahrgang: '',
    })

    const result: ScrapedLineups = {
      homeTeam: lineupData.homeTeam || '',
      awayTeam: lineupData.awayTeam || '',
      homeStarters: (lineupData.homeStarters || []).map(formatPlayer),
      homeSubs: (lineupData.homeSubs || []).map(formatPlayer),
      awayStarters: (lineupData.awayStarters || []).map(formatPlayer),
      awaySubs: (lineupData.awaySubs || []).map(formatPlayer),
      available: true,
    }

    // Validate result
    const totalHome = result.homeStarters.length + result.homeSubs.length
    const totalAway = result.awayStarters.length + result.awaySubs.length
    debugInfo.visionPlayersFound = { home: totalHome, away: totalAway }

    if (totalHome < CONFIG.minPlayersPerTeam || totalAway < CONFIG.minPlayersPerTeam) {
      console.log(`Vision: Insufficient players (home: ${totalHome}, away: ${totalAway})`)
      // Return partial data but mark as potentially incomplete
      debugInfo.visionWarning = 'Low player count'
    }

    console.log('Vision method successful:', {
      homeTeam: result.homeTeam,
      awayTeam: result.awayTeam,
      homeStarters: result.homeStarters.length,
      homeSubs: result.homeSubs.length,
      awayStarters: result.awayStarters.length,
      awaySubs: result.awaySubs.length,
    })

    return {
      success: true,
      errorCode: ScrapeErrorCode.NONE,
      method: 'vision',
      data: result,
    }
  } catch (error) {
    console.error('Claude Vision failed:', error)
    debugInfo.claudeError = String(error)

    // Check if it's a parse error
    if (error instanceof SyntaxError) {
      return {
        success: false,
        errorCode: ScrapeErrorCode.VISION_PARSE_FAILED,
        error: `Failed to parse Claude response: ${error}`,
      }
    }

    return {
      success: false,
      errorCode: ScrapeErrorCode.VISION_CLAUDE_FAILED,
      error: `Claude API failed: ${error}`,
    }
  }
}

// ===========================================
// AJAX METHOD (Fallback)
// ===========================================

async function scrapeWithAjax(
  gameId: string,
  url: string | undefined,
  debugInfo: Record<string, unknown>
): Promise<ScrapeResult> {
  debugInfo.method = 'ajax'

  const mainPageUrl = url ? url.split('#')[0] : `https://www.fussball.de/spiel/-/-/spiel/${gameId}`

  // Step 1: Load main page for session/cookies
  let mainPageHtml: string
  let homeTeam = ''
  let awayTeam = ''
  let cookies = ''

  try {
    const mainPageResponse = await withRetry(
      async () => {
        const response = await fetchWithTimeout(mainPageUrl, {
          method: 'GET',
          timeout: 15000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'de-DE,de;q=0.9',
          },
        })

        if (!response.ok) {
          throw Object.assign(new Error(`Main page failed: ${response.status}`), { status: response.status })
        }

        return response
      }
    )

    mainPageHtml = await mainPageResponse.text()
    debugInfo.mainPageLength = mainPageHtml.length

    // Extract teams from title
    const titleMatch = mainPageHtml.match(/<title>([^<]+)<\/title>/i)
    if (titleMatch) {
      const teamsMatch = titleMatch[1].match(/^(.+?)\s+-\s+(.+?)(?:\s+Ergebnis|\s*\|)/i)
      if (teamsMatch) {
        homeTeam = teamsMatch[1].trim()
        awayTeam = teamsMatch[2].trim()
      }
    }

    // Extract cookies
    const setCookieHeaders = mainPageResponse.headers.get('set-cookie') || ''
    cookies = setCookieHeaders.split(',').map(c => c.split(';')[0].trim()).filter(c => c).join('; ')
  } catch (error) {
    console.error('Main page fetch failed:', error)
    debugInfo.mainPageError = String(error)
    return {
      success: false,
      errorCode: ScrapeErrorCode.AJAX_MAIN_PAGE_FAILED,
      error: `Failed to load main page: ${error}`,
    }
  }

  // Step 2: AJAX request for lineup data
  try {
    const ajaxUrl = `https://www.fussball.de/ajax.match.lineup/-/mode/PAGE/spiel/${gameId}/ticker-id/selectedTickerId`

    const ajaxResponse = await withRetry(
      async () => {
        const headers: Record<string, string> = {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': mainPageUrl,
          'Accept': '*/*',
        }
        if (cookies) headers['Cookie'] = cookies

        const response = await fetchWithTimeout(ajaxUrl, {
          method: 'GET',
          timeout: 15000,
          headers,
        })

        if (!response.ok) {
          throw Object.assign(new Error(`AJAX failed: ${response.status}`), { status: response.status })
        }

        return response
      }
    )

    const ajaxHtml = await ajaxResponse.text()
    debugInfo.ajaxLength = ajaxHtml.length

    // Redirect detection: if response is the homepage instead of lineup data
    if (ajaxHtml.includes('<title>FUSSBALL.DE</title>') || ajaxHtml.length > 100000) {
      console.log('AJAX: Got homepage redirect instead of lineup data')
      throw Object.assign(new Error('AJAX returned homepage instead of lineup'), { status: 302 })
    }

    // Check if lineup data exists
    const noDataIndicators = ['keine Daten verfügbar', 'Noch keine Aufstellung', 'no lineup']
    const hasNoData = noDataIndicators.some(indicator =>
      ajaxHtml.toLowerCase().includes(indicator.toLowerCase())
    )
    const hasPlayers = ajaxHtml.includes('spielerprofil') || ajaxHtml.includes('player-wrapper')

    if (hasNoData || !hasPlayers) {
      console.log('AJAX: No lineup data available')
      return {
        success: true,
        errorCode: ScrapeErrorCode.NO_LINEUP_AVAILABLE,
        method: 'ajax',
        data: {
          homeTeam,
          awayTeam,
          homeStarters: [],
          homeSubs: [],
          awayStarters: [],
          awaySubs: [],
          available: false,
        },
      }
    }

    // Step 3: Font deobfuscation - extract key and fetch font mapping
    let fontMapping = new Map<number, string>()
    const fontKeyMatch = ajaxHtml.match(/data-obfuscation="([a-z0-9]+)"/i)
    if (fontKeyMatch) {
      const fontKey = fontKeyMatch[1]
      debugInfo.fontKey = fontKey
      console.log(`Font obfuscation key: ${fontKey}`)
      fontMapping = await fetchDeobfuscationMap(fontKey)
      debugInfo.fontMappingSize = fontMapping.size
    }

    // Step 4: Extract players with improved team splitting
    const { home, away, confidence } = extractPlayersWithTeams(ajaxHtml, fontMapping)
    debugInfo.playersFound = { home: home.length, away: away.length, splitConfidence: confidence }
    console.log(`Found ${home.length} home + ${away.length} away players (confidence: ${confidence})`)

    // Validate split
    if (confidence < 0.5) {
      console.warn('Low confidence team split - results may be inaccurate')
      debugInfo.teamSplitWarning = 'Low confidence'
    }

    // Step 5: Fetch player names from profiles (with rate limiting)
    // Now primarily for club info; names already decoded from font
    console.log('Fetching player names from profiles...')
    const homeWithNames = await fetchPlayerNamesFromProfiles(home, debugInfo)
    const awayWithNames = await fetchPlayerNamesFromProfiles(away, debugInfo)

    const namesFound = [...homeWithNames, ...awayWithNames].filter(p => p.name || p.vorname).length
    const clubsFound = [...homeWithNames, ...awayWithNames].filter(p => p.club).length
    debugInfo.namesFound = namesFound
    debugInfo.clubsFound = clubsFound
    console.log(`Extracted ${namesFound} names and ${clubsFound} clubs from profiles`)

    // Step 5: Correct team assignment based on club name in player profile
    // Player names often contain their club: "Kühn (RasenBallsport Leipzig)"
    const { correctedHome, correctedAway, corrections } = correctTeamAssignment(
      homeWithNames,
      awayWithNames,
      homeTeam,
      awayTeam
    )
    debugInfo.teamCorrections = corrections

    if (corrections > 0) {
      console.log(`Corrected ${corrections} player team assignments based on club names`)
    }

    // Use isSub flag if available (from player-wrapper extraction)
    // Otherwise fall back to taking first 11 as starters
    const splitBySubFlag = (players: ScrapedPlayer[]) => {
      const hasSubFlags = players.some(p => p.isSub !== undefined)
      if (hasSubFlags) {
        // Use isSub flag for accurate split
        const starters = players.filter(p => !p.isSub)
        const subs = players.filter(p => p.isSub)
        return { starters, subs }
      } else {
        // Fall back to first 11 as starters
        return {
          starters: players.slice(0, CONFIG.expectedStartersPerTeam),
          subs: players.slice(CONFIG.expectedStartersPerTeam)
        }
      }
    }

    const homeSplit = splitBySubFlag(correctedHome)
    const awaySplit = splitBySubFlag(correctedAway)

    // Metadaten (Datum, Uhrzeit, Ort) direkt aus der Main Page extrahieren
    // (die Main Page wurde bereits oben geladen für Font-Key/Cookies)
    let matchDate = ''
    let matchTime = ''
    let matchLocation = ''
    let league = ''
    try {
      const titleTag = mainPageHtml.match(/<title>([^<]+)<\/title>/i)?.[1] || ''
      matchDate = extractDateFromAjax(mainPageHtml, titleTag)
      matchTime = extractTimeFromAjax(mainPageHtml)
      matchLocation = extractLocationFromAjax(mainPageHtml)
      league = extractLeagueFromTitle(mainPageHtml)
      console.log('Match metadata extracted from main page:', { matchDate, matchTime, matchLocation, league })
    } catch (metaError) {
      console.log('Match metadata extraction failed (non-fatal):', metaError)
    }

    const result: ScrapedLineups = {
      homeTeam,
      awayTeam,
      homeStarters: homeSplit.starters,
      homeSubs: homeSplit.subs,
      awayStarters: awaySplit.starters,
      awaySubs: awaySplit.subs,
      available: true,
      matchDate,
      matchTime,
      location: matchLocation,
      league,
    }

    console.log('AJAX method successful')
    return {
      success: true,
      errorCode: ScrapeErrorCode.NONE,
      method: 'ajax',
      data: result,
    }
  } catch (error) {
    console.error('AJAX lineup fetch failed:', error)
    debugInfo.ajaxError = String(error)
    return {
      success: false,
      errorCode: ScrapeErrorCode.AJAX_LINEUP_FAILED,
      error: `AJAX lineup request failed: ${error}`,
    }
  }
}

// ===========================================
// TEAM SPLITTING (Improved Algorithm)
// ===========================================

interface TeamSplitResult {
  home: ScrapedPlayer[]
  away: ScrapedPlayer[]
  confidence: number  // 0-1 confidence score
}

function extractPlayersWithTeams(html: string, fontMapping?: Map<number, string>): TeamSplitResult {
  // Method 1: Try player-wrapper class based extraction (most reliable)
  // fussball.de uses class="player-wrapper home" and class="player-wrapper away"
  const playerWrapperResult = tryPlayerWrapperExtraction(html, fontMapping)
  if (playerWrapperResult) {
    return { ...playerWrapperResult, confidence: 0.99 }
  }

  // Method 2: Try HTML class-based splitting (legacy patterns)
  const classSplitResult = tryClassBasedSplit(html)
  if (classSplitResult) {
    return { ...classSplitResult, confidence: 0.95 }
  }

  // Method 3: Gap-based splitting with validation (fallback)
  const allPlayers = extractAllPlayers(html)

  if (allPlayers.length === 0) {
    return { home: [], away: [], confidence: 0 }
  }

  // Find best split point using multiple heuristics
  const bestSplit = findBestSplitPoint(allPlayers)

  // Preserve global HTML index for proper starter/subs ordering after team correction
  // This allows us to maintain original order even when players are moved between teams
  const homePlayers = allPlayers.slice(0, bestSplit.index).map(p => ({
    ...p.player,
    originalIndex: p.index,  // Global HTML position
  }))
  const awayPlayers = allPlayers.slice(bestSplit.index).map(p => ({
    ...p.player,
    originalIndex: p.index,  // Global HTML position
  }))

  return {
    home: homePlayers,
    away: awayPlayers,
    confidence: bestSplit.confidence,
  }
}

/**
 * Extract players using the player-wrapper class which includes team info.
 * fussball.de uses class="player-wrapper home" and class="player-wrapper away"
 * Also detects if player is in "substitutes" section to properly mark starters vs subs.
 */
function tryPlayerWrapperExtraction(html: string, fontMapping?: Map<number, string>): { home: ScrapedPlayer[]; away: ScrapedPlayer[] } | null {
  const homePlayers: ScrapedPlayer[] = []
  const awayPlayers: ScrapedPlayer[] = []
  const seenUrls = new Set<string>()
  const hasFontMapping = fontMapping && fontMapping.size > 0

  // Find position of substitutes section
  const substitutesMatch = html.match(/class="[^"]*substitutes[^"]*"/i)
  const substitutesPosition = substitutesMatch?.index ?? Infinity

  // Pattern to match player-wrapper with team info
  // Matches both players with profile URLs and players without (href="#")
  // Also captures firstname and lastname spans for players without profiles
  // Note: players with profiles have data-obfuscation attribute, players without don't
  // After player-number, there may be a <div class="captain"><span class="c">T/C</span></div>
  // T = Torwart (goalkeeper), C = Kapitän (captain)
  const playerPattern = /<a[^>]*href="([^"]*)"[^>]*class="player-wrapper (home|away)"[^>]*>[\s\S]*?<span[^>]*class="firstname"[^>]*>([^<]*)<\/span><span[^>]*class="lastname"[^>]*>([^<]*)<\/span>[\s\S]*?<span class="player-number">([T\d]+)<\/span>[\s\S]*?<\/a>/gi

  for (const match of html.matchAll(playerPattern)) {
    const profileUrl = match[1]
    const team = match[2].toLowerCase()  // "home" or "away"
    const firstnameRaw = match[3]  // Obfuscated HTML entities or plain text
    const lastnameRaw = match[4]   // Obfuscated HTML entities, "k.A.", or plain text
    const nummerRaw = match[5]
    const matchPosition = match.index!
    const fullBlock = match[0]  // Full matched HTML block for captain/GK detection

    // Check for captain div marker: <div class="captain"><span class="c">T</span></div>
    // T = Torwart (goalkeeper), C = Kapitän (captain)
    const captainMarker = fullBlock.match(/<div class="captain"><span class="c">([^<]+)<\/span><\/div>/i)
    const markerValue = captainMarker ? captainMarker[1].toUpperCase().trim() : ''

    // Goalkeeper: either marked with "T" in captain div, or number is literally "T"
    const isGoalkeeper = markerValue === 'T' || nummerRaw.toUpperCase() === 'T'
    // Captain: marked with "C" in captain div
    const isCaptain = markerValue === 'C'
    const nummer = nummerRaw.toUpperCase() === 'T' ? '1' : nummerRaw  // Torwart gets number 1 if "T"

    // Skip duplicates (but not for players without profile URL)
    const hasProfile = profileUrl.includes('spielerprofil')
    if (hasProfile && seenUrls.has(profileUrl)) continue

    // Validate number (skip if not goalkeeper and not valid number)
    if (!isGoalkeeper) {
      const nummerInt = parseInt(nummer)
      if (isNaN(nummerInt) || nummerInt < 1 || nummerInt > 99) continue
    }

    if (hasProfile) {
      seenUrls.add(profileUrl)
    }

    // Try to decode names using font mapping (primary method)
    let vorname = ''
    let name = ''

    if (hasFontMapping && firstnameRaw.includes('&#x')) {
      // Names are obfuscated with font substitution - decode them
      vorname = deobfuscateText(firstnameRaw, fontMapping!)
      name = deobfuscateText(lastnameRaw, fontMapping!)
    }

    // If font decoding didn't work, check for plain text names
    if (!name) {
      const isNoProfile = !hasProfile || lastnameRaw === 'k.A.'
      if (isNoProfile) {
        name = 'k.A.'
      }
      // Otherwise name stays empty, will be filled by profile fetch
    }

    const player: ScrapedPlayer = {
      nummer,
      name,
      vorname,
      position: '',
      jahrgang: '',
      profileUrl: hasProfile ? profileUrl : undefined,
      originalIndex: matchPosition,
      isSub: matchPosition > substitutesPosition,  // Player is sub if after substitutes section
      isGoalkeeper,
      isCaptain,
    }

    if (team === 'home') {
      homePlayers.push(player)
    } else {
      awayPlayers.push(player)
    }
  }

  // Validate we found enough players
  if (homePlayers.length < CONFIG.minPlayersPerTeam || awayPlayers.length < CONFIG.minPlayersPerTeam) {
    console.log(`Player-wrapper extraction found too few players: ${homePlayers.length} home, ${awayPlayers.length} away`)
    return null
  }

  // Sort each team: starters (isSub=false) first, then subs (isSub=true)
  // Within starters, goalkeeper comes first
  // Within each group, sort by originalIndex
  const sortPlayers = (players: ScrapedPlayer[]) => {
    return players.sort((a, b) => {
      // Starters before subs
      if (a.isSub !== b.isSub) {
        return a.isSub ? 1 : -1
      }
      // Within starters: goalkeeper first
      if (!a.isSub && !b.isSub) {
        if (a.isGoalkeeper && !b.isGoalkeeper) return -1
        if (!a.isGoalkeeper && b.isGoalkeeper) return 1
      }
      // Within same group, sort by original position
      return (a.originalIndex ?? 0) - (b.originalIndex ?? 0)
    })
  }

  console.log(`Player-wrapper extraction successful: ${homePlayers.length} home, ${awayPlayers.length} away`)
  console.log(`  Substitutes section at position: ${substitutesPosition}`)

  return {
    home: sortPlayers(homePlayers),
    away: sortPlayers(awayPlayers),
  }
}

function tryClassBasedSplit(html: string): { home: ScrapedPlayer[]; away: ScrapedPlayer[] } | null {
  const splitPatterns = [
    // column-left / column-right
    {
      home: /class="[^"]*column-left[^"]*"([\s\S]*?)(?=class="[^"]*column-right)/i,
      away: /class="[^"]*column-right[^"]*"([\s\S]*?)(?=<\/div>\s*<\/div>\s*$|$)/i
    },
    // aufstellung-heim / aufstellung-gast
    {
      home: /class="[^"]*aufstellung[_-]?heim[^"]*"([\s\S]*?)(?=class="[^"]*aufstellung[_-]?gast)/i,
      away: /class="[^"]*aufstellung[_-]?gast[^"]*"([\s\S]*?)$/i
    },
    // row-team0 / row-team1
    {
      home: /class="[^"]*team[_-]?0[^"]*"([\s\S]*?)(?=class="[^"]*team[_-]?1)/i,
      away: /class="[^"]*team[_-]?1[^"]*"([\s\S]*?)$/i
    },
    // lineup-home / lineup-away
    {
      home: /class="[^"]*lineup[_-]?home[^"]*"([\s\S]*?)(?=class="[^"]*lineup[_-]?away)/i,
      away: /class="[^"]*lineup[_-]?away[^"]*"([\s\S]*?)$/i
    },
  ]

  for (const pattern of splitPatterns) {
    const homeMatch = html.match(pattern.home)
    const awayMatch = html.match(pattern.away)

    if (homeMatch && awayMatch) {
      const homePlayers = extractPlayersFromHtml(homeMatch[0])
      const awayPlayers = extractPlayersFromHtml(awayMatch[0])

      // Validate that both teams have reasonable player counts
      if (homePlayers.length >= CONFIG.minPlayersPerTeam &&
          awayPlayers.length >= CONFIG.minPlayersPerTeam) {
        console.log('Class-based split successful')
        return { home: homePlayers, away: awayPlayers }
      }
    }
  }

  return null
}

interface PlayerWithIndex {
  player: ScrapedPlayer
  index: number
}

function extractAllPlayers(html: string): PlayerWithIndex[] {
  const players: PlayerWithIndex[] = []
  const seenUrls = new Set<string>()

  const playerPattern = /<a[^>]*href="([^"]*spielerprofil[^"]*)"[^>]*>[\s\S]*?<span[^>]*>(\d+)<\/span>[\s\S]*?<\/a>/gi

  for (const match of html.matchAll(playerPattern)) {
    const profileUrl = match[1]
    const nummer = match[2]

    // Skip duplicates and invalid numbers
    if (seenUrls.has(profileUrl)) continue
    const nummerInt = parseInt(nummer)
    if (isNaN(nummerInt) || nummerInt < 1 || nummerInt > 99) continue

    seenUrls.add(profileUrl)

    players.push({
      player: {
        nummer,
        name: '',
        vorname: '',
        position: '',
        jahrgang: '',
        profileUrl: profileUrl.startsWith('http') ? profileUrl : `https://www.fussball.de${profileUrl}`,
      },
      index: match.index!,
    })
  }

  return players
}

interface SplitPoint {
  index: number
  confidence: number
}

function findBestSplitPoint(players: PlayerWithIndex[]): SplitPoint {
  if (players.length <= 1) {
    return { index: 0, confidence: 0 }
  }

  // Calculate gaps between consecutive players
  const gaps: { index: number; gap: number }[] = []
  for (let i = 1; i < players.length; i++) {
    gaps.push({
      index: i,
      gap: players[i].index - players[i - 1].index,
    })
  }

  // Find the largest gap
  gaps.sort((a, b) => b.gap - a.gap)
  const largestGap = gaps[0]
  const secondLargestGap = gaps[1]

  // Calculate confidence based on gap ratio
  let confidence = 0.5  // Base confidence

  if (secondLargestGap && largestGap.gap > 0) {
    // If largest gap is significantly bigger than second largest, high confidence
    const ratio = largestGap.gap / secondLargestGap.gap
    if (ratio > 3) confidence = 0.9
    else if (ratio > 2) confidence = 0.8
    else if (ratio > 1.5) confidence = 0.7
  }

  // Validate the split produces reasonable team sizes
  const homeCount = largestGap.index
  const awayCount = players.length - largestGap.index

  // Both teams should have between 7-25 players
  if (homeCount < CONFIG.minPlayersPerTeam || awayCount < CONFIG.minPlayersPerTeam ||
      homeCount > CONFIG.maxPlayersPerTeam || awayCount > CONFIG.maxPlayersPerTeam) {
    // Split doesn't make sense, fall back to middle
    console.log(`Invalid split (${homeCount}/${awayCount}), using middle`)
    const middleIndex = Math.ceil(players.length / 2)
    return { index: middleIndex, confidence: 0.3 }
  }

  // Teams should be roughly equal (within 50% difference)
  const sizeDiff = Math.abs(homeCount - awayCount) / Math.max(homeCount, awayCount)
  if (sizeDiff > 0.5) {
    confidence *= 0.7  // Reduce confidence for unequal teams
  }

  console.log(`Split at index ${largestGap.index} (gap: ${largestGap.gap}): ${homeCount} home, ${awayCount} away`)
  return { index: largestGap.index, confidence }
}

function extractPlayersFromHtml(html: string): ScrapedPlayer[] {
  const players: ScrapedPlayer[] = []
  const seenUrls = new Set<string>()

  const playerPattern = /<a[^>]*href="([^"]*spielerprofil[^"]*)"[^>]*>[\s\S]*?<span[^>]*>(\d+)<\/span>[\s\S]*?<\/a>/gi

  let index = 0
  for (const match of html.matchAll(playerPattern)) {
    const profileUrl = match[1]
    const nummer = match[2]

    if (seenUrls.has(profileUrl)) continue
    const nummerInt = parseInt(nummer)
    if (isNaN(nummerInt) || nummerInt < 1 || nummerInt > 99) continue

    seenUrls.add(profileUrl)

    players.push({
      nummer,
      name: '',
      vorname: '',
      position: '',
      jahrgang: '',
      profileUrl: profileUrl.startsWith('http') ? profileUrl : `https://www.fussball.de${profileUrl}`,
      originalIndex: index++,  // Preserve order within team section
    })
  }

  return players
}

// ===========================================
// TEAM CORRECTION (based on club name in profile)
// ===========================================

/**
 * Correct team assignments based on club name found in player profiles.
 * Player names from profiles often include the club: "Kühn (RasenBallsport Leipzig)"
 * This allows us to fix misassigned players after the initial split.
 */
function correctTeamAssignment(
  homePlayers: ScrapedPlayer[],
  awayPlayers: ScrapedPlayer[],
  homeTeam: string,
  awayTeam: string
): { correctedHome: ScrapedPlayer[]; correctedAway: ScrapedPlayer[]; corrections: number } {
  // Normalize team names for matching
  const normalizeTeamName = (name: string): string[] => {
    // Create multiple variants for matching
    const normalized = name.toLowerCase()
      .replace(/[^\w\säöüß]/g, '')  // Remove special chars except umlauts
      .trim()

    // Split into words and create variants
    const words = normalized.split(/\s+/)
    const variants = [normalized]

    // Add individual significant words (ignore common words)
    const ignoreWords = ['fc', 'sv', 'vfl', 'tsg', 'sc', 'fsv', 'bsc', 'ev', 'e.v.', '1.', '2.', 'i', 'ii', 'u15', 'u16', 'u17', 'u18', 'u19']
    for (const word of words) {
      if (word.length > 3 && !ignoreWords.includes(word)) {
        variants.push(word)
      }
    }

    // Add common abbreviations
    if (normalized.includes('rasenballsport') || normalized.includes('rb leipzig')) {
      variants.push('leipzig', 'rasenballsport', 'rb')
    }
    if (normalized.includes('borussia') || normalized.includes('bvb')) {
      variants.push('dortmund', 'borussia', 'bvb')
    }

    return variants
  }

  const homeVariants = normalizeTeamName(homeTeam)
  const awayVariants = normalizeTeamName(awayTeam)

  /**
   * Determine a player's team based on club info from their profile.
   * Priority: 1) club field (reliable), 2) name parsing (fallback)
   */
  const getTeamFromPlayer = (player: ScrapedPlayer): 'home' | 'away' | null => {
    // PRIORITY 1: Club field from profile (most reliable)
    if (player.club) {
      const clubLower = player.club.toLowerCase()

      // Check if it matches away team
      for (const variant of awayVariants) {
        if (clubLower.includes(variant)) {
          return 'away'
        }
      }

      // Check if it matches home team
      for (const variant of homeVariants) {
        if (clubLower.includes(variant)) {
          return 'home'
        }
      }
    }

    // PRIORITY 2: Check for team name in parentheses: "Name (Team)" (fallback)
    const fullName = `${player.vorname} ${player.name}`.toLowerCase()
    const parenMatch = fullName.match(/\(([^)]+)\)/)
    if (parenMatch) {
      const teamInName = parenMatch[1].toLowerCase()

      // Check if it matches away team
      for (const variant of awayVariants) {
        if (teamInName.includes(variant)) {
          return 'away'
        }
      }

      // Check if it matches home team
      for (const variant of homeVariants) {
        if (teamInName.includes(variant)) {
          return 'home'
        }
      }
    }

    return null
  }

  const correctedHome: ScrapedPlayer[] = []
  const correctedAway: ScrapedPlayer[] = []
  let corrections = 0

  // Process home players - check if they actually belong to away team
  for (const player of homePlayers) {
    const detectedTeam = getTeamFromPlayer(player)
    if (detectedTeam === 'away') {
      // Player has away team club but was assigned to home -> move to away
      correctedAway.push(player)
      corrections++
      console.log(`Moved ${player.vorname} ${player.name} (club: ${player.club}) from home to away`)
    } else {
      correctedHome.push(player)
    }
  }

  // Process away players - check if they actually belong to home team
  for (const player of awayPlayers) {
    const detectedTeam = getTeamFromPlayer(player)
    if (detectedTeam === 'home') {
      // Player has home team club but was assigned to away -> move to home
      correctedHome.push(player)
      corrections++
      console.log(`Moved ${player.vorname} ${player.name} (club: ${player.club}) from away to home`)
    } else {
      correctedAway.push(player)
    }
  }

  // Sort each team by originalIndex to restore proper starter/subs order
  // Players who appear earlier in the HTML are more likely to be starters
  const sortByIndex = (a: ScrapedPlayer, b: ScrapedPlayer) =>
    (a.originalIndex ?? Infinity) - (b.originalIndex ?? Infinity)

  correctedHome.sort(sortByIndex)
  correctedAway.sort(sortByIndex)

  return {
    correctedHome,
    correctedAway,
    corrections
  }
}

// ===========================================
// PROFILE FETCHING (with Rate Limiting)
// ===========================================

async function fetchPlayerNamesFromProfiles(
  players: ScrapedPlayer[],
  debugInfo: Record<string, unknown>
): Promise<ScrapedPlayer[]> {
  const results: ScrapedPlayer[] = []
  let profileErrors = 0

  // Process in batches with rate limiting
  for (let i = 0; i < players.length; i += CONFIG.profileBatchSize) {
    const batch = players.slice(i, i + CONFIG.profileBatchSize)

    const batchResults = await Promise.all(
      batch.map(async (player) => {
        if (!player.profileUrl) return player

        // If player already has a name from font deobfuscation, only fetch profile for club info
        const alreadyHasName = player.name && player.name !== 'k.A.'

        try {
          const response = await withRetry(
            () => fetchWithTimeout(player.profileUrl!, {
              method: 'GET',
              timeout: CONFIG.profileFetchTimeoutMs,
              headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'de-DE,de;q=0.9',
              },
            }),
            { maxRetries: 2, initialDelayMs: 500, maxDelayMs: 2000 }
          )

          if (!response.ok) {
            profileErrors++
            return player
          }

          const html = await response.text()

          // Extract player name from profile (only if not already decoded from font)
          if (!alreadyHasName) {
            const name = extractNameFromProfileHtml(html)
            if (name) {
              player.vorname = name.vorname
              player.name = name.name
            }
          }

          // Extract club for team assignment (always useful)
          const club = extractClubFromProfileHtml(html)
          if (club) {
            player.club = club
          }

          // If still no name, try URL slug fallback
          if (!player.name && !player.vorname && player.profileUrl) {
            const urlName = extractNameFromProfileUrl(player.profileUrl)
            if (urlName && urlName.name) {
              player.vorname = urlName.vorname
              player.name = urlName.name
              console.log(`Name from URL slug: ${urlName.vorname} ${urlName.name} (${player.profileUrl})`)
            }
          }

          // If still no name found, set "k.A." (keine Angabe)
          if (!player.name && !player.vorname) {
            player.name = 'k.A.'
          }

          return player
        } catch (err) {
          profileErrors++
          console.warn('Profile fetch failed:', player.profileUrl, String(err).substring(0, 50))
          // Try extracting name from URL slug as fallback
          if (!player.name && !player.vorname && player.profileUrl) {
            const urlName = extractNameFromProfileUrl(player.profileUrl)
            if (urlName && urlName.name) {
              player.vorname = urlName.vorname
              player.name = urlName.name
              console.log(`Name from URL slug (after fetch error): ${urlName.vorname} ${urlName.name}`)
            }
          }
          // Set "k.A." only if still no name
          if (!player.name && !player.vorname) {
            player.name = 'k.A.'
          }
          return player
        }
      })
    )

    results.push(...batchResults)

    // Rate limiting delay between batches
    if (i + CONFIG.profileBatchSize < players.length) {
      await sleep(CONFIG.profileBatchDelayMs)
    }
  }

  debugInfo.profileErrors = profileErrors
  return results
}

// Check if a parsed name looks like an organization/page title instead of a person
function isInvalidPlayerName(vorname: string, name: string): boolean {
  const combined = `${vorname} ${name}`.toLowerCase()
  // These words should never appear in a real player's parsed first/last name
  const orgWords = ['verband', 'fußball', 'fussball', 'bundesliga', 'regionalliga',
    'oberliga', 'landesliga', 'kreisliga', 'bezirksliga', 'dfb', 'startseite']
  return orgWords.some(w => combined.includes(w))
}

function extractNameFromProfileHtml(html: string): { vorname: string; name: string } | null {
  // Pattern 1: <h1 class="headline">Vorname Nachname</h1>
  const h1Match = html.match(/<h1[^>]*class="[^"]*headline[^"]*"[^>]*>([^<]+)<\/h1>/i)
  if (h1Match) {
    // Strip common prefixes like "Spielerprofil von "
    let text = h1Match[1].replace(/^Spielerprofil\s*(von\s*)?/i, '').trim()
    const parsed = parseGermanName(text)
    if (parsed.name && !isInvalidPlayerName(parsed.vorname, parsed.name)) return parsed
  }

  // Pattern 2: <title>Vorname Nachname Spielerprofil | FUSSBALL.DE</title>
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i)
  if (titleMatch) {
    let text = titleMatch[1].split('|')[0].trim()
    // Strip "Spielerprofil" suffix and "FUSSBALL.DE"
    text = text.replace(/\s*Spielerprofil\s*/i, '').replace(/FUSSBALL\.DE/i, '').trim()
    if (text.length > 1) {
      const parsed = parseGermanName(text)
      if (parsed.name && !isInvalidPlayerName(parsed.vorname, parsed.name)) return parsed
    }
  }

  // Pattern 3: og:title meta tag
  const ogMatch = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i)
  if (ogMatch) {
    let text = ogMatch[1].split('|')[0].trim()
    text = text.replace(/\s*Spielerprofil\s*/i, '').replace(/FUSSBALL\.DE/i, '').trim()
    if (text.length > 1) {
      const parsed = parseGermanName(text)
      if (parsed.name && !isInvalidPlayerName(parsed.vorname, parsed.name)) return parsed
    }
  }

  // Pattern 4: Look for name in profile-header or similar
  const profileNameMatch = html.match(/<[^>]*class="[^"]*(?:profile-name|player-name|name)[^"]*"[^>]*>([^<]+)</i)
  if (profileNameMatch) {
    const parsed = parseGermanName(profileNameMatch[1])
    if (parsed.name && !isInvalidPlayerName(parsed.vorname, parsed.name)) return parsed
  }

  return null
}

/**
 * Extract player name from the profile URL slug.
 * Example: "/spielerprofil/luka-vulin/-/profil/012ABC" → { vorname: "Luka", name: "Vulin" }
 * This serves as a reliable fallback when profile HTML extraction fails (e.g. redirected pages).
 */
function extractNameFromProfileUrl(url: string): { vorname: string; name: string } | null {
  // Match the slug after /spielerprofil/
  const slugMatch = url.match(/\/spielerprofil\/([a-z0-9-]+)\//i)
  if (!slugMatch) return null

  const slug = slugMatch[1]
  // Split slug by hyphens and capitalize each part
  const parts = slug.split('-').filter(p => p.length > 0)
  if (parts.length === 0) return null

  // Capitalize each part
  const capitalized = parts.map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())

  if (capitalized.length === 1) {
    return { vorname: '', name: capitalized[0] }
  }

  // Last part is surname, rest is first name
  const name = capitalized.pop()!
  const vorname = capitalized.join(' ')
  return { vorname, name }
}

/**
 * Extract player's current club from profile HTML.
 * The profile page contains a link to the player's current team/club.
 * Example: <a href="...mannschaft...">Borussia Dortmund</a>
 */
function extractClubFromProfileHtml(html: string): string | null {
  // Pattern 1: Link zur Mannschaftsseite (most reliable)
  // <a href="...mannschaft...">Vereinsname</a>
  const mannschaftMatch = html.match(/<a[^>]*href="[^"]*\/mannschaft\/[^"]*"[^>]*>([^<]+)<\/a>/i)
  if (mannschaftMatch) {
    return mannschaftMatch[1].trim()
  }

  // Pattern 2: Verein im Profil-Header
  const clubMatch = html.match(/<span[^>]*class="[^"]*(?:club|verein|team)[^"]*"[^>]*>([^<]+)<\/span>/i)
  if (clubMatch) {
    return clubMatch[1].trim()
  }

  return null
}

// ===========================================
// MATCH INFO (Team-Namen, Datum, Uhrzeit, Ort)
// ===========================================

interface MatchInfoData {
  homeTeam: string
  awayTeam: string
  date: string
  time: string
  location: string
  league: string
  ageGroup: string
  matchType: string
}

function extractGermanDate(dateStr: string): string {
  if (!dateStr) return ''
  const cleanDate = dateStr.replace(/^[A-Za-z]{2,},?\s*/, '')
  const m = cleanDate.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/)
  if (m) return `${m[1].padStart(2, '0')}.${m[2].padStart(2, '0')}.${m[3]}`
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [year, month, day] = dateStr.split('-')
    return `${day}.${month}.${year}`
  }
  return ''
}

function stripAgeGroup(teamName: string): string {
  let result = teamName
    .replace(/\s+U\d{2}(?:\s*2)?\b/gi, '')
    .replace(/\s+2$/, '')
    .replace(/\s+II$/, '')
    .replace(/\s*\(2\)$/, '')
    .replace(/\s*\(II\)$/, '')
    .trim()
    .replace(/\.$/, '')

  // Doppelte Vereinspräfixe entfernen (z.B. "FC Schalke 04 FC" → "FC Schalke 04")
  const prefixes = ['FC', 'SC', 'SV', 'VfB', 'VfL', 'TSV', 'FSV', 'SpVgg', 'SG', 'TSG', 'RB', 'BV', 'RW', 'BW', 'SF']
  for (const prefix of prefixes) {
    const dupRegex = new RegExp(`^(${prefix}\\b.+?)\\s+${prefix}$`, 'i')
    result = result.replace(dupRegex, '$1').trim()
  }

  return result
}

function detectAgeGroup(league: string, homeTeam: string, awayTeam: string): string {
  const combined = `${league} ${homeTeam} ${awayTeam}`.toLowerCase()
  if (/\bu14\b/.test(combined)) return 'U14'
  if (/\bu15\b/.test(combined)) return 'U15'
  if (/\bu16\b/.test(combined)) return 'U16'
  if (/\bu17\b/.test(combined)) return 'U17'
  if (/\bu18\b/.test(combined)) return 'U17'
  if (/\bu19\b/.test(combined)) return 'U19'
  if (/\bu2[0-3]\b/.test(combined)) return 'Herren'
  if (/a-jugend|a-junioren/.test(combined)) return 'U19'
  if (/b-jugend|b-junioren/.test(combined)) return 'U17'
  if (/c-jugend|c-junioren/.test(combined)) return 'U15'
  if (/d-jugend|d-junioren/.test(combined)) return 'U14'
  return 'Herren'
}

function detectMatchType(league: string): string {
  const l = league.toLowerCase()
  if (l.includes('pokal')) return 'Pokalspiel'
  if (l.includes('freundschaft') || l.includes('test') || l.includes('friendly') || /\bfs\b/.test(l) || l.includes('-fs') || l.includes('fs-')) return 'Freundschaftsspiel'
  if (l.includes('halle') && l.includes('turnier')) return 'Hallenturnier'
  if (l.includes('turnier')) return 'Turnier'
  return 'Punktspiel'
}

// ===========================================
// AJAX MATCH.INFO PARSING (Datum, Uhrzeit, Ort)
// ===========================================

function extractDateFromAjax(html: string, titleHtml?: string): string {
  const datePatterns = [
    /data-date="(\d{4}-\d{2}-\d{2})"/,
    /"date":\s*"(\d{4}-\d{2}-\d{2})"/,
    /(\d{1,2}\.\d{1,2}\.\d{4})/,
  ]
  for (const pattern of datePatterns) {
    const match = html.match(pattern)
    if (match) {
      const date = extractGermanDate(match[1])
      if (date) return date
    }
  }
  // Fallback: Title-Tag
  if (titleHtml) {
    const titleDateMatch = titleHtml.match(/(\d{1,2}\.\d{1,2}\.\d{4})/)
    if (titleDateMatch) {
      const date = extractGermanDate(titleDateMatch[1])
      if (date) return date
    }
  }
  return ''
}

function extractTimeFromAjax(html: string): string {
  // Zuerst: Datum+Zeit zusammen (DD.MM.YYYY HH:MM ohne Pipe)
  const dateTimeMatches = html.match(/\d{1,2}\.\d{1,2}\.\d{4}[^|]{0,5}(\d{1,2}:\d{2})/g)
  if (dateTimeMatches) {
    for (const m of dateTimeMatches) {
      if (m.includes('|')) continue
      const tm = m.match(/(\d{1,2}:\d{2})$/)
      if (tm) return tm[1]
    }
  }

  const timePatterns = [
    /,\s*(\d{1,2}:\d{2})\s*UHR/i,
    /(\d{1,2}:\d{2})\s+UHR/i,
    /Anpfiff[:\s]*(\d{1,2}:\d{2})/i,
    /Anstoß[:\s]*(\d{1,2}:\d{2})/i,
    /Anstoss[:\s]*(\d{1,2}:\d{2})/i,
    /data-time="(\d{1,2}:\d{2})"/,
    /"time":\s*"(\d{1,2}:\d{2})"/,
    /<span>(\d{1,2}:\d{2})Uhr<\/span>/,
    />(\d{1,2}:\d{2})Uhr</,
  ]
  for (const pattern of timePatterns) {
    const match = html.match(pattern)
    if (match) return match[1]
  }
  return ''
}

function extractLocationFromAjax(html: string): string {
  // Pattern 1: <a class="location">Venue Name<span...
  const locationMatch = html.match(/<a[^>]*class="location"[^>]*>\s*([^<]+?)\s*<span/i)
  if (locationMatch) {
    const loc = locationMatch[1].trim().replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
    if (loc) return loc
  }
  // Pattern 2: Google Maps URL
  const mapsMatch = html.match(/href="https?:\/\/(?:www\.)?google\.[a-z]+\/maps\?q=([^"]+)"/i)
  if (mapsMatch) {
    return decodeURIComponent(mapsMatch[1].replace(/\+/g, ' ')).trim()
  }
  return ''
}

function extractLeagueFromTitle(html: string): string {
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i)
  if (titleMatch) {
    const leagueMatch = titleMatch[1].match(/Ergebnis:\s*(.+?)\s+-\s+/)
    if (leagueMatch) return leagueMatch[1].trim()
  }
  return ''
}

// Parse team names from URL slug: /spiel/[team1]-[team2]/-/spiel/[ID]
function parseTeamsFromUrlSlug(urlOrPath: string): { home: string; away: string } {
  const pathMatch = urlOrPath.match(/\/spiel\/([^\/]+)\/-\/spiel\//i)
  if (!pathMatch) return { home: '', away: '' }

  const slug = pathMatch[1]

  // Priority patterns: these DEFINITELY start a new team (with number prefix)
  const priorityPatterns = ['-1-fc-', '-1-fsv-', '-1-ffc-', '-1-sv-']
  let splitIndex = -1

  for (const pattern of priorityPatterns) {
    const idx = slug.indexOf(pattern)
    if (idx > 3) { splitIndex = idx + 1; break }
  }

  // Only real club prefixes (NO city names like berlin-, hoffenheim-, etc.)
  if (splitIndex === -1) {
    const teamPrefixes = [
      'fc-', 'sv-', 'tsg-', 'vfb-', 'vfl-', 'sc-', 'fsv-', 'bsc-', 'ssc-',
      'rb-', 'rw-', 'sw-', 'bv-', 'tsv-', 'spvgg-', 'sg-', 'sf-', 'tv-',
      'borussia-', 'hertha-', 'eintracht-', 'fortuna-', 'arminia-',
      'tennis-', 'viktoria-', 'alemannia-', 'energie-', 'dynamo-', 'hansa-',
      'werder-', 'holstein-', 'greuther-', 'jahn-', 'wehen-', 'preussen-',
      'kickers-', 'stuttgarter-', 'rot-', 'blau-', 'waldhof-', 'schalke-',
    ]
    // Collect ALL candidate split positions, then pick the most balanced one
    const candidates: number[] = []
    for (const prefix of teamPrefixes) {
      const idx = slug.indexOf('-' + prefix)
      if (idx > 3) candidates.push(idx + 1)
    }
    if (candidates.length > 0) {
      // Prefer splits that come right after age-group suffixes (u19, u17, u15, u23, ii, iii)
      const ageSuffixes = ['-u19-', '-u17-', '-u15-', '-u23-', '-u21-', '-ii-', '-iii-']
      const afterAgeSuffix = candidates.filter(pos => {
        const before = slug.substring(0, pos)
        return ageSuffixes.some(s => before.endsWith(s.slice(0, -1)))
      })
      if (afterAgeSuffix.length > 0) {
        splitIndex = afterAgeSuffix[0]
      } else {
        // Pick the split that gives the most balanced team name lengths
        const midpoint = slug.length / 2
        splitIndex = candidates.reduce((best, pos) =>
          Math.abs(pos - midpoint) < Math.abs(best - midpoint) ? pos : best
        )
      }
    }
  }

  // Fallback: split in the middle
  if (splitIndex === -1) {
    const words = slug.split('-')
    const mid = Math.ceil(words.length / 2)
    splitIndex = words.slice(0, mid).join('-').length + 1
  }

  const homeRaw = slug.substring(0, splitIndex).replace(/-$/, '')
  const awayRaw = slug.substring(splitIndex)

  // Format: capitalize, replace abbreviations
  const formatSlug = (s: string): string => {
    const abbreviations: Record<string, string> = {
      'sport-club': 'SC', 'fussball-club': 'FC', 'sportverein': 'SV', 'sport-verein': 'SV',
      'turn-und-sportverein': 'TSV', 'ballspielverein': 'BV', 'rasenballsport': 'RB',
      'rot-weiss': 'RW', 'schwarz-weiss': 'SW', 'blau-weiss': 'BW',
      'spielvereinigung': 'SpVgg', 'sportgemeinschaft': 'SG', 'sportfreunde': 'SF',
    }
    let f = s
    for (const [long, short] of Object.entries(abbreviations)) {
      f = f.replace(new RegExp(long, 'gi'), short)
    }
    // Umlaut-Konvertierung (URL-Slugs haben keine Umlaute)
    f = f.replace(/oe/g, 'ö').replace(/ae/g, 'ä').replace(/ue/g, 'ü')
    const upperAbbrevs = ['fc', 'sv', 'sc', 'vfb', 'vfl', 'tsg', 'fsv', 'bsc', 'rb', 'bv', 'tsv', 'rw', 'sw', 'bw', 'sf', 'sg', 'tv', 'ssc']
    return f.split('-').map(w => {
      if (upperAbbrevs.includes(w.toLowerCase())) return w.toUpperCase()
      if (w.toLowerCase() === 'spvgg') return 'SpVgg'
      if (/^\d$/.test(w)) return w + '.'
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    }).join(' ').replace(/\s+/g, ' ').trim()
  }

  return { home: formatSlug(homeRaw), away: formatSlug(awayRaw) }
}

async function fetchMatchInfo(
  gameId: string,
  url: string | undefined,
  debugInfo: Record<string, unknown>
): Promise<{ success: boolean; data?: MatchInfoData; error?: string }> {
  let homeTeam = ''
  let awayTeam = ''
  let league = ''

  // Parse team names from URL slug (zuverlässig)
  if (url) {
    const urlTeams = parseTeamsFromUrlSlug(url)
    if (urlTeams.home && urlTeams.away) {
      homeTeam = urlTeams.home
      awayTeam = urlTeams.away
      debugInfo.teamsSource = 'url-slug'
    }
  }

  if (!homeTeam || !awayTeam) {
    return { success: false, error: 'Could not extract team names from URL' }
  }

  // Datum, Uhrzeit, Ort direkt aus der Main Page HTML extrahieren
  // (AJAX match.info Endpoint funktioniert nicht ohne Browser-Session)
  let date = ''
  let time = ''
  let location = ''

  const mainPageUrl = url ? url.split('#')[0] : `https://www.fussball.de/spiel/-/-/spiel/${gameId}`

  try {
    const mainResponse = await fetchWithTimeout(mainPageUrl, {
      method: 'GET',
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'de-DE,de;q=0.9',
      },
    })

    if (mainResponse.ok) {
      const mainHtml = await mainResponse.text()
      debugInfo.matchInfoMainPageLength = mainHtml.length

      // Teamnamen aus JavaScript-Variablen (zuverlässigste Quelle)
      const edHome = mainHtml.match(/edHeimmannschaftName='([^']+)'/)?.[1]
      const edAway = mainHtml.match(/edGastmannschaftName='([^']+)'/)?.[1]
      if (edHome && edAway) {
        homeTeam = edHome
        awayTeam = edAway
        debugInfo.teamsSource = 'js-variables'
        console.log('match-info: Teams from JS vars:', homeTeam, 'vs', awayTeam)
      } else {
        // Fallback: Title-Tag
        const titleTag = mainHtml.match(/<title>([^<]+)<\/title>/i)?.[1] || ''
        const teamsMatch = titleTag.match(/^(.+?)\s+-\s+(.+?)(?:\s+Ergebnis|\s*\|)/)
        if (teamsMatch) {
          homeTeam = teamsMatch[1].trim()
          awayTeam = teamsMatch[2].trim()
          debugInfo.teamsSource = 'title-tag'
          console.log('match-info: Teams from title:', homeTeam, 'vs', awayTeam)
        }
      }

      // Liga aus Title-Tag: "Team1 - Team2 Ergebnis: Liga - Kategorie - DD.MM.YYYY"
      league = extractLeagueFromTitle(mainHtml)

      // Datum + Uhrzeit + Ort direkt aus der Main Page HTML extrahieren
      const titleTag = mainHtml.match(/<title>([^<]+)<\/title>/i)?.[1] || ''
      date = extractDateFromAjax(mainHtml, titleTag)
      time = extractTimeFromAjax(mainHtml)
      location = extractLocationFromAjax(mainHtml)
      console.log('match-info: Extracted from main page:', { date, time, location, league })
    } else {
      console.log('match-info: Main page failed:', mainResponse.status)
    }
  } catch (error) {
    console.log('match-info: Main page fetch error (non-fatal):', error)
    // Non-fatal: Teamnamen haben wir schon aus dem URL-Slug
  }

  // Detect age group (vor dem Strippen der Teamnamen)
  const ageGroup = detectAgeGroup(league, homeTeam, awayTeam)
  const matchType = detectMatchType(league)

  // Strip age group from team names for display
  const cleanHome = stripAgeGroup(homeTeam)
  const cleanAway = stripAgeGroup(awayTeam)

  console.log('Match info result:', { homeTeam: cleanHome, awayTeam: cleanAway, date, time, location, league, ageGroup, matchType })

  return {
    success: true,
    data: {
      homeTeam: cleanHome,
      awayTeam: cleanAway,
      date,
      time,
      location,
      league,
      ageGroup,
      matchType,
    },
  }
}

// ===========================================
// MAIN HANDLER
// ===========================================

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const startTime = Date.now()
  const debugInfo: Record<string, unknown> = {
    browserlessKeyExists: !!BROWSERLESS_API_KEY,
    anthropicKeyExists: !!ANTHROPIC_API_KEY,
    startTime: new Date().toISOString(),
  }

  try {
    const { url, matchId, debug, mode } = await req.json()

    if (!url && !matchId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'url or matchId is required',
          errorCode: ScrapeErrorCode.INVALID_INPUT,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // Extract matchId from URL
    let gameId = matchId
    if (!gameId && url) {
      const idMatch = url.match(/\/-\/spiel\/([A-Z0-9]{6,})/i)
      if (idMatch) {
        gameId = idMatch[1]
      } else {
        const fallbackMatch = url.match(/([A-Z0-9]{6,})(?:[\/\?#]|$)/i)
        if (fallbackMatch) {
          gameId = fallbackMatch[1]
        }
      }
    }

    if (!gameId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Could not extract match ID from URL',
          errorCode: ScrapeErrorCode.INVALID_INPUT,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    console.log('Processing match:', gameId, 'mode:', mode || 'lineup')
    debugInfo.gameId = gameId
    debugInfo.mode = mode || 'lineup'

    // ===========================================
    // MODE: match-info (Team-Namen, Datum, Uhrzeit, Ort)
    // ===========================================
    if (mode === 'match-info') {
      const matchInfoResult = await fetchMatchInfo(gameId, url, debugInfo)
      debugInfo.duration = Date.now() - startTime

      const responseData: Record<string, unknown> = {
        success: matchInfoResult.success,
        data: matchInfoResult.data,
        method: 'match-info',
      }
      if (!matchInfoResult.success) responseData.error = matchInfoResult.error
      if (debug) responseData.debug = debugInfo

      return new Response(
        JSON.stringify(responseData),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    // Build lineup URL
    const baseUrl = url || `https://www.fussball.de/spiel/-/-/spiel/${gameId}`
    const cleanUrl = baseUrl.split('#')[0]
    const lineupUrl = `${cleanUrl}#!/section/lineup`
    debugInfo.lineupUrl = lineupUrl

    // ===========================================
    // METHOD 1: AJAX (Primary - most reliable)
    // ===========================================
    // AJAX is more reliable than Vision because:
    // - It fetches data directly from the correct match ID
    // - Vision can capture wrong matches (e.g., featured Bundesliga games)
    // - AJAX uses player-wrapper classes for accurate team/starter detection
    console.log('Trying AJAX method first...')
    const ajaxResult = await scrapeWithAjax(gameId, url, debugInfo)

    debugInfo.duration = Date.now() - startTime

    if (ajaxResult.success && ajaxResult.data?.available) {
      // AJAX succeeded with lineup data
      debugInfo.duration = Date.now() - startTime
      const responseData: Record<string, unknown> = {
        success: true,
        data: ajaxResult.data,
        method: 'ajax',
        errorCode: ajaxResult.errorCode,
      }
      if (debug) responseData.debug = debugInfo

      return new Response(
        JSON.stringify(responseData),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    // AJAX returned no lineup - try Vision as fallback (slower but can read images)
    if (ajaxResult.errorCode === ScrapeErrorCode.NO_LINEUP_AVAILABLE && BROWSERLESS_API_KEY && ANTHROPIC_API_KEY) {
      console.log('AJAX found no lineup, trying Vision fallback...')
      const visionResult = await scrapeWithVision(lineupUrl, debugInfo)

      if (visionResult.success && visionResult.data?.available) {
        debugInfo.duration = Date.now() - startTime
        const responseData: Record<string, unknown> = {
          success: true,
          data: visionResult.data,
          method: 'vision',
        }
        if (debug) responseData.debug = debugInfo

        return new Response(
          JSON.stringify(responseData),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
      }
    }

    // No lineup available from either method
    if (ajaxResult.errorCode === ScrapeErrorCode.NO_LINEUP_AVAILABLE) {
      debugInfo.duration = Date.now() - startTime
      const responseData: Record<string, unknown> = {
        success: true,
        data: ajaxResult.data,  // Return empty lineup with available: false
        method: 'ajax',
        errorCode: ajaxResult.errorCode,
      }
      if (debug) responseData.debug = debugInfo

      return new Response(
        JSON.stringify(responseData),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    // Both methods failed
    console.error('All scraping methods failed')
    debugInfo.ajaxResult = ajaxResult.errorCode

    const responseData: Record<string, unknown> = {
      success: false,
      error: ajaxResult.error || 'All scraping methods failed',
      errorCode: ajaxResult.errorCode,
    }
    if (debug) responseData.debug = debugInfo

    return new Response(
      JSON.stringify(responseData),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    console.error('Scraping error:', error)
    debugInfo.duration = Date.now() - startTime
    debugInfo.fatalError = String(error)

    return new Response(
      JSON.stringify({
        success: false,
        error: 'Scraping failed: ' + String(error),
        errorCode: 'FATAL_ERROR',
        debug: debugInfo,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
