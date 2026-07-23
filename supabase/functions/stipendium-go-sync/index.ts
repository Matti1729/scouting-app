// stipendium-go-sync: Meldet einen Go-Kandidaten an das Athletes-USA Scout
// Portal ("Scout Connect", POST /api/scout-ingest). Läuft serverseitig, damit
// der API-Key nicht im Client landet und kein CORS-Problem entsteht.
// Idempotent: source_lead_id = stipendium_entries.id — mehrfaches Verschieben
// nach "Go" erzeugt keinen doppelten Lead.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { first_name, last_name, profile_url, source_lead_id } = await req.json()

    if (!first_name || !source_lead_id) {
      return json({ success: false, error: 'first_name und source_lead_id erforderlich' }, 400)
    }

    const ingestKey = Deno.env.get('SCOUT_PORTAL_INGEST_KEY')
    const portalUrl = Deno.env.get('SCOUT_PORTAL_URL') || 'https://network.warubi-sports.com'
    if (!ingestKey) {
      return json({ success: false, error: 'SCOUT_PORTAL_INGEST_KEY nicht gesetzt' }, 500)
    }

    const resp = await fetch(`${portalUrl}/api/scout-ingest`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ingestKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        first_name,
        last_name: last_name || '',
        profile_url: profile_url || '',
        source_lead_id,
      }),
    })

    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) {
      console.error('Scout-Portal ingest failed:', resp.status, data)
      return json({ success: false, status: resp.status, ...data }, 502)
    }

    return json({ success: true, ...data })
  } catch (e) {
    console.error('stipendium-go-sync error:', e)
    return json({ success: false, error: String(e) }, 500)
  }
})
