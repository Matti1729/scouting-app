// Zugangsprüfung für Edge Functions (Matti 2026-11-06): der anon-Key steht öffentlich
// in der App und registrieren kann sich jeder, deshalb zählt nur die Rolle des Kontos.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const BERATER_ROLES = ["admin", "advisor", "berater"];

// kmh = KMH-Zugang, kmh_or_player = auch Spieler,
// staff = Berater in der Scouting-App, scouting = auch Scouts
export type AccessLevel = "kmh" | "kmh_or_player" | "staff" | "scouting";

export async function denyUnlessAccess(
  req: Request,
  corsHeaders: Record<string, string>,
  level: AccessLevel,
): Promise<Response | null> {
  const deny = (status: number) =>
    new Response(JSON.stringify({ error: status === 401 ? "Unauthorized" : "Forbidden" }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  // Zeitpläne (pg_cron) schicken das Geheimwort, Funktionen untereinander den Service-Key
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (cronSecret && req.headers.get("x-cron-secret") === cronSecret) return null;

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return deny(401);
  if (token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return null;

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user }, error } = await sb.auth.getUser(token);
  if (error || !user) return deny(401);

  const { data: advisor } = await sb
    .from("advisors")
    .select("role, access_kmh, access_scouting")
    .eq("id", user.id)
    .maybeSingle();

  let allowed = false;
  if (level === "kmh" || level === "kmh_or_player") allowed = advisor?.access_kmh === true;
  if (level === "scouting") allowed = advisor?.access_scouting === true;
  if (level === "staff") allowed = advisor?.access_scouting === true && BERATER_ROLES.includes(advisor.role);
  if (!allowed && level === "kmh_or_player") {
    const { data: player } = await sb.from("player_details").select("id").eq("linked_user_id", user.id).limit(1).maybeSingle();
    allowed = !!player;
  }
  return allowed ? null : deny(403);
}
