-- Glocken-Feature: Abos auf Beraterstatus-Änderungen einzelner Spieler
-- + In-App-Benachrichtigungen (Popup beim nächsten App-Öffnen).
-- Telegram-Versand übernimmt der berater-scan direkt (Magnus-Bot-Token).

CREATE TABLE IF NOT EXISTS public.berater_alert_subs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID REFERENCES public.berater_players(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(player_id)
);

CREATE TABLE IF NOT EXISTS public.berater_alert_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID REFERENCES public.berater_players(id) ON DELETE CASCADE,
  player_name TEXT,
  message TEXT NOT NULL,
  seen BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_notifications_unseen
  ON public.berater_alert_notifications(seen) WHERE seen = FALSE;

ALTER TABLE public.berater_alert_subs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.berater_alert_notifications ENABLE ROW LEVEL SECURITY;

-- Nur angemeldete App-Nutzer (Scan schreibt via service-role, umgeht RLS)
CREATE POLICY "Allow authenticated berater_alert_subs"
  ON public.berater_alert_subs FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated berater_alert_notifications"
  ON public.berater_alert_notifications FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
