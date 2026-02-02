// DFB Nationalmannschaft & Hallenturniere Service
// Diese Daten werden manuell gepflegt und können erweitert werden

export interface DFBTermin {
  datumStart: string;
  datumEnde?: string;
  zeit?: string;
  art: 'Nationalmannschaft' | 'Hallenturnier';
  eventTyp: 'Spiel' | 'Lehrgang' | 'Turnier' | 'Camp' | 'Sichtung';
  titel: string;
  jahrgang: string;
  ort?: string;
  gegner?: string;
  wettbewerb?: string;
}

export const DFB_LAST_UPDATE = '2026-01-04T06:47:00';

// ============ DFB NATIONALMANNSCHAFT TERMINE ============
export const DFB_TERMINE: DFBTermin[] = [
  // U21
  { datumStart: '2026-03-22', datumEnde: '2026-04-01', art: 'Nationalmannschaft', eventTyp: 'Lehrgang', titel: 'Lehrgang', jahrgang: 'U21' },
  { datumStart: '2026-03-27', zeit: '18:00', art: 'Nationalmannschaft', eventTyp: 'Spiel', titel: 'Deutschland - Nordirland (EMQ)', jahrgang: 'U21', ort: 'Braunschweig', gegner: 'Nordirland', wettbewerb: 'EMQ' },
  { datumStart: '2026-03-31', art: 'Nationalmannschaft', eventTyp: 'Spiel', titel: 'Griechenland - Deutschland (EMQ)', jahrgang: 'U21', ort: 'Athen', gegner: 'Griechenland', wettbewerb: 'EMQ' },
  { datumStart: '2026-09-26', art: 'Nationalmannschaft', eventTyp: 'Spiel', titel: 'Lettland - Deutschland (EMQ)', jahrgang: 'U21', gegner: 'Lettland', wettbewerb: 'EMQ' },
  { datumStart: '2026-09-30', art: 'Nationalmannschaft', eventTyp: 'Spiel', titel: 'Malta - Deutschland (EMQ)', jahrgang: 'U21', gegner: 'Malta', wettbewerb: 'EMQ' },
  { datumStart: '2026-10-06', art: 'Nationalmannschaft', eventTyp: 'Spiel', titel: 'Deutschland - Georgien (EMQ)', jahrgang: 'U21', gegner: 'Georgien', wettbewerb: 'EMQ' },
  
  // U20
  { datumStart: '2026-03-23', datumEnde: '2026-03-31', art: 'Nationalmannschaft', eventTyp: 'Lehrgang', titel: 'Lehrgang mit Länderspielen', jahrgang: 'U20' },
  { datumStart: '2026-03-26', art: 'Nationalmannschaft', eventTyp: 'Spiel', titel: 'Deutschland - Tschechien (LSP)', jahrgang: 'U20', gegner: 'Tschechien', wettbewerb: 'LSP' },
  { datumStart: '2026-03-30', art: 'Nationalmannschaft', eventTyp: 'Spiel', titel: 'Polen - Deutschland (LSP)', jahrgang: 'U20', gegner: 'Polen', wettbewerb: 'LSP' },
  { datumStart: '2026-04-12', datumEnde: '2026-04-15', art: 'Nationalmannschaft', eventTyp: 'Camp', titel: 'Torwart-Camp', jahrgang: 'U20' },
  
  // U19
  { datumStart: '2026-03-01', datumEnde: '2026-03-04', art: 'Nationalmannschaft', eventTyp: 'Lehrgang', titel: 'Lehrgang', jahrgang: 'U19' },
  { datumStart: '2026-03-22', datumEnde: '2026-04-01', art: 'Nationalmannschaft', eventTyp: 'Turnier', titel: '2. Runde EM-Qualifikation', jahrgang: 'U19', ort: 'Deutschland' },
  { datumStart: '2026-03-25', art: 'Nationalmannschaft', eventTyp: 'Spiel', titel: 'Deutschland - Schweden (EMQ)', jahrgang: 'U19', gegner: 'Schweden', wettbewerb: 'EMQ' },
  { datumStart: '2026-03-28', art: 'Nationalmannschaft', eventTyp: 'Spiel', titel: 'Deutschland - Griechenland (EMQ)', jahrgang: 'U19', gegner: 'Griechenland', wettbewerb: 'EMQ' },
  { datumStart: '2026-03-31', art: 'Nationalmannschaft', eventTyp: 'Spiel', titel: 'Österreich - Deutschland (EMQ)', jahrgang: 'U19', gegner: 'Österreich', wettbewerb: 'EMQ' },
  { datumStart: '2026-04-12', datumEnde: '2026-04-15', art: 'Nationalmannschaft', eventTyp: 'Camp', titel: 'Torwart-Camp', jahrgang: 'U19' },
  { datumStart: '2026-05-24', datumEnde: '2026-05-28', art: 'Nationalmannschaft', eventTyp: 'Lehrgang', titel: 'Lehrgang mit Länderspiel', jahrgang: 'U19' },
  { datumStart: '2026-06-16', datumEnde: '2026-06-22', art: 'Nationalmannschaft', eventTyp: 'Lehrgang', titel: 'EM-Vorbereitungslehrgang', jahrgang: 'U19' },
  { datumStart: '2026-06-25', datumEnde: '2026-07-12', art: 'Nationalmannschaft', eventTyp: 'Turnier', titel: 'Europameisterschaft', jahrgang: 'U19', ort: 'Wales' },
  
  // U18
  { datumStart: '2026-03-01', datumEnde: '2026-03-04', art: 'Nationalmannschaft', eventTyp: 'Lehrgang', titel: 'Lehrgang', jahrgang: 'U18', ort: 'DFB-Campus' },
  { datumStart: '2026-03-24', datumEnde: '2026-04-01', art: 'Nationalmannschaft', eventTyp: 'Turnier', titel: 'EM-Qualifikation', jahrgang: 'U18', ort: 'Österreich' },
  { datumStart: '2026-03-25', art: 'Nationalmannschaft', eventTyp: 'Spiel', titel: 'Deutschland - Bosnien-Herzegowina (EMQ)', jahrgang: 'U18', gegner: 'Bosnien-Herzegowina', wettbewerb: 'EMQ' },
  { datumStart: '2026-03-28', art: 'Nationalmannschaft', eventTyp: 'Spiel', titel: 'Deutschland - Israel (EMQ)', jahrgang: 'U18', gegner: 'Israel', wettbewerb: 'EMQ' },
  { datumStart: '2026-03-31', art: 'Nationalmannschaft', eventTyp: 'Spiel', titel: 'Österreich - Deutschland (EMQ)', jahrgang: 'U18', gegner: 'Österreich', wettbewerb: 'EMQ' },
  { datumStart: '2026-04-12', datumEnde: '2026-04-15', art: 'Nationalmannschaft', eventTyp: 'Camp', titel: 'Torwart-Camp', jahrgang: 'U18' },
  { datumStart: '2026-05-24', datumEnde: '2026-05-28', art: 'Nationalmannschaft', eventTyp: 'Lehrgang', titel: 'Lehrgang mit Länderspiel', jahrgang: 'U18' },
  
  // U17
  { datumStart: '2026-01-04', datumEnde: '2026-01-15', art: 'Nationalmannschaft', eventTyp: 'Lehrgang', titel: 'Wintertrainingslager', jahrgang: 'U17', ort: 'Pinatar, Spanien' },
  { datumStart: '2026-01-11', zeit: '11:00', art: 'Nationalmannschaft', eventTyp: 'Spiel', titel: 'Portugal - Deutschland (LSP)', jahrgang: 'U17', ort: 'Pinatar', gegner: 'Portugal', wettbewerb: 'LSP' },
  { datumStart: '2026-01-14', zeit: '16:00', art: 'Nationalmannschaft', eventTyp: 'Spiel', titel: 'Deutschland - Portugal (LSP)', jahrgang: 'U17', ort: 'Pinatar', gegner: 'Portugal', wettbewerb: 'LSP' },
  { datumStart: '2026-02-09', datumEnde: '2026-02-19', art: 'Nationalmannschaft', eventTyp: 'Turnier', titel: 'Algarve-Cup', jahrgang: 'U17', ort: 'Portugal' },
  { datumStart: '2026-02-13', art: 'Nationalmannschaft', eventTyp: 'Spiel', titel: 'Portugal - Deutschland', jahrgang: 'U17', ort: 'Portugal', gegner: 'Portugal' },
  { datumStart: '2026-02-15', art: 'Nationalmannschaft', eventTyp: 'Spiel', titel: 'Deutschland - Dänemark', jahrgang: 'U17', ort: 'Portugal', gegner: 'Dänemark' },
  { datumStart: '2026-02-18', art: 'Nationalmannschaft', eventTyp: 'Spiel', titel: 'Spanien - Deutschland', jahrgang: 'U17', ort: 'Portugal', gegner: 'Spanien' },
  { datumStart: '2026-03-20', datumEnde: '2026-03-22', art: 'Nationalmannschaft', eventTyp: 'Lehrgang', titel: 'Vorbereitungslehrgang', jahrgang: 'U17' },
  { datumStart: '2026-03-24', datumEnde: '2026-04-01', art: 'Nationalmannschaft', eventTyp: 'Turnier', titel: '2. Runde EM-Qualifikation', jahrgang: 'U17', ort: 'Slowenien' },
  { datumStart: '2026-03-25', art: 'Nationalmannschaft', eventTyp: 'Spiel', titel: 'Deutschland - Nordmazedonien (EMQ)', jahrgang: 'U17', ort: 'Slowenien', gegner: 'Nordmazedonien', wettbewerb: 'EMQ' },
  { datumStart: '2026-03-28', art: 'Nationalmannschaft', eventTyp: 'Spiel', titel: 'Deutschland - Slowenien (EMQ)', jahrgang: 'U17', ort: 'Slowenien', gegner: 'Slowenien', wettbewerb: 'EMQ' },
  { datumStart: '2026-03-31', art: 'Nationalmannschaft', eventTyp: 'Spiel', titel: 'Frankreich - Deutschland (EMQ)', jahrgang: 'U17', ort: 'Slowenien', gegner: 'Frankreich', wettbewerb: 'EMQ' },
  { datumStart: '2026-04-12', datumEnde: '2026-04-15', art: 'Nationalmannschaft', eventTyp: 'Camp', titel: 'Torwart-Camp', jahrgang: 'U17' },
  { datumStart: '2026-05-18', datumEnde: '2026-05-24', art: 'Nationalmannschaft', eventTyp: 'Lehrgang', titel: 'EM-Vorbereitung', jahrgang: 'U17' },
  { datumStart: '2026-05-25', datumEnde: '2026-06-08', art: 'Nationalmannschaft', eventTyp: 'Turnier', titel: 'Europameisterschaft', jahrgang: 'U17', ort: 'Estland' },
  { datumStart: '2026-11-10', datumEnde: '2026-11-18', art: 'Nationalmannschaft', eventTyp: 'Turnier', titel: 'EM-Qualifikation', jahrgang: 'U17' },
  { datumStart: '2026-11-11', art: 'Nationalmannschaft', eventTyp: 'Spiel', titel: 'Deutschland - Nordirland (EMQ)', jahrgang: 'U17', gegner: 'Nordirland', wettbewerb: 'EMQ' },
  { datumStart: '2026-11-14', art: 'Nationalmannschaft', eventTyp: 'Spiel', titel: 'Deutschland - Litauen (EMQ)', jahrgang: 'U17', gegner: 'Litauen', wettbewerb: 'EMQ' },
  { datumStart: '2026-11-17', art: 'Nationalmannschaft', eventTyp: 'Spiel', titel: 'Deutschland - Aserbaidschan (EMQ)', jahrgang: 'U17', gegner: 'Aserbaidschan', wettbewerb: 'EMQ' },
  
  // U16
  { datumStart: '2026-01-04', datumEnde: '2026-01-15', art: 'Nationalmannschaft', eventTyp: 'Lehrgang', titel: 'Wintertrainingslager', jahrgang: 'U16', ort: 'Pinatar, Spanien' },
  { datumStart: '2026-01-11', zeit: '16:00', art: 'Nationalmannschaft', eventTyp: 'Spiel', titel: 'Portugal - Deutschland (LSP)', jahrgang: 'U16', ort: 'Pinatar', gegner: 'Portugal', wettbewerb: 'LSP' },
  { datumStart: '2026-01-14', zeit: '11:00', art: 'Nationalmannschaft', eventTyp: 'Spiel', titel: 'Deutschland - Portugal (LSP)', jahrgang: 'U16', ort: 'Pinatar', gegner: 'Portugal', wettbewerb: 'LSP' },
  { datumStart: '2026-02-08', datumEnde: '2026-02-18', art: 'Nationalmannschaft', eventTyp: 'Turnier', titel: 'Turnier', jahrgang: 'U16', ort: 'Portugal' },
  { datumStart: '2026-03-23', datumEnde: '2026-03-31', art: 'Nationalmannschaft', eventTyp: 'Lehrgang', titel: 'Lehrgang mit zwei Länderspielen gegen Italien', jahrgang: 'U16', gegner: 'Italien' },
  { datumStart: '2026-04-12', datumEnde: '2026-04-15', art: 'Nationalmannschaft', eventTyp: 'Camp', titel: 'Torwart-Camp', jahrgang: 'U16' },
  { datumStart: '2026-05-12', datumEnde: '2026-05-13', art: 'Nationalmannschaft', eventTyp: 'Lehrgang', titel: 'Lehrgang U17-Perspektivkader', jahrgang: 'U16' },
  { datumStart: '2026-05-14', datumEnde: '2026-05-19', art: 'Nationalmannschaft', eventTyp: 'Sichtung', titel: 'Sichtungsturnier', jahrgang: 'U16', ort: 'Duisburg' },
  { datumStart: '2026-05-24', datumEnde: '2026-05-27', art: 'Nationalmannschaft', eventTyp: 'Lehrgang', titel: 'Lehrgang', jahrgang: 'U16', ort: 'DFB-Campus' },
  { datumStart: '2026-06-07', datumEnde: '2026-06-11', art: 'Nationalmannschaft', eventTyp: 'Lehrgang', titel: 'Lehrgang mit Länderspiel', jahrgang: 'U16' },
  
  // U15
  { datumStart: '2026-03-15', datumEnde: '2026-03-20', art: 'Nationalmannschaft', eventTyp: 'Lehrgang', titel: 'Lehrgang', jahrgang: 'U15', ort: 'DFB-Campus' },
  { datumStart: '2026-03-22', datumEnde: '2026-03-27', art: 'Nationalmannschaft', eventTyp: 'Lehrgang', titel: 'Lehrgang', jahrgang: 'U15', ort: 'DFB-Campus' },
  { datumStart: '2026-04-12', datumEnde: '2026-04-15', art: 'Nationalmannschaft', eventTyp: 'Camp', titel: 'Torwart-Camp', jahrgang: 'U15' },
  { datumStart: '2026-04-20', datumEnde: '2026-04-23', art: 'Nationalmannschaft', eventTyp: 'Lehrgang', titel: 'Lehrgang', jahrgang: 'U15' },
  { datumStart: '2026-05-03', datumEnde: '2026-05-09', art: 'Nationalmannschaft', eventTyp: 'Lehrgang', titel: 'Lehrgang mit Länderspiel', jahrgang: 'U15' },
  { datumStart: '2026-05-28', datumEnde: '2026-06-02', art: 'Nationalmannschaft', eventTyp: 'Sichtung', titel: 'Sichtungsturnier', jahrgang: 'U15', ort: 'Duisburg' },
  { datumStart: '2026-06-11', datumEnde: '2026-06-16', art: 'Nationalmannschaft', eventTyp: 'Sichtung', titel: 'U14-Sichtungsturnier', jahrgang: 'U15', ort: 'Bad Blankenberg' },
  { datumStart: '2026-06-18', datumEnde: '2026-06-23', art: 'Nationalmannschaft', eventTyp: 'Sichtung', titel: 'U14-Sichtungsturnier', jahrgang: 'U15', ort: 'Kaiserau' },
];

// ============ HALLENTURNIERE 2026 ============
export const HALLEN_TERMINE: DFBTermin[] = [
  // Januar
  { datumStart: '2026-01-02', datumEnde: '2026-01-03', art: 'Hallenturnier', eventTyp: 'Turnier', titel: 'Wieseck Hallenmasters', jahrgang: 'U13', ort: 'Gießen/HES' },
  { datumStart: '2026-01-03', art: 'Hallenturnier', eventTyp: 'Turnier', titel: 'Wieseck Hallenmasters', jahrgang: 'U16', ort: 'Gießen/HES' },
  { datumStart: '2026-01-03', art: 'Hallenturnier', eventTyp: 'Turnier', titel: 'Sonnenlandcup', jahrgang: 'U15', ort: 'Passau/BAY' },
  { datumStart: '2026-01-03', art: 'Hallenturnier', eventTyp: 'Turnier', titel: 'Safeguard Masters', jahrgang: 'U14', ort: 'Nußloch/BW' },
  { datumStart: '2026-01-03', art: 'Hallenturnier', eventTyp: 'Turnier', titel: 'DJK Hallentage', jahrgang: 'U14', ort: 'Ingolstadt/BAY' },
  { datumStart: '2026-01-04', art: 'Hallenturnier', eventTyp: 'Turnier', titel: 'Wieseck Hallenmasters', jahrgang: 'U15', ort: 'Gießen/HES' },
  { datumStart: '2026-01-04', art: 'Hallenturnier', eventTyp: 'Turnier', titel: 'Baumit-Cup', jahrgang: 'U15', ort: 'Schärding/AUT' },
  { datumStart: '2026-01-04', art: 'Hallenturnier', eventTyp: 'Turnier', titel: 'Wohlfeil-Cup', jahrgang: 'U14', ort: 'Karlsdorf-Neuthard/BW' },
  { datumStart: '2026-01-06', art: 'Hallenturnier', eventTyp: 'Turnier', titel: 'Franz-Illich-Cup', jahrgang: 'U14', ort: 'Munderkingen/BW' },
  { datumStart: '2026-01-08', datumEnde: '2026-01-11', art: 'Hallenturnier', eventTyp: 'Turnier', titel: 'Rewe Juniorcup', jahrgang: 'U19', ort: 'Göttingen/NIE' },
  { datumStart: '2026-01-09', datumEnde: '2026-01-10', art: 'Hallenturnier', eventTyp: 'Turnier', titel: 'Wieseck Hallenmasters', jahrgang: 'U14', ort: 'Gießen/HES' },
  { datumStart: '2026-01-10', datumEnde: '2026-01-11', art: 'Hallenturnier', eventTyp: 'Turnier', titel: 'Mercedes Benz Junior Masters', jahrgang: 'U19', ort: 'Sindelfingen/BW' },
  { datumStart: '2026-01-10', datumEnde: '2026-01-11', art: 'Hallenturnier', eventTyp: 'Turnier', titel: 'BWK Arena Cup', jahrgang: 'U15', ort: 'Ilshofen/BW' },
  { datumStart: '2026-01-10', datumEnde: '2026-01-11', art: 'Hallenturnier', eventTyp: 'Turnier', titel: 'Pape Cup', jahrgang: 'U15', ort: 'Magdeburg/SA' },
  { datumStart: '2026-01-10', datumEnde: '2026-01-11', art: 'Hallenturnier', eventTyp: 'Turnier', titel: 'EKC.AG Cup', jahrgang: 'U15', ort: 'Würzburg/BAY' },
  { datumStart: '2026-01-10', datumEnde: '2026-01-11', art: 'Hallenturnier', eventTyp: 'Turnier', titel: 'Styrian Indoormasters', jahrgang: 'U14', ort: 'Hartberg/AUT' },
  { datumStart: '2026-01-10', datumEnde: '2026-01-11', art: 'Hallenturnier', eventTyp: 'Turnier', titel: 'Sparkassencup', jahrgang: 'U14', ort: 'Haiterbach/BW' },
  { datumStart: '2026-01-10', art: 'Hallenturnier', eventTyp: 'Turnier', titel: 'Gerd Schädlich Gedenkturnier', jahrgang: 'U14', ort: 'Lößnitz/SAC' },
  { datumStart: '2026-01-11', art: 'Hallenturnier', eventTyp: 'Turnier', titel: 'Brass Cup', jahrgang: 'U17', ort: 'Aschaffenburg/BAY' },
  { datumStart: '2026-01-11', art: 'Hallenturnier', eventTyp: 'Turnier', titel: 'Junioren Masters', jahrgang: 'U14', ort: 'Gera/THÜ' },
  { datumStart: '2026-01-17', datumEnde: '2026-01-18', art: 'Hallenturnier', eventTyp: 'Turnier', titel: 'Liliencup', jahrgang: 'U17', ort: 'Wiesbaden/HES' },
  { datumStart: '2026-01-17', datumEnde: '2026-01-18', art: 'Hallenturnier', eventTyp: 'Turnier', titel: 'Freeway Cup', jahrgang: 'U16', ort: 'Lübbecke/NIE' },
  { datumStart: '2026-01-17', datumEnde: '2026-01-18', art: 'Hallenturnier', eventTyp: 'Turnier', titel: 'Hallenmasters', jahrgang: 'U15', ort: 'Iserlohn/NRW' },
  { datumStart: '2026-01-17', art: 'Hallenturnier', eventTyp: 'Turnier', titel: 'Karl-Schnieke-Turnier', jahrgang: 'U14', ort: 'Jena/THÜ' },
  { datumStart: '2026-01-18', art: 'Hallenturnier', eventTyp: 'Turnier', titel: 'PS-Immo Cup', jahrgang: 'U14', ort: 'Lörrach/BW' },
  { datumStart: '2026-01-24', art: 'Hallenturnier', eventTyp: 'Turnier', titel: 'HLM BRB Endrunde', jahrgang: 'U17', ort: 'Cottbus/BRB' },
  { datumStart: '2026-01-24', art: 'Hallenturnier', eventTyp: 'Turnier', titel: 'Volksbank Cup', jahrgang: 'U15', ort: 'Ochtrup/NRW' },
  { datumStart: '2026-01-24', art: 'Hallenturnier', eventTyp: 'Turnier', titel: 'Allianz Hallencup', jahrgang: 'U14', ort: 'Sondershausen/THÜ' },
  { datumStart: '2026-01-24', art: 'Hallenturnier', eventTyp: 'Turnier', titel: 'WDFV Futsal Meisterschaft', jahrgang: 'U14', ort: 'Borchen/NRW' },
  { datumStart: '2026-01-24', art: 'Hallenturnier', eventTyp: 'Turnier', titel: 'Hallenpokal', jahrgang: 'U14', ort: 'Blaustein/BW' },
  { datumStart: '2026-01-24', datumEnde: '2026-01-25', art: 'Hallenturnier', eventTyp: 'Turnier', titel: 'Raiba Bundesliga Cup', jahrgang: 'U14', ort: 'Rot a.See/BAY' },
  { datumStart: '2026-01-24', art: 'Hallenturnier', eventTyp: 'Turnier', titel: 'Hallenmasters Endrunde', jahrgang: 'U14', ort: 'Simbach/BAY' },
  { datumStart: '2026-01-25', art: 'Hallenturnier', eventTyp: 'Turnier', titel: 'HLM BRB Endrunde', jahrgang: 'U19', ort: 'Cottbus/BRB' },
  { datumStart: '2026-01-25', art: 'Hallenturnier', eventTyp: 'Turnier', titel: 'HLM BRB', jahrgang: 'U15', ort: 'Cottbus/BRB' },
  { datumStart: '2026-01-25', art: 'Hallenturnier', eventTyp: 'Turnier', titel: 'VR Bank Junior Soccer Cup', jahrgang: 'U15', ort: 'Coburg/BAY' },
  { datumStart: '2026-01-31', art: 'Hallenturnier', eventTyp: 'Turnier', titel: 'Hallentage', jahrgang: 'U17', ort: 'Schongau/BAY' },
  { datumStart: '2026-01-31', art: 'Hallenturnier', eventTyp: 'Turnier', titel: 'Hallentage', jahrgang: 'U15', ort: 'Schongau/BAY' },
  { datumStart: '2026-01-31', art: 'Hallenturnier', eventTyp: 'Turnier', titel: 'Hallenmasters', jahrgang: 'U14', ort: 'Feucht/BAY' },
  // Februar
  { datumStart: '2026-02-07', art: 'Hallenturnier', eventTyp: 'Turnier', titel: 'HLM BER Endrunde', jahrgang: 'U17', ort: 'Berlin' },
  { datumStart: '2026-02-07', art: 'Hallenturnier', eventTyp: 'Turnier', titel: 'VR Bank Hallencup', jahrgang: 'U14', ort: 'Coburg/BAY' },
  { datumStart: '2026-02-08', art: 'Hallenturnier', eventTyp: 'Turnier', titel: 'HLM BER Endrunde', jahrgang: 'U19', ort: 'Berlin' },
  { datumStart: '2026-02-14', art: 'Hallenturnier', eventTyp: 'Turnier', titel: 'HLM NOFV Endrunde', jahrgang: 'U17', ort: 'Gera/THÜ' },
  { datumStart: '2026-02-15', art: 'Hallenturnier', eventTyp: 'Turnier', titel: 'HLM NOFV Endrunde', jahrgang: 'U19', ort: 'Gera/THÜ' },
  { datumStart: '2026-02-15', art: 'Hallenturnier', eventTyp: 'Turnier', titel: 'HLM BER Endrunde', jahrgang: 'U15', ort: 'Berlin' },
  { datumStart: '2026-02-21', art: 'Hallenturnier', eventTyp: 'Turnier', titel: 'HLM BAY Endrunde', jahrgang: 'U15', ort: 'Würzburg/BAY' },
  { datumStart: '2026-02-22', art: 'Hallenturnier', eventTyp: 'Turnier', titel: 'HLM NOFV Endrunde', jahrgang: 'U15', ort: 'Beetzendorf/BRB' },
];

// ============ HELPER FUNCTIONS ============

export function getRelevantTermine(): DFBTermin[] {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  
  const allTermine = [...DFB_TERMINE, ...HALLEN_TERMINE];
  
  return allTermine.filter(t => {
    const endDate = t.datumEnde ? new Date(t.datumEnde) : new Date(t.datumStart);
    return endDate >= yesterday;
  }).sort((a, b) => new Date(a.datumStart).getTime() - new Date(b.datumStart).getTime());
}

export function getDFBTermineCount(): number {
  return DFB_TERMINE.length;
}

export function getHallenTermineCount(): number {
  return HALLEN_TERMINE.length;
}

export function convertToDbFormat(termin: DFBTermin, erstelltVon: string) {
  const datum = termin.zeit 
    ? `${termin.datumStart}T${termin.zeit}:00` 
    : `${termin.datumStart}T00:00:00`;
  
  return {
    datum,
    datum_ende: termin.datumEnde || null,
    art: termin.art,
    titel: termin.titel,
    jahrgang: termin.jahrgang,
    ort: termin.ort || '',
    quelle: termin.art === 'Nationalmannschaft' ? 'DFB' : 'Hallenturnier',
    erstellt_von: erstelltVon,
  };
}

export function getLastUpdateDisplay(): string {
  const date = new Date(DFB_LAST_UPDATE);
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Konvertiert DFB-Termin in Scouting-App Match Format
export function convertToMatchFormat(termin: DFBTermin) {
  // Für Spiele: Home vs Away extrahieren
  // Für Events: Titel als Beschreibung verwenden
  let homeTeam = '';
  let awayTeam = '';

  if (termin.eventTyp === 'Spiel' && termin.titel.includes(' - ')) {
    // Länderspiel: "Deutschland - Nordirland (EMQ)" -> Home: Deutschland, Away: Nordirland
    const parts = termin.titel.split(' - ');
    homeTeam = parts[0].trim();
    awayTeam = parts[1].replace(/\s*\(.*\)$/, '').trim(); // Remove (EMQ), (LSP) etc.
  } else {
    // Lehrgang, Turnier, Camp, Sichtung: Titel als Beschreibung
    homeTeam = termin.titel;
    awayTeam = ''; // Leer lassen - Ort wird separat angezeigt
  }

  return {
    home_team: homeTeam,
    away_team: awayTeam,
    match_date: termin.datumStart,
    match_date_end: termin.datumEnde || null,
    match_time: termin.zeit || null,
    age_group: termin.jahrgang,
    match_type: termin.art,
    location: termin.ort || null,
    is_archived: false,
  };
}
