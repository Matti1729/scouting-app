-- DFB-Länderspiel: Lehrgangskader-Spieler ohne Einsatz im Spieltagskader (im Spiel-Modal ausgeblendet)
alter table public.scouting_lineups add column if not exists dfb_not_in_squad boolean not null default false;
