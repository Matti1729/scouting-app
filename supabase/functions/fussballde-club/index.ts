// fussballde-club: Vollen Vereinsnamen + Ort zu einer fussball.de-Mannschaft holen.
// fussball.de kürzt Teamnamen in Spielplänen ("Vorw. Wacker 3.C-Jun.", "SV Wacker 09 B2");
// die Mannschaftsseite nennt den vollen Namen und verlinkt die Vereinsseite, die
// Vereinsseite Ort/Adresse/Gründungsjahr. Damit findet die Transfermarkt-Suche den
// richtigen Verein (Wacker 09 Cottbus statt Wacker Burghausen).
// Aufruf: POST { teamId: "011MIC7BGK000000VTVG0001VTR8C1K7" }
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  })
}

async function fetchHtml(url: string): Promise<string> {
  const resp = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'de-DE,de;q=0.9' },
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status} für ${url}`)
  return await resp.text()
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&auml;/g, 'ä').replace(/&ouml;/g, 'ö').replace(/&uuml;/g, 'ü')
    .replace(/&Auml;/g, 'Ä').replace(/&Ouml;/g, 'Ö').replace(/&Uuml;/g, 'Ü').replace(/&szlig;/g, 'ß')
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/\s+/g, ' ')
    .trim()
}

/** HTML → Fließtext (für die Adress-/Gründungsjahr-Suche) */
function toText(html: string): string {
  return decode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { teamId } = await req.json()
    if (!teamId || !/^[A-Z0-9]{20,40}$/.test(String(teamId))) {
      return json({ success: false, error: 'teamId (fussball.de team-id) erforderlich' }, 400)
    }

    // 1) Mannschaftsseite: voller Teamname im <title> ("SC Vorwärts-Wacker 04 (C-Junioren)") + Vereinslink
    const teamHtml = await fetchHtml(`https://www.fussball.de/mannschaft/x-x/-/saison/2627/team-id/${teamId}`)
    const titleM = teamHtml.match(/<title>([^<]*)<\/title>/i)
    const teamName = titleM ? decode(titleM[1]).replace(/\s*\([^)]*\)\s*$/, '').trim() : null
    const clubLinkM = teamHtml.match(/href="(https:\/\/www\.fussball\.de\/verein\/[^"]+)"/i)
    const clubUrl = clubLinkM ? clubLinkM[1] : null

    let clubName: string | null = null
    let city: string | null = null
    let founded: string | null = null
    let address: string | null = null

    if (clubUrl) {
      // 2) Vereinsseite: Name (<h2>/<title>), Adresse "… 78, 22119 Hamburg Adresse", Gründungsjahr
      try {
        const clubHtml = await fetchHtml(clubUrl)
        const h2 = clubHtml.match(/<h2[^>]*>([^<]+)<\/h2>/i)
        const ct = clubHtml.match(/<title>([^<]*)<\/title>/i)
        clubName = decode((h2 && h2[1]) || (ct && ct[1]) || '') || null
        const text = toText(clubHtml)
        const addr = text.match(/([A-Za-zÄÖÜäöüß.\-]+(?: [A-Za-zÄÖÜäöüß.\-]+)* \d+[a-z]?(?:[-/]\d+)?,\s*\d{5}\s+[A-Za-zÄÖÜäöüß .\-]{2,40}?)\s+Adresse\b/)
        if (addr) {
          // Fließtext davor abschneiden ("… Vereinsfarben Öjendorfer Weg 78, 22119 Hamburg")
          address = addr[1].replace(/^.*\b(Vereinsfarben|Gründungsjahr)\s+/, '').trim()
          const cityM = address.match(/\d{5}\s+(.+)$/)
          city = cityM ? cityM[1].trim() : null
        }
        const fy = text.match(/\b(1[89]\d{2}|20\d{2})\s+Gründungsjahr\b/)
        founded = fy ? fy[1] : null
      } catch (e) {
        // Vereinsseite optional — Teamname reicht oft schon
        console.warn('Vereinsseite nicht ladbar:', (e as Error).message)
      }
    }
    // Ort notfalls aus dem Vereins-Slug ("vorwaerts-wacker-hamburg" → letzter Teil)
    if (!city && clubUrl) {
      const slug = clubUrl.match(/\/verein\/([^/]+)\//)
      if (slug) {
        const parts = slug[1].split('-')
        if (parts.length >= 2) city = parts[parts.length - 1].replace(/^\w/, (c) => c.toUpperCase())
      }
    }

    return json({ success: true, teamId, teamName, clubName, city, founded, address, clubUrl })
  } catch (e) {
    return json({ success: false, error: (e as Error).message || String(e) }, 500)
  }
})
