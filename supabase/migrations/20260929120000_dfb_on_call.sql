-- DFB-Kader: Spieler "auf Abruf" getrennt vom eigentlichen Kader (Abschnitt im Datencenter)
alter table public.scouting_lineups add column if not exists dfb_on_call boolean not null default false;
