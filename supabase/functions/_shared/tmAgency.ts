// Berater (Agentur) zu einem Transfermarkt-Spieler.
// Seit ca. 17.11.2026 liefert tmapi nur noch attributes.consultantAgencyId statt des Objekts consultantAgency
// (Name, Link). 0 = kein Berater, 96 = „ohne Berater“ (keine eigene Seite), 1207 = Familienangehörige. Den Namen zur Nummer kennen wir aus unseren
// eigenen Daten (berater_players.agent_url / berater_changes enden auf /berater/<Nummer>).

export const NO_AGENT = 'kein Beratereintrag'

// Sonderfälle ohne eigene Beraterseite: TM zeigt nur den Text
// Nummern, die Transfermarkt für „kein Berater“ benutzt
const NO_AGENT_IDS = new Set(['0', '96'])

const SPECIAL_AGENCIES: Record<string, string> = {
  '1207': 'Familienangehörige',
}

export interface AgencyInfo {
  agencyId: string | null // null = kein Berater
  name: string
  url: string | null
}

const nameCache = new Map<string, { name: string; url: string | null }>()

/** Agentur-Nummer aus dem tmapi-Spieler; alte Antworten hatten noch das Objekt consultantAgency. */
export function agencyIdOf(p: any): string | null {
  const a = p?.attributes
  const raw = a?.consultantAgencyId ?? a?.consultantAgency?.id ?? null
  const id = raw == null ? null : String(raw)
  return id && !NO_AGENT_IDS.has(id) ? id : null
}

/** Namen für Agentur-Nummern aus der Datenbank holen (mit Zwischenspeicher). */
export async function resolveAgencyNames(supabase: any, ids: string[]): Promise<void> {
  for (const id of [...new Set(ids)]) {
    if (nameCache.has(id)) continue
    if (SPECIAL_AGENCIES[id]) { nameCache.set(id, { name: SPECIAL_AGENCIES[id], url: null }); continue }
    let hit: { name: string; url: string | null } | null = null
    const { data: bp } = await supabase.from('berater_players')
      .select('current_agent_name, agent_url').like('agent_url', `%/berater/${id}`)
      .neq('current_agent_name', NO_AGENT).not('current_agent_name', 'like', 'Agentur (TM %')
      .order('agent_updated_at', { ascending: false }).limit(1)
    if (bp?.[0]?.current_agent_name) hit = { name: bp[0].current_agent_name, url: bp[0].agent_url }
    if (!hit) {
      const { data: ch } = await supabase.from('berater_changes')
        .select('previous_agent_name, previous_agent_url').like('previous_agent_url', `%/berater/${id}`)
        .order('created_at', { ascending: false }).limit(1)
      if (ch?.[0]?.previous_agent_name) hit = { name: ch[0].previous_agent_name, url: ch[0].previous_agent_url }
    }
    // Unbekannte Agentur: Nummer zeigen, Link führt trotzdem zur Beraterseite
    nameCache.set(id, hit || { name: `Agentur (TM ${id})`, url: `https://www.transfermarkt.de/-/beraterfirma/berater/${id}` })
  }
}

/** Berater eines tmapi-Spielers; vorher resolveAgencyNames für alle Nummern aufrufen. */
export function agencyOf(p: any): AgencyInfo {
  const id = agencyIdOf(p)
  if (!id) return { agencyId: null, name: NO_AGENT, url: null }
  const hit = nameCache.get(id)
  return { agencyId: id, name: hit?.name || `Agentur (TM ${id})`, url: hit?.url ?? null }
}
