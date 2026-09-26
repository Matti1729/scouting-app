// sync-own-matches: "Meine Spiele" (eigene scouting_matches mit fussball.de-Link) mit
// fussball.de abgleichen. Beim Hinzufügen speichert die App eine Kopie (Datum, Uhrzeit,
// Teams); verlegt fussball.de das Spiel oder steht der Pokal-Gegner fest, bliebe die
// Kopie sonst veraltet.
//
// Quelle 1: area_games (täglicher fussball.de-Sync der KMH-App, berücksichtigt
//           Verlegungen) über die Spiel-ID im Link — liefert Datum UND Uhrzeit.
// Quelle 2: die fussball.de-Spielseite (Titel "Heim - Gast Ergebnis: … - TT.MM.JJJJ";
//           Uhrzeit ist dort font-obfuskiert und bleibt dann unverändert).
//
// Bei Änderung: Spiel aktualisieren, change_note ("Verlegt · vorher 07.10. 18:30",
// "Gegner steht fest", "Abgesagt") + changed_at setzen, change_seen_at leeren (die App
// zeigt den Hinweis, bis das Spiel geöffnet wird) und Matti per Telegram informieren.
//
// Aufruf: pg_cron ohne Body. Mit Service-Role-Bearer: {"dry_run":true} liefert nur die
// erkannten Änderungen.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
// "Meine Spiele" sind Mattis Spiele: Hinweise nur an seinen Telegram-Chat
const MATTI_ADVISOR_ID = "892d4dbc-3c5b-4908-9735-ac0ca3794dfc";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36";

type OwnMatch = {
  id: string;
  home_team: string;
  away_team: string | null;
  match_date: string;
  match_time: string | null;
  fussball_de_url: string;
  change_note: string | null;
  location: string | null;
};

// venue: Spielort wie die App ihn beim Hinzufügen speichert ("Platz, Adresse"), nur aus area_games
type Current = { date: string; time: string | null; home: string; away: string; cancelled: boolean; venue?: string | null };

/** "U19 SC Freiburg" -> "SC Freiburg"; U20+ = II (wie stripAge in areaGamesService) */
function stripAge(name: string): string {
  return (name || "")
    .replace(/\s*\bU[\s-]?(\d{2})\b/gi, (_f, n) => (parseInt(n, 10) >= 20 ? " II" : ""))
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/\b(N?LZ|Fußball|Fussball)\b/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Vereinskern für den Vergleich (Rechtsform, Zahlen, U-Labels egal) */
function clubCore(name: string): string {
  return (name || "")
    .toLowerCase()
    .replace(/\brasenballsport\b/g, "rb")
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/\bu[\s-]?\d{1,2}\b/g, "")
    .replace(/\b(ii|iii|\d{1,4})\b/g, "")
    .replace(/[().-]/g, " ")
    .replace(/\b(1|f|c|e|v|fc|sv|tsv|vfb|vfl|vfr|sc|tsg|tus|spvgg|sg|fsv|vsg|bsg|dsc|fv)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const isPlaceholder = (name: string | null) => /gewinner|sieger|verlierer|\(ph\)|\bn\.?\s?n\.?\b|freilos/i.test(name || "");

/** Gleicher Verein? Kern gleich oder ein Kern-Wort gemeinsam (Namensvarianten TM/fussball.de) */
function sameClub(a: string, b: string): boolean {
  const ca = clubCore(a);
  const cb = clubCore(b);
  if (!ca || !cb) return true;
  if (ca === cb) return true;
  const ta = new Set(ca.split(" ").filter((t) => t.length >= 4));
  return cb.split(" ").some((t) => t.length >= 4 && ta.has(t));
}

function gameId(url: string): string | null {
  return (url.match(/\/-\/spiel\/([A-Z0-9]{20,})/i) || [])[1] || null;
}

async function fromArea(sb: SupabaseClient, id: string): Promise<Current | null> {
  const { data } = await sb
    .from("area_games")
    .select("kickoff_date, kickoff_time, home_name, away_name, venue, venue_address")
    .eq("match_key", id)
    .limit(1);
  const g = data?.[0];
  if (!g) return null;
  const venue = g.venue_address ? `${g.venue ? `${g.venue}, ` : ""}${g.venue_address}` : g.venue || null;
  return { date: g.kickoff_date, time: g.kickoff_time || null, home: g.home_name, away: g.away_name, cancelled: false, venue };
}

async function fromPage(url: string): Promise<Current | null> {
  const resp = await fetch(url, { headers: { "User-Agent": UA } });
  if (!resp.ok) return null;
  const html = await resp.text();
  const title = (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]?.replace(/\s+/g, " ").trim() || "";
  const m = title.match(/^(.*?) - (.*?) Ergebnis:.* - (\d{2})\.(\d{2})\.(\d{4})\s*$/);
  if (!m) return null;
  const stage = (html.match(/class="stage-body"[\s\S]{0,3000}/) || [""])[0];
  return {
    date: `${m[5]}-${m[4]}-${m[3]}`,
    time: null, // auf der Spielseite obfuskiert
    home: m[1].trim(),
    away: m[2].trim(),
    cancelled: /absetzung|abgesetzt|abgesagt|annulliert|nichtantritt/i.test(stage),
  };
}

const fmtDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;

function diff(m: OwnMatch, c: Current): { patch: Record<string, unknown>; notes: string[] } | null {
  const patch: Record<string, unknown> = {};
  const notes: string[] = [];
  if (c.cancelled) {
    notes.push("Abgesagt");
  }
  const dateChanged = c.date && c.date !== m.match_date;
  const timeChanged = !!c.time && c.time !== (m.match_time || "");
  if (dateChanged || timeChanged) {
    notes.push(`Verlegt · vorher ${fmtDate(m.match_date)}${m.match_time ? ` ${m.match_time}` : ""}`);
    if (dateChanged) patch.match_date = c.date;
    if (timeChanged) patch.match_time = c.time;
  }
  // Teams nur ersetzen, wenn sich wirklich ein Verein geändert hat (gespeicherte Namen sind
  // teils vereinheitlicht, "TSG 1899 Hoffenheim" vs. "TSG Hoffenheim" ist KEINE Änderung)
  const homeNew = !isPlaceholder(c.home) && (isPlaceholder(m.home_team) || !sameClub(m.home_team, c.home));
  const awayNew = !isPlaceholder(c.away) && (isPlaceholder(m.away_team) || !sameClub(m.away_team || "", c.away));
  if (homeNew || awayNew) {
    const wasPlaceholder = (homeNew && isPlaceholder(m.home_team)) || (awayNew && isPlaceholder(m.away_team));
    notes.push(wasPlaceholder ? "Gegner steht fest" : "Paarung geändert");
    if (homeNew) patch.home_team = stripAge(c.home);
    if (awayNew) patch.away_team = stripAge(c.away);
    // Ort stand nur als Platzhalter drin ("Gewinner aus Spiel …") -> echten Spielort setzen
    if (isPlaceholder(m.location)) patch.location = c.venue || null;
  }
  if (!notes.length) return null;
  const note = notes.join(" · ");
  if (note === m.change_note && !Object.keys(patch).length) return null; // schon gemeldet
  return { patch: { ...patch, change_note: note, changed_at: new Date().toISOString(), change_seen_at: null }, notes };
}

async function notifyMatti(sb: SupabaseClient, text: string): Promise<string | null> {
  if (!TELEGRAM_BOT_TOKEN) return "TELEGRAM_BOT_TOKEN fehlt";
  const { data } = await sb.from("advisor_telegram_links").select("telegram_chat_id").eq("advisor_id", MATTI_ADVISOR_ID);
  for (const l of data || []) {
    const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: Number(l.telegram_chat_id), text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    if (!r.ok) return `Telegram HTTP ${r.status}`;
  }
  return null;
}

const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Service-Role? advisor_telegram_links ist per RLS nur für die Service-Role lesbar */
async function isServiceRole(auth: string | null): Promise<boolean> {
  const token = (auth || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  if (token === SERVICE_KEY) return true;
  try {
    const probe = createClient(SUPABASE_URL, token, { auth: { persistSession: false } });
    const { data, error } = await probe.from("advisor_telegram_links").select("advisor_id").limit(1);
    return !error && (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run === true && (await isServiceRole(req.headers.get("Authorization")));
    const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const { data: own, error } = await sb
      .from("scouting_matches")
      .select("id, home_team, away_team, match_date, match_time, fussball_de_url, change_note, location")
      .is("source", null)
      .eq("is_archived", false)
      .not("fussball_de_url", "is", null)
      .gte("match_date", yesterday);
    if (error) throw new Error(`scouting_matches: ${error.message}`);

    const changes: { id: string; spiel: string; notes: string[]; patch: Record<string, unknown> }[] = [];
    const log: string[] = [];
    for (const m of (own || []) as OwnMatch[]) {
      const id = gameId(m.fussball_de_url);
      if (!id) continue;
      let cur: Current | null = null;
      try {
        cur = (await fromArea(sb, id)) || (await fromPage(m.fussball_de_url));
      } catch (e) {
        log.push(`${m.id}: ${(e as Error).message}`);
      }
      if (!cur) continue;
      const d = diff(m, cur);
      if (!d) continue;
      const home = (d.patch.home_team as string) || m.home_team;
      const away = (d.patch.away_team as string) || m.away_team || "";
      changes.push({ id: m.id, spiel: away ? `${home} – ${away}` : home, notes: d.notes, patch: d.patch });
    }
    if (dryRun) return json({ ok: true, checked: own?.length || 0, changes, log });

    for (const c of changes) {
      const { error: ue } = await sb.from("scouting_matches").update(c.patch).eq("id", c.id);
      if (ue) { log.push(`Update ${c.id}: ${ue.message}`); continue; }
      const date = (c.patch.match_date as string) || "";
      const when = date ? ` → ${fmtDate(date)}${c.patch.match_time ? ` ${c.patch.match_time}` : ""}` : "";
      const err = await notifyMatti(sb, `📅 <b>Meine Spiele: ${esc(c.notes.join(" · "))}</b>\n${esc(c.spiel)}${esc(when)}`);
      if (err) log.push(`Telegram ${c.id}: ${err}`);
    }
    return json({ ok: true, checked: own?.length || 0, changed: changes.length, log });
  } catch (e) {
    console.error("sync-own-matches:", e);
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
