// transcribe: Sprachnotiz (Audio-Datei) → Text via Groq Whisper (whisper-large-v3).
// Erwartet multipart/form-data mit Feld "file" (webm/m4a/mp3/wav), optional "language" (Standard: de).
// Antwort: { success: true, text } oder { success: false, error }.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY')
const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'

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

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ success: false, error: 'POST erwartet' }, 405)

  try {
    if (!GROQ_API_KEY) return json({ success: false, error: 'GROQ_API_KEY fehlt' }, 500)

    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return json({ success: false, error: 'Feld "file" fehlt' }, 400)
    if (file.size > 25 * 1024 * 1024) return json({ success: false, error: 'Datei zu groß (max. 25 MB)' }, 413)
    const language = (form.get('language') as string) || 'de'
    const prompt = (form.get('prompt') as string) || 'Fußball-Scouting: Spieler, Verein, Position, Stärken, Schwächen, Torwart, Zweikampf, Passspiel.'

    const upstream = new FormData()
    upstream.append('file', file, file.name || 'sprachnotiz.webm')
    upstream.append('model', 'whisper-large-v3')
    upstream.append('language', language)
    upstream.append('response_format', 'json')
    upstream.append('temperature', '0')
    upstream.append('prompt', prompt)

    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
      body: upstream,
    })
    if (!res.ok) {
      const errText = await res.text()
      return json({ success: false, error: `Groq ${res.status}: ${errText.slice(0, 300)}` }, 502)
    }
    const data = await res.json()
    const text = String(data.text || '').trim()
    return json({ success: true, text })
  } catch (e) {
    return json({ success: false, error: (e as Error).message }, 500)
  }
})
