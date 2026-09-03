// PlayerDetailModal — Spieler-Detailansicht im Anstoss-3-Retro-Stil.
// Wird von der Suchmaschine und dem Sportstipendium-Board geteilt, damit das
// Spielerprofil überall identisch aussieht. Lädt die TM-Details (Einsätze,
// Transfers) selbst nach.
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  ActivityIndicator,
  Modal,
  Image,
  Linking,
  Platform,
  TextInput,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  StipendiumSearchPlayer,
  PlayerTmDetails,
  PlayerTmSeasonStats,
  fetchPlayerTmDetails,
  tmFlagUrl,
  flagForNationalTeam,
  loadPlayerNote,
  savePlayerNote,
  fetchEntryAddedBy,
  agentDisplayName,
  teamLabel,
  agRank,
} from '../services/stipendiumService';
import {
  loadMatchEvaluationsForPlayer,
  MatchEvaluation,
  ScoutStatus,
  deriveScoutStatus,
  setScoutStatus,
  isAlertSubscribed,
  setAlertSubscription,
  loadPlayerHistory,
  BeraterChange,
} from '../services/beraterService';
import { MONO } from '../theme/retro';
import { supabase } from '../config/supabase';

// Nativer Datums-Picker des Browsers (input type="date") — nur im Web verfügbar
let createDomElement: ((type: string, props: any) => React.ReactElement) | null = null;
if (Platform.OS === 'web') {
  try {
    createDomElement = require('react-native').unstable_createElement;
  } catch {
    createDomElement = null;
  }
}

// Retro-Farbschema (Anstoss-3-Optik) — identisch zur Suchmaschine
const RETRO = {
  shadowDark: '#55524e',
  text: '#14141e',
  headerBg: '#2b3f96',
  yellow: '#f2c230',
};

const HARD_SHADOW = Platform.OS === 'web'
  ? ({ boxShadow: '2px 2px 3px rgba(20, 20, 45, 0.45)' } as any)
  : { shadowColor: '#14142d', shadowOffset: { width: 2, height: 2 }, shadowOpacity: 0.45, shadowRadius: 2, elevation: 3 };

const HARD_SHADOW_LG = Platform.OS === 'web'
  ? ({ boxShadow: '3px 4px 9px rgba(10, 10, 45, 0.5)' } as any)
  : { shadowColor: '#0a0a2d', shadowOffset: { width: 3, height: 4 }, shadowOpacity: 0.5, shadowRadius: 5, elevation: 4 };

// Namenszusätze, die zum Nachnamen gehören ("van", "de", ...)
const NAME_PARTICLES = new Set([
  'van', 'von', 'de', 'der', 'den', 'del', 'della', 'di', 'da', 'dos', 'das',
  'du', 'la', 'le', 'el', 'al', 'ten', 'ter', 'te', 'zu', 'zur', 'vom', 'zum',
  "'t", 'op', 'oude', 'st.',
]);

export function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length <= 1) return { first: '', last: full.trim() };
  for (let i = 1; i < parts.length - 1; i++) {
    if (NAME_PARTICLES.has(parts[i].toLowerCase())) {
      return { first: parts.slice(0, i).join(' '), last: parts.slice(i).join(' ') };
    }
  }
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

/** Saison-Kurzlabel aus TM-Saisonstartjahr: 2026 -> "26/27" */
function seasonLabel(startYear: number): string {
  return `${String(startYear).slice(-2)}/${String(startYear + 1).slice(-2)}`;
}

/** ISO-Timestamp -> "28.08.2026" */
function formatDateDE(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

/** Dauer zwischen zwei ISO-Daten, z.B. "4 Monate" */
function formatDurationBetween(fromDate: string, toDate: string): string {
  const diffDays = Math.floor((new Date(toDate).getTime() - new Date(fromDate).getTime()) / 86400000);
  if (diffDays < 1) return '< 1 Tag';
  if (diffDays < 7) return `${diffDays} ${diffDays === 1 ? 'Tag' : 'Tage'}`;
  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return `${weeks} ${weeks === 1 ? 'Woche' : 'Wochen'}`;
  }
  if (diffDays < 365) {
    const months = Math.floor(diffDays / 30);
    return `${months} ${months === 1 ? 'Monat' : 'Monate'}`;
  }
  const years = Math.floor(diffDays / 365);
  return `${years} ${years === 1 ? 'Jahr' : 'Jahre'}`;
}

/** "3 Spiele | 4 Tore | 3 Vorlagen" (Fallback nur Spiele, wenn keine Detailstatistik da ist) */
function seasonStatsText(
  stats: PlayerTmSeasonStats | null | undefined,
  games: number | null | undefined
): string {
  if (!stats) return `${games ?? '—'} Spiele`;
  const spiele = `${stats.games} ${stats.games === 1 ? 'Spiel' : 'Spiele'}`;
  const tore = `${stats.goals} ${stats.goals === 1 ? 'Tor' : 'Tore'}`;
  const vorlagen = `${stats.assists} ${stats.assists === 1 ? 'Vorlage' : 'Vorlagen'}`;
  return `${spiele} | ${tore} | ${vorlagen}`;
}

/** Saison, in der ein Datum "DD.MM.YYYY" liegt (minus 1 Tag, damit der 01.07. noch zur Vorsaison zählt) */
function seasonOfDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const m = dateStr.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!m) return null;
  const d = new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
  d.setDate(d.getDate() - 1);
  const startYear = d.getMonth() + 1 >= 7 ? d.getFullYear() : d.getFullYear() - 1;
  return seasonLabel(startYear);
}

/** ISO "YYYY-MM-DD" -> "DD.MM.YYYY" */
function formatContract(iso: string | null): string | null {
  if (!iso) return null;
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  return `${parts[2]}.${parts[1]}.${parts[0]}`;
}

// Positions-Kürzel ausgeschrieben (Kürzel aus stipendiumService.positionCode)
const POSITION_FULL: Record<string, string> = {
  TW: 'Torwart',
  IV: 'Innenverteidiger',
  LV: 'Linker Verteidiger',
  RV: 'Rechter Verteidiger',
  AB: 'Abwehr',
  DM: 'Defensives Mittelfeld',
  ZM: 'Zentrales Mittelfeld',
  OM: 'Offensives Mittelfeld',
  LM: 'Linkes Mittelfeld',
  RM: 'Rechtes Mittelfeld',
  MF: 'Mittelfeld',
  LA: 'Linksaußen',
  RA: 'Rechtsaußen',
  ST: 'Stürmer',
};

// "Familienangehörige" wird als Eintrag angezeigt, gilt aber farblich als
// beraterlos (grün) — wie "kein Beratereintrag"
function isBeraterlos(name: string | null, company: string | null): boolean {
  const d = agentDisplayName(name, company);
  return !d || d.toLowerCase().includes('familienangehörige');
}

function openProfile(url: string | null) {
  if (!url) return;
  if (Platform.OS === 'web') {
    window.open(url, '_blank');
  } else {
    Linking.openURL(url);
  }
}

export function PlayerDetailModal({
  player,
  onClose,
  actions,
  onOpenEvaluation,
  onCreateReport,
  onStatusChanged,
}: {
  player: StipendiumSearchPlayer;
  onClose: () => void;
  actions?: React.ReactNode;
  /** Klick auf einen Bericht (öffnet die Spielbewertung) — optional */
  onOpenEvaluation?: (ev: MatchEvaluation) => void;
  /** Neuen Bericht ohne Spiel anlegen (Betreff statt Partie) — bekommt fertige
   *  Navigations-Params für den PlayerEvaluation-Screen */
  onCreateReport?: (navParams: Record<string, any>) => void;
  /** Nach Änderung des Scouting-Status (Watchlist/Top-Ziel/Uninteressant) — optional */
  onStatusChanged?: (status: ScoutStatus) => void;
}) {
  // Mobil: Karten dürfen nicht breiter als der Bildschirm sein (sonst ragt z. B. das
  // Berichte-Plus über den Rand), Vertrag + Potential bleiben aber ein Paar
  const { width: windowWidth } = useWindowDimensions();
  const isMobile = windowWidth < 768;
  const [tmDetails, setTmDetails] = useState<PlayerTmDetails | null>(null);
  const [tmLoading, setTmLoading] = useState(false);
  // Scouting-Berichte zu diesem Spieler
  const [matchEvals, setMatchEvals] = useState<MatchEvaluation[]>([]);
  const [evalsLoading, setEvalsLoading] = useState(false);
  // Generierte Einschätzung (aus den Berichten, am Spieler gespeichert)
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  // Bewertung/Notiz aus dem Watchlist-System (berater_player_evaluations / berater_watchlist)
  const [wlRating, setWlRating] = useState<number | null>(null);
  // Scouting-Status (neutral/watchlist/top_ziel/uninteressant)
  const [scoutStatus, setScoutStatusState] = useState<ScoutStatus>('neutral');
  const [statusSaving, setStatusSaving] = useState(false);
  // Offene Nachfrage vor Entfernen/Wechsel eines gesetzten Status
  const [pendingChange, setPendingChange] = useState<{ next: ScoutStatus; text: string } | null>(null);
  // Neuer Bericht ohne Spiel: Betreff-Abfrage
  const [newReportOpen, setNewReportOpen] = useState(false);
  const [newReportBetreff, setNewReportBetreff] = useState('');
  // Glocke: Abo auf Beraterstatus-Änderungen
  const [alertOn, setAlertOn] = useState(false);
  const [alertSaving, setAlertSaving] = useState(false);
  // Aufklappbarer Beraterverlauf in der Vertrag-Karte
  const [verlaufOpen, setVerlaufOpen] = useState(false);
  const [verlaufLoading, setVerlaufLoading] = useState(false);
  const [verlauf, setVerlauf] = useState<BeraterChange[] | null>(null);

  // TM-Links der früheren Agenturen (Agenturname -> agent_url)
  const [verlaufUrls, setVerlaufUrls] = useState<Map<string, string>>(new Map());

  const toggleVerlauf = () => {
    const next = !verlaufOpen;
    setVerlaufOpen(next);
    if (next && verlauf === null && !verlaufLoading) {
      setVerlaufLoading(true);
      loadPlayerHistory(player.id)
        .then(async (hist) => {
          setVerlauf(hist);
          // Agentur-URL über irgendeinen aktuellen Spieler derselben Agentur finden
          const keys = new Set<string>();
          for (const c of hist) {
            // nur echte Agenturen nachschlagen (Platzhalter wie "kein Beratereintrag" nicht)
            if (!agentDisplayName(c.previous_agent_name, c.previous_agent_company)) continue;
            const k = c.previous_agent_company || c.previous_agent_name;
            if (k) keys.add(k);
          }
          const urls = new Map<string, string>();
          await Promise.all(
            [...keys].map(async (k) => {
              let r = await supabase
                .from('berater_players')
                .select('agent_url')
                .eq('current_agent_company', k)
                .not('agent_url', 'is', null)
                .limit(1);
              if (!r.data?.length) {
                r = await supabase
                  .from('berater_players')
                  .select('agent_url')
                  .eq('current_agent_name', k)
                  .not('agent_url', 'is', null)
                  .limit(1);
              }
              const url = (r.data?.[0] as any)?.agent_url;
              if (url) urls.set(k, url);
            })
          );
          setVerlaufUrls(urls);
        })
        .finally(() => setVerlaufLoading(false));
    }
  };

  // Offene Nachfrage vor dem Ausschalten der Glocke
  const [pendingAlertOff, setPendingAlertOff] = useState(false);

  const applyAlert = async (next: boolean) => {
    if (alertSaving) return;
    setAlertSaving(true);
    const ok = await setAlertSubscription(player.id, next);
    if (ok) setAlertOn(next);
    setAlertSaving(false);
  };

  const handleAlertPress = () => {
    if (alertSaving) return;
    // Ausschalten nur nach Nachfrage
    if (alertOn) setPendingAlertOff(true);
    else applyAlert(true);
  };

  const STATUS_LABELS: Record<Exclude<ScoutStatus, 'neutral'>, string> = {
    uninteressant: 'Uninteressant',
    watchlist: 'Watchlist',
    top_ziel: 'Zielspieler',
  };

  const applyStatus = async (next: ScoutStatus) => {
    setStatusSaving(true);
    const ok = await setScoutStatus(player.id, next);
    if (ok) {
      setScoutStatusState(next);
      onStatusChanged?.(next);
    }
    setStatusSaving(false);
  };

  const handleStatusPress = (key: Exclude<ScoutStatus, 'neutral'>) => {
    if (statusSaving) return;
    const isActive = scoutStatus === key;
    const next: ScoutStatus = isActive ? 'neutral' : key;
    // Ein gesetzter Status wird nur nach Nachfrage entfernt oder gewechselt
    if (scoutStatus !== 'neutral') {
      const cur = STATUS_LABELS[scoutStatus as Exclude<ScoutStatus, 'neutral'>];
      const text = next === 'neutral'
        ? `„${cur}" wirklich entfernen?`
        : `Wirklich von „${cur}" zu „${STATUS_LABELS[next as Exclude<ScoutStatus, 'neutral'>]}" wechseln?`;
      setPendingChange({ next, text });
      return;
    }
    applyStatus(next);
  };

  const renderStatusBtn = (b: { key: Exclude<ScoutStatus, 'neutral'>; idle: string; active: string; bg: string; fg: string }) => {
    const isActive = scoutStatus === b.key;
    return (
      <TouchableOpacity
        key={b.key}
        style={[styles.statusBtn, HARD_SHADOW, isActive && { backgroundColor: b.bg }]}
        disabled={statusSaving}
        activeOpacity={0.7}
        onPress={() => handleStatusPress(b.key)}
      >
        <Text style={[styles.statusBtnText, isActive && { color: b.fg }]}>
          {isActive ? b.active : b.idle}
        </Text>
      </TouchableOpacity>
    );
  };
  // Notizen + Erstkontakt (pro Spieler gespeichert)
  const [notes, setNotes] = useState('');
  const [firstContact, setFirstContact] = useState(''); // ISO "YYYY-MM-DD"
  const savedNote = useRef({ notes: '', firstContact: '' });
  // Wer hat den Spieler ins Sportstipendium aufgenommen (falls dort vorhanden)
  const [addedBy, setAddedBy] = useState<string | null>(null);

  useEffect(() => {
    setTmDetails(null);
    if (player.tm_player_id) {
      setTmLoading(true);
      fetchPlayerTmDetails(player.tm_player_id).then((d) => {
        setTmDetails(d);
        setTmLoading(false);
      });
    }
  }, [player.tm_player_id]);

  useEffect(() => {
    // Notizen: player_notes ist führend; falls leer, Watchlist-/Status-Notiz übernehmen
    // (die Systeme stammen aus verschiedenen Bauphasen und werden beim Speichern synchron gehalten)
    setWlRating(null);
    setScoutStatusState('neutral');
    setVerlaufOpen(false);
    setVerlauf(null);
    setVerlaufUrls(new Map());
    setAlertOn(false);
    isAlertSubscribed(player.id).then(setAlertOn);
    (async () => {
      const [n, evalRow, wlRow] = await Promise.all([
        loadPlayerNote(player.id),
        supabase.from('berater_player_evaluations').select('notes, rating, status').eq('player_id', player.id).maybeSingle(),
        supabase.from('berater_watchlist').select('notes, rating').eq('player_id', player.id).maybeSingle(),
      ]);
      const evalData = evalRow?.data as { notes: string | null; rating: number | null; status: string | null } | null;
      const wlData = wlRow?.data as { notes: string | null; rating: number | null } | null;
      const mergedNotes = n.notes || evalData?.notes || wlData?.notes || '';
      setNotes(mergedNotes);
      setFirstContact(n.first_contact_date || '');
      savedNote.current = { notes: n.notes || '', firstContact: n.first_contact_date || '' };
      setWlRating(evalData?.rating ?? wlData?.rating ?? null);
      setScoutStatusState(deriveScoutStatus(!!wlData, evalData?.status));
    })();
    setAddedBy(null);
    if (player.tm_player_id) {
      fetchEntryAddedBy(player.tm_player_id).then(setAddedBy);
    }
    // Gespeicherte Einschätzung laden (Spalte existiert erst nach Migration — Fehler still schlucken)
    setSummary(null);
    supabase
      .from('berater_players')
      .select('scout_summary')
      .eq('id', player.id)
      .maybeSingle()
      .then(({ data }) => setSummary((data as any)?.scout_summary ?? null));
    // Scouting-Berichte laden (feste Verknüpfung bevorzugt, sonst URL/Name)
    setMatchEvals([]);
    setEvalsLoading(true);
    loadMatchEvaluationsForPlayer(player.player_name, player.tm_profile_url, player.id)
      .then(setMatchEvals)
      .finally(() => setEvalsLoading(false));
  }, [player.id]);

  // Speichern, sobald sich etwas geändert hat (Notizen bei Verlassen des Felds,
  // Datum direkt bei Auswahl)
  const persistNote = (nextNotes: string, nextContact: string) => {
    if (nextNotes === savedNote.current.notes && nextContact === savedNote.current.firstContact) return;
    savedNote.current = { notes: nextNotes, firstContact: nextContact };
    const text = nextNotes.trim() || null;
    savePlayerNote(player.id, {
      notes: text,
      first_contact_date: nextContact || null,
    });
    // Watchlist-Notizen synchron halten (nur bestehende Einträge aktualisieren)
    supabase.from('berater_player_evaluations').update({ notes: text }).eq('player_id', player.id).then(() => {});
    supabase.from('berater_watchlist').update({ notes: text }).eq('player_id', player.id).then(() => {});
  };

  // Einschätzung aus den Berichten generieren und am Spieler speichern
  const generateSummary = async () => {
    if (matchEvals.length === 0 || summaryLoading) return;
    setSummaryLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('player-einschaetzung', {
        body: {
          playerName: player.player_name,
          club: player.club_name,
          position: player.position ? (POSITION_FULL[player.position] || player.position) : null,
          reports: matchEvals.map((ev) => ({
            matchDate: ev.match_date,
            matchName: ev.match_name,
            ageGroup: ev.age_group,
            rating: ev.overall_rating,
            notes: ev.notes,
            bodyStructure: ev.body_structure,
            speedAthleticism: ev.speed_athleticism,
          })),
        },
      });
      if (!error && data?.success && data.text) {
        setSummary(data.text);
        // Speichern ist optional (Spalte kommt per Migration) — Fehler nicht anzeigen
        await supabase
          .from('berater_players')
          .update({ scout_summary: data.text, scout_summary_at: new Date().toISOString() })
          .eq('id', player.id);
      }
    } catch { /* Anzeige bleibt beim alten Stand */ }
    setSummaryLoading(false);
  };

  const p = player;
  // Kein TM-Verein? Dann die Mannschaft aus den Berichten anzeigen (höchste
  // Altersklasse gewinnt, dann neuester Bericht) — wie in Watchlist/Alle Berichte
  const reportClub = (() => {
    if (p.club_name || p.is_vereinslos) return null;
    const ts = (d: string | null): number => {
      if (!d) return 0;
      if (/^\d{4}-\d{2}-\d{2}/.test(d)) return new Date(d.slice(0, 10)).getTime();
      const m = d.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
      if (!m) return 0;
      let y = parseInt(m[3], 10);
      if (y < 100) y += 2000;
      return new Date(y, parseInt(m[2], 10) - 1, parseInt(m[1], 10)).getTime();
    };
    let best: { name: string; ag: string | null; rank: number; t: number } | null = null;
    for (const e of matchEvals) {
      if (!e.current_club) continue;
      const rank = agRank(e.age_group || null);
      const t = ts(e.match_date);
      if (!best || rank > best.rank || (rank === best.rank && t > best.t)) {
        best = { name: e.current_club, ag: e.age_group || null, rank, t };
      }
    }
    return best ? teamLabel(best.name, best.ag) : null;
  })();
  const contract = formatContract(p.contract_until);
  const vereinslosTransfer = tmDetails?.transfers?.find(
    (t) => t.to && /vereinslos|ohne verein|career break/i.test(t.to)
  );
  const lastClubSeason = p.is_vereinslos ? seasonOfDate(vereinslosTransfer?.date || null) : null;

  // Zeile innerhalb einer Karte: Label links, Wert rechts (fett)
  const cardRow = (label: string, value: React.ReactNode, last = false) => (
    <View style={[styles.cardRow, last && { borderBottomWidth: 0 }]}>
      <Text style={styles.cardRowLabel}>{label}</Text>
      {typeof value === 'string' ? (
        <Text style={styles.cardRowValue} numberOfLines={1}>{value}</Text>
      ) : (
        value
      )}
    </View>
  );

  // Karten-Chip (gelb bzw. grün) auf der Oberkante der Karte
  const cardChip = (title: string, green = false) => (
    <View style={[styles.cardChip, green && styles.cardChipGreen]}>
      <Text style={styles.cardChipText}>{title}</Text>
    </View>
  );

  // Bericht ohne Spiel anlegen: Betreff ersetzt die Partie, Datum = heute
  const handleCreateReport = () => {
    const betreff = newReportBetreff.trim();
    if (!betreff || !onCreateReport) return;
    const parts = player.player_name.trim().split(/\s+/);
    const last = parts.length > 1 ? parts[parts.length - 1] : player.player_name.trim();
    const first = parts.length > 1 ? parts.slice(0, -1).join(' ') : '';
    const t = new Date();
    const today = `${String(t.getDate()).padStart(2, '0')}.${String(t.getMonth() + 1).padStart(2, '0')}.${t.getFullYear()}`;
    setNewReportOpen(false);
    setNewReportBetreff('');
    onCreateReport({
      matchName: betreff,
      matchDate: today,
      playerName: `${last}, ${first}`,
      playerPosition: player.position || null,
      playerBirthDate: player.birth_date,
      playerClub: player.club_name,
      agentName: agentDisplayName(player.current_agent_name, player.current_agent_company),
      transfermarktUrl: player.tm_profile_url,
      beraterPlayerId: player.id,
    });
  };

  // Potential: neuester Bericht mit Bewertung, sonst Bewertung aus dem Watchlist-System
  const latestRating = (matchEvals.find((e) => e.overall_rating)?.overall_rating ?? null) || wlRating;

  // Farbe wie im Potential-Schiebebalken (RatingBar), Grün etwas heller
  const potentialColor = (v: number | null): string => {
    if (!v) return '#9a968e';
    if (v === 10) return '#F0C040';
    if (v >= 7) return '#22c55e';
    if (v >= 4) return '#e8930c';
    return '#dc2626';
  };

  // Beim Schließen offene Änderungen sichern
  const handleClose = () => {
    persistNote(notes, firstContact);
    onClose();
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={handleClose}>
      <TouchableWithoutFeedback onPress={handleClose}>
        <View style={styles.detailOverlay}>
          <TouchableWithoutFeedback>
            <View style={[styles.detailModal, HARD_SHADOW_LG]}>
              {/* Namens-Balken (gelb): Name · SPIELERPROFIL (auf Namens-Grundlinie) · ✕ */}
              <View style={[styles.detailNameBar, HARD_SHADOW]}>
                <View style={styles.detailNameWrap}>
                  <Text style={styles.detailName} numberOfLines={1}>
                    {(() => {
                      const n = splitName(p.player_name);
                      return n.first ? `${n.last}, ${n.first}` : n.last;
                    })()}
                  </Text>
                  <Text style={styles.profileTag}>SPIELERPROFIL</Text>
                </View>
                <TouchableOpacity onPress={handleClose} hitSlop={8}>
                  <Ionicons name="close" size={20} color={RETRO.text} />
                </TouchableOpacity>
              </View>
              <ScrollView style={styles.detailScroll} showsVerticalScrollIndicator={false}>
              <View style={{ height: 10 }} />

              {/* Zeile 1: Allgemeines · Verein · Vertrag (zIndex: Beraterverlauf-Dropdown liegt über Zeile 2) */}
              <View style={[styles.cardGrid, { zIndex: 30 }]}>
                <View style={[styles.card, HARD_SHADOW]}>
                  {cardChip('ALLGEMEINES')}
                  {cardRow('Position', p.position ? (POSITION_FULL[p.position] || p.position) : '—')}
                  {cardRow(
                    'Alter',
                    (() => {
                      const short = p.birth_date?.replace(/\.(\d{2})(\d{2})$/, '.$2');
                      if (p.age !== null) return `${p.age} J.${short ? ` (${short})` : ''}`;
                      return short || '—';
                    })()
                  )}
                  {cardRow(
                    'Transfermarktprofil',
                    p.tm_profile_url ? (
                      <TouchableOpacity onPress={() => openProfile(p.tm_profile_url)} hitSlop={6}>
                        <Image source={require('../../assets/tm-icon.png')} style={styles.tmIconSmall} />
                      </TouchableOpacity>
                    ) : '—',
                    true
                  )}
                </View>
                <View style={[styles.card, HARD_SHADOW]}>
                  {cardChip('VEREIN')}
                  {cardRow(
                    'Verein',
                    <View style={styles.detailClubValue}>
                      {/* bei Vereinslosen kein Wappen des alten Vereins */}
                      {!p.is_vereinslos && p.club_tm_id ? (
                        <Image
                          source={{ uri: `https://tmssl.akamaized.net/images/wappen/head/${p.club_tm_id}.png` }}
                          style={styles.detailClubLogo}
                          resizeMode="contain"
                        />
                      ) : null}
                      <Text style={styles.detailClubText} numberOfLines={1}>
                        {p.is_vereinslos
                          ? `vereinslos${p.club_name ? ` (zuletzt ${p.club_name}${lastClubSeason ? `, ${lastClubSeason}` : ''})` : ''}`
                          : p.club_name || reportClub || '—'}
                      </Text>
                    </View>
                  )}
                  {cardRow('Liga', p.is_vereinslos ? '—' : p.league_name || '—')}
                  {/* Aktueller Nationalspieler: Mannschaft + Länderflagge (aus TM-Details) */}
                  {cardRow(
                    'Nationalspieler',
                    tmDetails?.nationalTeam ? (
                      <View style={styles.detailClubValue}>
                        {/* Emoji-Flagge (gleicher Typ wie im Land-Dropdown), sonst TM-PNG */}
                        {flagForNationalTeam(tmDetails.nationalTeam.name) ? (
                          <Text style={styles.natFlagEmoji}>{flagForNationalTeam(tmDetails.nationalTeam.name)}</Text>
                        ) : tmDetails.nationalTeam.countryId ? (
                          <Image
                            source={{ uri: tmFlagUrl(tmDetails.nationalTeam.countryId) }}
                            style={styles.natFlag}
                            resizeMode="contain"
                          />
                        ) : null}
                        <Text style={styles.detailClubText} numberOfLines={1}>
                          {tmDetails.nationalTeam.name}
                        </Text>
                      </View>
                    ) : '—',
                    true
                  )}
                </View>
                {/* VERTRAG + POTENTIAL immer nebeneinander (auch mobil), wie im Bewertungs-Screen */}
                <View style={[styles.vertragPotentialGroup, isMobile && { minWidth: 0, flexBasis: '100%' }]}>
                <View style={[styles.card, HARD_SHADOW, { zIndex: 30, flex: 1, minWidth: 0 }]}>
                  {cardChip('VERTRAG')}
                  {cardRow('Vertrag bis', contract || '—')}
                  {cardRow('Marktwert', p.market_value || '—')}
                  {/* Berater-Zeile: Klick klappt den Beraterverlauf auf */}
                  <View style={{ zIndex: 40 }}>
                    {cardRow(
                      'Berater',
                      <TouchableOpacity style={styles.agentValue} onPress={toggleVerlauf} activeOpacity={0.7} hitSlop={4}>
                        <Text
                          style={[
                            styles.cardRowValue,
                            isBeraterlos(p.current_agent_name, p.current_agent_company) && { color: '#15803d' },
                          ]}
                          numberOfLines={1}
                        >
                          {agentDisplayName(p.current_agent_name, p.current_agent_company) || 'kein Beratereintrag'}
                        </Text>
                        {p.agent_url && agentDisplayName(p.current_agent_name, p.current_agent_company) ? (
                          <TouchableOpacity onPress={() => openProfile(p.agent_url)} hitSlop={6}>
                            <Image source={require('../../assets/tm-icon.png')} style={styles.tmIconSmall} />
                          </TouchableOpacity>
                        ) : null}
                        <Text style={styles.verlaufChevron}>{verlaufOpen ? '▾' : '▸'}</Text>
                      </TouchableOpacity>,
                      true
                    )}
                    {verlaufOpen && (
                      <View style={[styles.verlaufDropdown, HARD_SHADOW_LG]}>
                        <View style={styles.verlaufHeader}>
                          <Text style={styles.verlaufHeaderText}>BERATERVERLAUF</Text>
                        </View>
                        {verlaufLoading || verlauf === null ? (
                          <ActivityIndicator size="small" color={RETRO.headerBg} style={{ margin: 10 }} />
                        ) : (
                          <>
                            {/* Aktuelle Phase */}
                            <View style={[styles.verlaufRow, styles.verlaufRowCurrent]}>
                              <View style={styles.verlaufAgentRow}>
                                <Text
                                  style={[
                                    styles.verlaufAgent,
                                    isBeraterlos(p.current_agent_name, p.current_agent_company) && { color: '#15803d' },
                                  ]}
                                  numberOfLines={1}
                                >
                                  {agentDisplayName(p.current_agent_name, p.current_agent_company) || 'kein Beratereintrag'}
                                </Text>
                                {p.agent_url && agentDisplayName(p.current_agent_name, p.current_agent_company) ? (
                                  <TouchableOpacity onPress={() => openProfile(p.agent_url)} hitSlop={6}>
                                    <Image source={require('../../assets/tm-icon.png')} style={styles.verlaufTmIcon} />
                                  </TouchableOpacity>
                                ) : null}
                              </View>
                              <Text style={styles.verlaufMeta}>
                                {verlauf[0] ? `seit ${formatDateDE(verlauf[0].detected_at)}` : 'aktuell'}
                              </Text>
                            </View>
                            {/* Frühere Phasen (neueste zuerst) */}
                            {verlauf.map((change, index) => {
                              const start = verlauf[index + 1]?.detected_at || null;
                              const agentKey = change.previous_agent_company || change.previous_agent_name;
                              const hasRealAgent = !!agentDisplayName(change.previous_agent_name, change.previous_agent_company);
                              const agentUrl = hasRealAgent && agentKey ? verlaufUrls.get(agentKey) : undefined;
                              return (
                                <View
                                  key={change.id}
                                  style={[styles.verlaufRow, index === verlauf.length - 1 && { borderBottomWidth: 0 }]}
                                >
                                  <View style={styles.verlaufAgentRow}>
                                    <Text style={styles.verlaufAgent} numberOfLines={1}>
                                      {agentDisplayName(change.previous_agent_name, change.previous_agent_company) || 'kein Beratereintrag'}
                                    </Text>
                                    {agentUrl ? (
                                      <TouchableOpacity onPress={() => openProfile(agentUrl)} hitSlop={6}>
                                        <Image source={require('../../assets/tm-icon.png')} style={styles.verlaufTmIcon} />
                                      </TouchableOpacity>
                                    ) : null}
                                  </View>
                                  <Text style={styles.verlaufMeta}>
                                    {start
                                      ? `${formatDateDE(start)} - ${formatDateDE(change.detected_at)} · ${formatDurationBetween(start, change.detected_at)}`
                                      : `bis ${formatDateDE(change.detected_at)}`}
                                  </Text>
                                </View>
                              );
                            })}
                            {verlauf.length === 0 && (
                              <Text style={[styles.verlaufMeta, { padding: 10 }]}>Keine Wechsel erfasst</Text>
                            )}
                          </>
                        )}
                      </View>
                    )}
                  </View>
                </View>
                <View style={[styles.card, styles.cardPotential, HARD_SHADOW, { backgroundColor: potentialColor(latestRating) }]}>
                  {cardChip('POTENTIAL')}
                  <Text style={styles.potentialBoxText}>{latestRating ?? '—'}</Text>
                  {(() => {
                    const ratings = matchEvals.map((e) => e.overall_rating).filter(Boolean) as number[];
                    if (ratings.length < 2) return null;
                    const avg = (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1).replace('.', ',');
                    return (
                      <Text style={styles.potentialSub}>
                        {`Ø ${avg} · ${ratings.length} Berichte`}
                      </Text>
                    );
                  })()}
                  {/* Top-Ziel automatisch ab Potential 8 */}
                  {latestRating != null && latestRating >= 8 && (
                    <View style={styles.potTopZielBadge}>
                      <Text style={styles.potTopZielBadgeText}>TOP-ZIEL</Text>
                    </View>
                  )}
                </View>
                </View>
              </View>

              {/* Zeile 2: Einsätze · Berichte */}
              <View style={styles.cardGrid}>
                <View style={[styles.card, styles.cardEinsaetze, HARD_SHADOW, isMobile && { minWidth: 0, flexBasis: '100%' }]}>
                  {cardChip('EINSÄTZE')}
                  {cardRow(
                    `Saison ${tmDetails ? seasonLabel(tmDetails.seasonYear) : 'aktuell'}`,
                    tmLoading ? (
                      <ActivityIndicator size="small" color={RETRO.headerBg} />
                    ) : (
                      seasonStatsText(tmDetails?.statsCurrentSeason, tmDetails?.gamesCurrentSeason)
                    )
                  )}
                  {cardRow(
                    `Saison ${tmDetails ? seasonLabel(tmDetails.seasonYear - 1) : 'letzte'}`,
                    tmLoading ? ' ' : seasonStatsText(tmDetails?.statsLastSeason, tmDetails?.gamesLastSeason),
                    true
                  )}
                </View>
                <View style={[styles.card, styles.cardBerichte, HARD_SHADOW, isMobile && { minWidth: 0, flexBasis: '100%' }]}>
                  {cardChip(`BERICHTE${matchEvals.length > 0 ? ` (${matchEvals.length})` : ''}`)}
                  {onCreateReport && (
                    <TouchableOpacity
                      style={[styles.reportAddBtn, HARD_SHADOW]}
                      onPress={() => setNewReportOpen(true)}
                      activeOpacity={0.7}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    >
                      <Ionicons name="add" size={13} color="#ffffff" />
                    </TouchableOpacity>
                  )}
                  {evalsLoading ? (
                    <ActivityIndicator size="small" color={RETRO.headerBg} style={{ alignSelf: 'flex-start', margin: 4 }} />
                  ) : matchEvals.length === 0 ? (
                    <Text style={styles.reportEmpty}>Noch keine Berichte</Text>
                  ) : (
                    <ScrollView style={styles.reportScroll} nestedScrollEnabled>
                    {matchEvals.map((ev, idx) => (
                      <TouchableOpacity
                        key={ev.id}
                        style={[styles.reportRow, idx === matchEvals.length - 1 && { borderBottomWidth: 0 }]}
                        disabled={!onOpenEvaluation}
                        onPress={() => onOpenEvaluation?.(ev)}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.reportDate} numberOfLines={1}>{ev.match_date || '—'}</Text>
                        <Text style={styles.reportMatch} numberOfLines={1}>
                          {ev.match_name || 'Spiel unbekannt'}
                          {[ev.age_group, ev.match_type].filter(Boolean).length > 0 && (
                            <Text style={styles.reportMeta}>
                              {' · ' + [ev.age_group, ev.match_type].filter(Boolean).join(' · ')}
                            </Text>
                          )}
                        </Text>
                        {ev.overall_rating ? (
                          <View style={[styles.reportRatingBadge, { backgroundColor: potentialColor(ev.overall_rating) }]}>
                            <Text style={styles.reportRatingText}>{ev.overall_rating}</Text>
                          </View>
                        ) : null}
                        {onOpenEvaluation ? (
                          <Ionicons name="chevron-forward" size={14} color={RETRO.shadowDark} />
                        ) : null}
                      </TouchableOpacity>
                    ))}
                    </ScrollView>
                  )}
                </View>
              </View>

              {/* Zeile 3: Einschätzung (generiert) + Notizen */}
              <View style={styles.cardGrid}>
                <View style={[styles.card, styles.cardWide, HARD_SHADOW]}>
                  {cardChip('EINSCHÄTZUNG')}
                  {summaryLoading ? (
                    <ActivityIndicator size="small" color={RETRO.headerBg} style={{ alignSelf: 'flex-start', margin: 6 }} />
                  ) : summary ? (
                    <Text style={styles.summaryText}>{summary}</Text>
                  ) : (
                    <Text style={styles.reportEmpty}>
                      {matchEvals.length > 0
                        ? 'Noch keine Einschätzung generiert'
                        : 'Noch keine Berichte vorhanden'}
                    </Text>
                  )}
                  <TouchableOpacity
                    style={[styles.summaryButton, HARD_SHADOW, (summaryLoading || matchEvals.length === 0) && { opacity: 0.5 }]}
                    onPress={generateSummary}
                    disabled={summaryLoading || matchEvals.length === 0}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.summaryButtonText}>
                      {summary ? 'Aktualisieren' : 'Einschätzung erstellen'}
                    </Text>
                  </TouchableOpacity>
                </View>
                <View style={[styles.card, HARD_SHADOW]}>
                  {cardChip('NOTIZEN')}
                  <TextInput
                    style={styles.notesInput}
                    placeholder="Notizen zum Spieler ..."
                    placeholderTextColor={'#8a867e'}
                    value={notes}
                    onChangeText={setNotes}
                    onBlur={() => persistNote(notes, firstContact)}
                    multiline
                  />
                </View>
              </View>

              {/* Fußzeile: links Scouting-Status (exklusiv), rechts Aktionen des Aufrufers */}
              <View style={styles.detailFooter}>
                {/* Links: Uninteressant + Aufrufer-Aktionen (z.B. + Sportstipendium) */}
                <View style={styles.statusGroup}>
                  {renderStatusBtn({ key: 'uninteressant', idle: 'Uninteressant', active: 'aussortiert', bg: '#dc2626', fg: '#ffffff' })}
                  {actions ? <View style={styles.detailActions}>{actions}</View> : null}
                </View>
                {/* Rechts: Glocke + Watchlist + Zielspieler (Status-Key bleibt top_ziel) */}
                <View style={styles.statusGroup}>
                  <TouchableOpacity
                    style={[styles.statusBtn, HARD_SHADOW, alertOn && { backgroundColor: '#dc2626' }]}
                    disabled={alertSaving}
                    activeOpacity={0.7}
                    onPress={handleAlertPress}
                  >
                    <Ionicons
                      name={alertOn ? 'notifications' : 'notifications-outline'}
                      size={14}
                      color={alertOn ? '#ffffff' : RETRO.text}
                    />
                  </TouchableOpacity>
                  {renderStatusBtn({ key: 'watchlist', idle: 'Watchlist', active: 'Watchlist', bg: '#22c55e', fg: '#ffffff' })}
                  {renderStatusBtn({ key: 'top_ziel', idle: 'Zielspieler', active: 'Zielspieler', bg: '#22c55e', fg: '#ffffff' })}
                </View>
              </View>

              {/* Nachfrage vor dem Ausschalten der Glocke */}
              {pendingAlertOff && (
                <Modal visible transparent animationType="fade" onRequestClose={() => setPendingAlertOff(false)}>
                  <View style={styles.confirmOverlay}>
                    <View style={[styles.confirmBox, HARD_SHADOW_LG]}>
                      <View style={[styles.confirmBar, HARD_SHADOW]}>
                        <Text style={styles.confirmTitle}>Benachrichtigung</Text>
                      </View>
                      <Text style={styles.confirmText}>
                        Benachrichtigungen bei Beraterstatus-Änderung für diesen Spieler wirklich ausschalten?
                      </Text>
                      <View style={styles.confirmActions}>
                        <TouchableOpacity
                          style={[styles.statusBtn, HARD_SHADOW]}
                          onPress={() => setPendingAlertOff(false)}
                          activeOpacity={0.7}
                        >
                          <Text style={styles.statusBtnText}>Abbrechen</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.statusBtn, HARD_SHADOW, { backgroundColor: '#dc2626' }]}
                          onPress={() => {
                            setPendingAlertOff(false);
                            applyAlert(false);
                          }}
                          activeOpacity={0.7}
                        >
                          <Text style={[styles.statusBtnText, { color: '#ffffff' }]}>Ausschalten</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                </Modal>
              )}

              {/* Nachfrage vor dem Entfernen/Wechseln eines gesetzten Status */}
              {newReportOpen && (
                <Modal visible transparent animationType="fade" onRequestClose={() => setNewReportOpen(false)}>
                  <View style={styles.confirmOverlay}>
                    <View style={[styles.confirmBox, HARD_SHADOW_LG]}>
                      <View style={[styles.confirmBar, HARD_SHADOW]}>
                        <Text style={styles.confirmTitle}>Neuer Bericht</Text>
                      </View>
                      <Text style={styles.confirmText}>
                        Bericht ohne Spiel anlegen. Der Betreff steht dann anstelle der Partie.
                      </Text>
                      <TextInput
                        style={styles.betreffInput}
                        value={newReportBetreff}
                        onChangeText={setNewReportBetreff}
                        placeholder="Betreff, z.B. Videoanalyse"
                        placeholderTextColor="#8a867e"
                        autoFocus
                        onSubmitEditing={handleCreateReport}
                      />
                      <View style={styles.confirmActions}>
                        <TouchableOpacity
                          style={[styles.statusBtn, HARD_SHADOW]}
                          onPress={() => { setNewReportOpen(false); setNewReportBetreff(''); }}
                          activeOpacity={0.7}
                        >
                          <Text style={styles.statusBtnText}>Abbrechen</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.statusBtn, HARD_SHADOW, { backgroundColor: '#1a5f2a' }, !newReportBetreff.trim() && { opacity: 0.5 }]}
                          onPress={handleCreateReport}
                          disabled={!newReportBetreff.trim()}
                          activeOpacity={0.7}
                        >
                          <Text style={[styles.statusBtnText, { color: '#ffffff' }]}>Anlegen</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                </Modal>
              )}
              {pendingChange && (
                <Modal visible transparent animationType="fade" onRequestClose={() => setPendingChange(null)}>
                  <View style={styles.confirmOverlay}>
                    <View style={[styles.confirmBox, HARD_SHADOW_LG]}>
                      <View style={[styles.confirmBar, HARD_SHADOW]}>
                        <Text style={styles.confirmTitle}>Status ändern</Text>
                      </View>
                      <Text style={styles.confirmText}>{pendingChange.text}</Text>
                      <View style={styles.confirmActions}>
                        <TouchableOpacity
                          style={[styles.statusBtn, HARD_SHADOW]}
                          onPress={() => setPendingChange(null)}
                          activeOpacity={0.7}
                        >
                          <Text style={styles.statusBtnText}>Abbrechen</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.statusBtn, HARD_SHADOW, { backgroundColor: '#1a5f2a' }]}
                          onPress={() => {
                            const next = pendingChange.next;
                            setPendingChange(null);
                            applyStatus(next);
                          }}
                          activeOpacity={0.7}
                        >
                          <Text style={[styles.statusBtnText, { color: '#ffffff' }]}>Bestätigen</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                </Modal>
              )}
              </ScrollView>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  detailOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  detailModal: {
    // Gleiche Fenstergröße wie der Bewertungs-Screen (PlayerEvaluationScreen)
    width: '95%',
    maxWidth: 1200,
    maxHeight: '92%',
    borderWidth: 1,
    borderColor: RETRO.shadowDark,
    borderRadius: 2,
    padding: 16,
    backgroundColor: 'rgba(238, 234, 226, 0.97)',
  },
  // Kopfpanel wie im Bewertungs-Screen: weiß, 2 Zeilen, Mono-Labels
  headerPanel: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#c6c2ba',
    borderRadius: 2,
    padding: 12,
    marginBottom: 4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
  },
  headerRow2: {
    borderTopWidth: 1,
    borderTopColor: RETRO.shadowDark,
    marginTop: 10,
    paddingTop: 10,
  },
  headerCell: {
    flex: 1,
    minWidth: 130,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerCellWide: {
    flex: 1.4,
    minWidth: 150,
  },
  headerDivider: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: '#c6c2ba',
  },
  headerLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1,
    fontFamily: MONO,
    lineHeight: 18,
    color: '#4a4a55',
  },
  headerValue: {
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
    color: RETRO.text,
    flexShrink: 1,
  },
  // Berichte-Liste
  reportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#c6c2ba',
  },
  reportScroll: {
    // 3 Zeilen (à ~33px) sichtbar, ab dem 4. Bericht wird in der Karte gescrollt
    maxHeight: 100,
  },
  reportAddBtn: {
    position: 'absolute',
    top: -10,
    right: 10,
    width: 18,
    height: 18,
    backgroundColor: RETRO.headerBg, // Retro-Blau wie der Karten-Chip
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  betreffInput: {
    marginHorizontal: 14,
    marginBottom: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: RETRO.shadowDark,
    borderRadius: 2,
    fontSize: 13,
    color: RETRO.text,
  },
  reportDate: {
    fontSize: 11,
    fontWeight: '600',
    color: '#4a4a55',
    minWidth: 78,
  },
  reportMatch: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: RETRO.text,
  },
  reportMeta: {
    fontSize: 11,
    fontWeight: '600',
    color: '#4a4a55',
  },
  reportRatingBadge: {
    minWidth: 24,
    height: 20,
    paddingHorizontal: 4,
    backgroundColor: '#2b3f96',
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reportRatingText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#ffffff',
  },
  reportEmpty: {
    fontSize: 13,
    color: '#8a867e',
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  detailScroll: {
    flexGrow: 0,
  },
  detailNameBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: RETRO.yellow,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginBottom: 6,
    gap: 8,
  },
  // Name + Tag auf gemeinsamer Grundlinie, ✕ bleibt vertikal zentriert
  detailNameWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  detailName: {
    fontSize: 16,
    fontWeight: '700',
    color: RETRO.text,
    flexShrink: 1,
  },
  tmIcon: {
    width: 22,
    height: 22,
    borderRadius: 4,
    marginRight: 4,
  },
  detailClubValue: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  detailClubLogo: {
    width: 20,
    height: 20,
  },
  // Länderflagge (breiter als hoch, wie TM sie liefert)
  natFlag: {
    width: 20,
    height: 13,
  },
  natFlagEmoji: {
    fontSize: 14,
  },
  // gleiche Schrift wie die übrigen Kartenwerte (z.B. Position)
  detailClubText: {
    fontSize: 13,
    fontWeight: '700',
    color: RETRO.text,
    textAlign: 'right',
    flexShrink: 1,
  },
  // "SPIELERPROFIL"-Tag im gelben Balken
  profileTag: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 2,
    fontFamily: MONO,
    color: '#4a4a55',
    marginLeft: 14,
  },
  // Karten-Raster
  cardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    marginBottom: 14,
  },
  card: {
    flex: 1,
    minWidth: 240,
    backgroundColor: '#ffffff',
    borderRadius: 2,
    paddingHorizontal: 12,
    paddingTop: 16,
    paddingBottom: 6,
  },
  cardWide: {
    flex: 2,
    minWidth: 320,
  },
  // Einsätze endet auf Höhe der Mitte der Verein-Karte (Zeile 1 = 3 gleiche Karten + 110px
  // Potential). Basis-Differenz muss 110 sein; da border-box die Basis aufs Padding (24)
  // floort, braucht Berichte 134 gegen die 0->24 der Einsätze-Karte.
  cardEinsaetze: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
  },
  cardBerichte: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 134,
    minWidth: 320,
  },
  // Vertrag + Potential als Paar (bricht als Ganzes um; Vertrag so breit wie die
  // anderen Karten: 240 + 14 Lücke + 110 Potential)
  vertragPotentialGroup: {
    // Basis = Lücke + Potential-Breite, Rest wächst wie die anderen Karten →
    // Vertrag-Karte exakt so breit wie ALLGEMEINES/VEREIN
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 124,
    minWidth: 364,
    flexDirection: 'row',
    gap: 14,
    zIndex: 30,
  },
  // Schmale Potential-Karte (ganz rechts in Zeile 1)
  cardPotential: {
    flex: 0,
    minWidth: 110,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 12,
  },
  potentialBoxText: {
    fontSize: 56,
    fontWeight: '800',
    color: '#ffffff',
    lineHeight: 62,
  },
  tmIconSmall: {
    width: 20,
    height: 20,
    borderRadius: 3,
  },
  summaryText: {
    fontSize: 13,
    lineHeight: 19,
    color: RETRO.text,
    paddingVertical: 4,
  },
  summaryButton: {
    alignSelf: 'flex-end',
    backgroundColor: 'rgba(230, 226, 218, 0.80)',
    borderRadius: 0,
    paddingVertical: 5,
    paddingHorizontal: 10,
    marginTop: 8,
    marginBottom: 4,
  },
  summaryButtonText: {
    fontSize: 11,
    fontWeight: '600',
    color: RETRO.text,
  },
  potentialSub: {
    fontSize: 10,
    fontWeight: '600',
    color: '#ffffff',
    opacity: 0.9,
    marginTop: 2,
  },
  // Top-Ziel: automatisches gelbes Badge unter der Potential-Zahl (ab 8)
  potTopZielBadge: {
    backgroundColor: '#F0C040',
    borderRadius: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 5,
    ...HARD_SHADOW,
  },
  potTopZielBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: '#14141e',
  },
  agentValue: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  cardChip: {
    position: 'absolute',
    top: -10,
    left: 10,
    backgroundColor: RETRO.headerBg, // Retro-Blau wie die Listen-Header
    borderRadius: 2,
    paddingHorizontal: 8,
    paddingVertical: 2,
    ...HARD_SHADOW,
  },
  cardChipGreen: {
    backgroundColor: '#2f7d36',
  },
  cardChipText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    fontFamily: MONO,
    color: '#ffffff',
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#e2ded6',
  },
  cardRowLabel: {
    fontSize: 13,
    color: '#4a4a55',
  },
  cardRowValue: {
    fontSize: 13,
    fontWeight: '700',
    color: RETRO.text,
    flexShrink: 1,
    textAlign: 'right',
  },
  notesInput: {
    // randlos — die Karte selbst ist das Eingabefeld
    flex: 1,
    paddingHorizontal: 2,
    paddingVertical: 6,
    fontSize: 13,
    lineHeight: 19,
    color: RETRO.text,
    minHeight: 72,
    textAlignVertical: 'top',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  // Aufklappbarer Beraterverlauf (Dropdown unter der Berater-Zeile)
  verlaufChevron: {
    fontSize: 14,
    color: '#4a4a55',
    marginLeft: 4,
  },
  verlaufDropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    backgroundColor: '#ffffff',
    borderRadius: 2,
    zIndex: 100,
  },
  verlaufHeader: {
    backgroundColor: '#14141e',
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  verlaufHeaderText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    fontFamily: MONO,
    color: RETRO.yellow,
  },
  verlaufRow: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e1d8',
    gap: 2,
  },
  verlaufRowCurrent: {
    backgroundColor: '#f7f0da',
  },
  verlaufAgentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  verlaufAgent: {
    fontSize: 13,
    fontWeight: '700',
    color: RETRO.text,
    flexShrink: 1,
  },
  verlaufTmIcon: {
    width: 16,
    height: 16,
    borderRadius: 2,
  },
  verlaufMeta: {
    fontSize: 10,
    fontFamily: MONO,
    color: '#4a4a55',
  },
  detailFooter: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 12,
    // Luft für den Versatz-Schatten, sonst schneidet der Scroll-Container ihn ab
    paddingBottom: 8,
    paddingRight: 6,
  },
  statusGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  // Statusbutton auf Papier-Hintergrund: weiße Fläche (Retro-Regel), aktiv farbig
  // Standard-Buttongröße der App (wie "Aktualisieren"): kompakt 5/10, Schrift 11/600
  statusBtn: {
    backgroundColor: '#ffffff',
    borderRadius: 0,
    paddingHorizontal: 10,
    paddingVertical: 5,
    minHeight: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: RETRO.text,
  },
  detailActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 8,
  },
  // Nachfrage-Dialog (Status entfernen/wechseln)
  confirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  confirmBox: {
    backgroundColor: '#e9e5dd',
    borderRadius: 2,
    width: 380,
    maxWidth: '92%',
    paddingBottom: 14,
  },
  confirmBar: {
    backgroundColor: RETRO.yellow,
    paddingVertical: 9,
    paddingHorizontal: 14,
    margin: 10,
    marginBottom: 4,
  },
  confirmTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: RETRO.text,
  },
  confirmText: {
    fontSize: 14,
    color: RETRO.text,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  confirmActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    paddingHorizontal: 14,
  },
});
