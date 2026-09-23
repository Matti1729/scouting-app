-- "Ich bin dabei"-Flag für automatisch gesyncte DFB-Termine (Länderspiele/Lehrgänge):
-- erst mit attending = true erscheinen sie unter "Meine Spiele"/Archiv.
ALTER TABLE scouting_matches ADD COLUMN IF NOT EXISTS attending BOOLEAN NOT NULL DEFAULT false;
