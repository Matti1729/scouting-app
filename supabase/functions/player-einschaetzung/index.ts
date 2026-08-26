// player-einschaetzung: Generiert eine kurze Scouting-Einschätzung zu einem
// Spieler aus seinen Spielberichten (via Claude). Stateless — der Client
// liefert die Berichte und speichert das Ergebnis selbst am Spieler.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CLAUDE_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  })
}

interface ReportInput {
  matchDate?: string | null
  matchName?: string | null
  ageGroup?: string | null
  rating?: number | null
  notes?: string | null
  bodyStructure?: Record<string, string | null> | null
  speedAthleticism?: Record<string, string | null> | null
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (!CLAUDE_API_KEY) return json({ success: false, error: 'ANTHROPIC_API_KEY fehlt' }, 500)

    const { playerName, club, position, reports } = await req.json()
    if (!playerName || !Array.isArray(reports) || reports.length === 0) {
      return json({ success: false, error: 'playerName und reports erforderlich' }, 400)
    }

    const reportText = (reports as ReportInput[])
      .map((r, i) => {
        const parts: string[] = []
        parts.push(`Bericht ${i + 1}: ${r.matchDate || 'Datum unbekannt'} · ${[r.ageGroup, r.matchName].filter(Boolean).join(' · ') || 'Spiel unbekannt'}`)
        if (r.rating) parts.push(`Potential-Bewertung: ${r.rating}/10`)
        const body = Object.entries(r.bodyStructure || {}).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`)
        if (body.length) parts.push(`Körper: ${body.join(', ')}`)
        const ath = Object.entries(r.speedAthleticism || {}).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`)
        if (ath.length) parts.push(`Athletik: ${ath.join(', ')}`)
        if (r.notes?.trim()) parts.push(`Notizen des Scouts: ${r.notes.trim()}`)
        return parts.join('\n')
      })
      .join('\n\n')

    const prompt = `Du bist Assistent einer Spielerberatungsagentur im Fußball. Fasse die folgenden Scouting-Berichte zu einer kurzen Einschätzung des Spielers zusammen.

Spieler: ${playerName}${club ? ` (${club})` : ''}${position ? `, Position: ${position}` : ''}

${reportText}

Schreibe 3 bis 5 Sätze auf Deutsch: Spielertyp und auffälligste Stärken, erwähnenswerte Schwächen, und falls mehrere Berichte vorliegen die Entwicklung über die Sichtungen. Stütze dich NUR auf die Berichte, erfinde nichts dazu. Keine Gedankenstriche im Fließtext. Keine Einleitung, keine Überschrift — direkt die Einschätzung.`

    const resp = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!resp.ok) {
      const errText = await resp.text()
      console.error('Claude API error:', resp.status, errText.slice(0, 300))
      return json({ success: false, error: `Claude API ${resp.status}` }, 502)
    }

    const data = await resp.json()
    const text = (data?.content || [])
      .filter((b: any) => b?.type === 'text')
      .map((b: any) => b.text)
      .join('')
      .trim()

    if (!text) return json({ success: false, error: 'Leere Antwort' }, 502)
    return json({ success: true, text })
  } catch (e) {
    console.error('player-einschaetzung error:', e)
    return json({ success: false, error: String(e) }, 500)
  }
})
