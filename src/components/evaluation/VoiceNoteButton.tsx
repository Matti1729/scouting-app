import React, { useEffect, useRef, useState } from 'react';
import { Platform, Text, TouchableOpacity, View, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../config/supabase';
import { RETRO, HARD_SHADOW, RETRO_BTN } from '../../theme/retro';

// Sprachnotiz: nimmt im Browser über das Mikrofon auf (MediaRecorder), schickt die Aufnahme an die
// Edge Function "transcribe" (Groq Whisper) und liefert den erkannten Text zurück.
// Auf Native (ohne MediaRecorder) wird der Button nicht angezeigt.

interface Props {
  onText: (text: string) => void;
  style?: any;
  textStyle?: any;
  maxSeconds?: number;
}

type Phase = 'idle' | 'recording' | 'transcribing' | 'error';

const supported = Platform.OS === 'web' && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof (globalThis as any).MediaRecorder !== 'undefined';

export function VoiceNoteButton({ onText, style, textStyle, maxSeconds = 120 }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<any>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<any>(null);

  useEffect(() => () => { stopStream(); if (timerRef.current) clearInterval(timerRef.current); }, []);

  const stopStream = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  };

  const start = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const MR = (globalThis as any).MediaRecorder;
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(m => MR.isTypeSupported?.(m)) || '';
      const rec = new MR(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e: any) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stopStream();
        if (timerRef.current) clearInterval(timerRef.current);
        const type = rec.mimeType || mime || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        if (blob.size < 1000) { setPhase('idle'); setError('Aufnahme zu kurz'); return; }
        await transcribe(blob, type);
      };
      recRef.current = rec;
      rec.start(250);
      setSeconds(0);
      setPhase('recording');
      timerRef.current = setInterval(() => {
        setSeconds(s => {
          if (s + 1 >= maxSeconds) { stop(); }
          return s + 1;
        });
      }, 1000);
    } catch (e: any) {
      setPhase('error');
      setError(e?.name === 'NotAllowedError' ? 'Mikrofon nicht erlaubt' : (e?.message || 'Aufnahme nicht möglich'));
    }
  };

  const stop = () => {
    const rec = recRef.current;
    if (rec && rec.state !== 'inactive') {
      setPhase('transcribing');
      rec.stop();
    }
  };

  const transcribe = async (blob: Blob, type: string) => {
    try {
      const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
      const form = new FormData();
      form.append('file', blob, `sprachnotiz.${ext}`);
      form.append('language', 'de');
      const { data, error: fnError } = await supabase.functions.invoke('transcribe', { body: form });
      if (fnError) throw fnError;
      if (!data?.success) throw new Error(data?.error || 'Transkription fehlgeschlagen');
      const text = String(data.text || '').trim();
      if (!text) { setError('Nichts erkannt'); setPhase('idle'); return; }
      onText(text);
      setPhase('idle');
    } catch (e: any) {
      setPhase('error');
      setError(e?.message || 'Transkription fehlgeschlagen');
    }
  };

  if (!supported) return null;

  const mmss = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const iconColor = phase === 'recording' ? '#fff' : RETRO.text;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <TouchableOpacity
        onPress={phase === 'recording' ? stop : phase === 'transcribing' ? undefined : start}
        disabled={phase === 'transcribing'}
        accessibilityLabel={phase === 'recording' ? 'Aufnahme stoppen' : 'Sprachnotiz aufnehmen'}
        style={[RETRO_BTN, HARD_SHADOW, style, local.iconBtn, phase === 'recording' && local.recording]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          {phase === 'transcribing'
            ? <ActivityIndicator size="small" color={RETRO.text} />
            : <Ionicons name={phase === 'recording' ? 'stop' : 'mic'} size={14} color={iconColor} />}
          {phase === 'recording' && <Text style={[textStyle, { color: '#fff' }]}>{mmss}</Text>}
        </View>
      </TouchableOpacity>
      {phase === 'error' && !!error && <Text style={[textStyle, { color: '#c0392b' }]} numberOfLines={1}>{error}</Text>}
    </View>
  );
}

const local = StyleSheet.create({
  iconBtn: { paddingHorizontal: 10, minWidth: 36, alignItems: 'center', justifyContent: 'center' },
  recording: { backgroundColor: '#c0392b' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },
});
