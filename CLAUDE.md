# Scouting-App (Matti + Magnus)

Ich bin Magnus, duze Matti, antworte kurz auf Deutsch. Details stehen im gemeinsamen Gedächtnis (feedback_scouting_*, feedback_*modal*, project_meine_spiele_abgleich, project_wappen_namensabgleich).

## Betrieb
- Teilt die Supabase-DB mit der KMH-App: kein blindes `supabase db push`, RLS beachten.
- Expo nie mit CI=1 starten. Mobil nie reinzoomen bei Eingabefeldern (maximum-scale=1 in App.tsx).
- Bei jeder UI-Änderung Desktop UND Mobil gleichzeitig, alle Modal-Instanzen prüfen.

## Design (Retro-Look)
- Spiele-Übersicht ist die Design-Referenz; Buttons und ✕ im gelben Balken in diesem Stil.
- Mobil: Modale als Bottom-Sheet (max. 90 % Höhe, Luft oben), kompakte Titelleiste mit Wappen. SAFE_BOTTOM für alles unten.
- Alle Dropdowns wie „Position“ (Häkchen, abwählbar), auch Einzelauswahl.
- „Spielerprofil wie immer“ = PlayerDetailModal (Retro), nie das alte dunkle Profil-Modal.
- Karten-Popup 1:1 wie Listenzeile (86 px Datumsblock gelb, heute grün, AK + Art, Heim/Gast mit Wappen).
- Spielort NIE in Listenzeilen, nur im Modal. Mehrtägige Termine = 3-zeiliger Datumsblock.
- KMH-Spieler-Tags nur über den hinterlegten Verein, Namen in eigener Zeile unter der Partie.

## RN-Web-Fallen
- Ü/Ä/Ö werden abgeschnitten bei numberOfLines={1} + großer Schrift: lineHeight ≈ fontSize × 1,27.
- FlatList bleibt bei 10 Zeilen: lange Listen als ScrollView + Nachladen in 60ern.
- <Image> als Hintergrund: width/height '100%' + objectFit/objectPosition UND backgroundSize/backgroundPosition.

## Daten
- Vereinsnamen mit echten Umlauten; Wappen-Abgleich fussball.de ↔ TM laut project_wappen_namensabgleich.
- fussball.de-Verlegungen: neuer Termin steht nur als Text, gegen Spiel-Detailseite prüfen.
