// parse-match-notes: Spielnotizen (per iPhone-Diktat eingesprochen) den Spielern der Aufstellung
// zuordnen (Matti 2026-10-25: weniger klicken/tippen beim Scouten).
// Body: { matchId, text } → { success, drafts: [...], unmatched: [...] }
// Claude zerlegt den Text je Spieler (Heim/Gast + Rückennummer) in die Felder des Bewertungsbogens;
// die Zuordnung zur Aufstellungs-Zeile passiert hier über Seite + Nummer.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CLAUDE_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const enumOrNull = (vals: string[]) => ({ type: ['string', 'null'], enum: [...vals, null] })

// Felder wie im Bewertungsbogen (src/types/index.ts)
const PLAYER_SCHEMA = {
  type: 'object',
  properties: {
    side: { type: ['string', 'null'], enum: ['home', 'away', null], description: 'home = Heimmannschaft, away = Gastmannschaft, null wenn nicht genannt' },
    number: { type: ['integer', 'null'], description: 'Rückennummer' },
    name_hint: { type: ['string', 'null'], description: 'genannter Name, falls statt/zusätzlich zur Nummer genannt' },
    positions: { type: 'array', items: { type: 'string', enum: ['TW', 'IV', 'LV', 'RV', 'DM', 'ZM', 'LM', 'RM', 'OM', 'LF', 'RF', 'ST'] } },
    preferred_foot: enumOrNull(['rechts', 'links', 'beide']),
    body: {
      type: 'object',
      properties: {
        maturity: enumOrNull(['spaetentwickler', 'altersgerecht', 'fruehentwickler']),
        relativeHeight: enumOrNull(['unterdurchschnittlich', 'durchschnittlich', 'ueberdurchschnittlich']),
        proportion: enumOrNull(['langbeinig', 'ausgeglichen', 'kompakt']),
        frame: enumOrNull(['schmal', 'mittel', 'breit']),
        musculature: enumOrNull(['wenig_aufbau', 'altersgerecht', 'kraeftig']),
      },
    },
    athletics: {
      type: 'object',
      properties: {
        antritt: enumOrNull(['top', 'gut', 'durchschnitt', 'schwach']),
        endspeed: enumOrNull(['top', 'gut', 'durchschnitt', 'schwach']),
        koordination: enumOrNull(['sauber', 'normal', 'steif']),
        robustheit: enumOrNull(['wacklig', 'stabil', 'durchsetzungsstark']),
        intensitaet: enumOrNull(['hoch', 'mittel', 'niedrig']),
      },
    },
    note: { type: 'string', description: 'alles Übrige (Technik, Spielverständnis, Auffälligkeiten) als kurze Stichpunkte auf Deutsch, ohne Gedankenstriche' },
    source_text: { type: 'string', description: 'die Stelle aus den Notizen, auf der dieser Eintrag beruht (wörtlich)' },
  },
  required: ['side', 'number', 'positions', 'note', 'source_text'],
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    if (!CLAUDE_API_KEY) return json({ success: false, error: 'ANTHROPIC_API_KEY fehlt' }, 500)
    const { matchId, text } = await req.json()
    if (!matchId || !String(text || '').trim()) return json({ success: false, error: 'matchId und text erforderlich' }, 400)

    // Mit dem Token des Nutzers lesen (RLS wie in der App)
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') || '' } },
    })
    const [{ data: match }, { data: lineup }] = await Promise.all([
      sb.from('scouting_matches').select('home_team, away_team, age_group').eq('id', matchId).maybeSingle(),
      sb.from('scouting_lineups').select('id, team, nummer, vorname, name, position, is_starter, dfb_not_in_squad').eq('match_id', matchId),
    ])
    if (!match) return json({ success: false, error: 'Spiel nicht gefunden' }, 404)
    const rows = (lineup || []).filter((r: any) => !r.dfb_not_in_squad)
    const roster = (side: string) => rows.filter((r: any) => r.team === side)
      .map((r: any) => `${(r.nummer || '?').replace(/^0+(?=\d)/, '')} ${[r.vorname, r.name].filter(Boolean).join(' ')}${r.position ? ` (${r.position})` : ''}`).join('; ')

    const prompt = `Du hilfst einem Fußball-Scout. Er hat während des Spiels per Diktat Notizen eingesprochen. Zerlege sie je Spieler in die Felder des Bewertungsbogens.

Spiel: ${match.home_team || 'Heim'} (Heim) gegen ${match.away_team || 'Gast'} (Gast)${match.age_group ? `, ${match.age_group}` : ''}
Aufstellung Heim: ${roster('home') || 'unbekannt'}
Aufstellung Gast: ${roster('away') || 'unbekannt'}

Regeln:
- "Heim", "Gast" oder der Vereinsname bestimmen die Seite. Fehlt sie, lass side null.
- Diktat-Fehler großzügig deuten ("Nummer drei zehn" = 13, "links Fuß" = linker Fuß).
- Felder nur füllen, wenn der Scout es wirklich sagt. Nichts erfinden. "groß" = relativeHeight ueberdurchschnittlich, "klein" = unterdurchschnittlich, "schlaksig" = proportion langbeinig und frame schmal, "kräftig/robust gebaut" = musculature kraeftig, "zierlich/schmächtig" = frame schmal, "sehr schnell" = antritt/endspeed top, "zweikampfstark" = robustheit durchsetzungsstark, "verliert Zweikämpfe" = robustheit wacklig.
- Mehrere Notizen zum selben Spieler zu einem Eintrag zusammenfassen.
- Antworte ausschließlich über das Werkzeug spieler_eintraege, ohne Text davor oder danach.

Notizen:
"""
${String(text).slice(0, 12000)}
"""`

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': CLAUDE_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-5-5',
        max_tokens: 4000,
        tools: [{
          name: 'spieler_eintraege',
          description: 'Die Notizen je Spieler strukturiert zurückgeben',
          input_schema: { type: 'object', properties: { players: { type: 'array', items: PLAYER_SCHEMA } }, required: ['players'] },
        }],
        // Erzwungene Tool-Wahl unterstützt das Modell nicht: per Anweisung im Prompt
        tool_choice: { type: 'auto' },
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (!resp.ok) {
      const errText = (await resp.text()).slice(0, 300)
      console.error('Claude API', resp.status, errText)
      return json({ success: false, error: `Claude API ${resp.status}`, detail: errText }, 502)
    }
    const data = await resp.json()
    const players: any[] = (data?.content || []).find((b: any) => b?.type === 'tool_use')?.input?.players || []

    // Zuordnung zur Aufstellung: Seite + Nummer; ohne Seite nur, wenn die Nummer eindeutig ist; sonst Name
    const num = (n: any) => String(n ?? '').replace(/^0+(?=\d)/, '')
    const norm = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    const drafts: any[] = []
    const unmatched: any[] = []
    for (const p of players) {
      let cands = rows.filter((r: any) => p.number != null && num(r.nummer) === num(p.number) && (!p.side || r.team === p.side))
      if (!cands.length && p.name_hint) cands = rows.filter((r: any) => norm(`${r.vorname} ${r.name}`).includes(norm(p.name_hint)) && (!p.side || r.team === p.side))
      const hit = cands.length === 1 ? cands[0] : null
      const entry = {
        side: hit?.team || p.side || null,
        number: p.number ?? null,
        lineup_player_id: hit?.id || null,
        first_name: hit?.vorname || null,
        last_name: hit?.name || null,
        positions: p.positions || [],
        preferred_foot: p.preferred_foot || null,
        body: p.body || {},
        athletics: p.athletics || {},
        note: (p.note || '').trim(),
        source_text: p.source_text || '',
      }
      if (hit) drafts.push(entry); else unmatched.push({ ...entry, reason: cands.length > 1 ? 'mehrdeutig' : 'nicht in der Aufstellung' })
    }
    return json({ success: true, drafts, unmatched })
  } catch (e) {
    console.error('parse-match-notes:', e)
    return json({ success: false, error: String(e) }, 500)
  }
})
