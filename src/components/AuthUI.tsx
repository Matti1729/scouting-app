// Login-Bausteine im 19b-Stil – 1:1 aus der KMH-App (src/screens/auth/AuthCard.tsx) übernommen,
// damit Login/Registrierung in beiden Apps gleich aussehen (Matti 2026-09-30).
// Farben/Schrift der KMH-Spieleransicht (19b) sind hier lokal hinterlegt.
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Platform, Image, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useIsMobile } from '../hooks/useIsMobile';

export const PD = {
  bg: '#0E0F0E', text: '#EDEBE5', muted: '#8C8F89', muted2: '#A8ABA4', line2: '#232523',
  btnBorder: '#3A3D39', accent: '#57C17E', photoText: '#6A6D68', danger: '#ef4444',
} as const;
export const FONT = Platform.select({ web: "Archivo, 'Helvetica Neue', Helvetica, Arial, sans-serif", default: undefined }) as string | undefined;
const ls = (em: number, fontSize: number) => Math.round(em * fontSize * 100) / 100;
export function usePlayerDarkFont() {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    if (document.getElementById('kmh-font-archivo')) return;
    const link = document.createElement('link');
    link.id = 'kmh-font-archivo';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&display=swap';
    document.head.appendChild(link);
  }, []);
}

const WORDMARK = require('../../assets/kmh-logo-wordmark-light.png');
const WORDMARK_RATIO = 1073 / 92;
const SURFACE = '#131413';
const WEB_NO_OUTLINE = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {};

// KMH-Schriftzug + "× PM SPORTMANAGEMENT"
export function AuthBrand({ large }: { large?: boolean }) {
  const mobile = useIsMobile();
  const w = mobile ? (large ? 340 : 320) : (large ? 520 : 420);
  return (
    <View style={{ alignItems: 'center', gap: large ? 16 : 12 }}>
      <Image source={WORDMARK} style={{ width: w, maxWidth: '100%', height: w / WORDMARK_RATIO }} resizeMode="contain" accessibilityLabel="Karl Michael Herzog Sportmanagement" />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, width: large && !mobile ? 240 : 190 }}>
        <View style={s.brandLine} />
        <Text style={s.brandX}>×</Text>
        <View style={s.brandLine} />
      </View>
      <Text style={[s.brandPm, large && !mobile && { fontSize: 11 }]}>PM SPORTMANAGEMENT</Text>
    </View>
  );
}

// Seite mit Logo oben und Block (Titelleiste, Inhalt, optional Fußzeile) darunter.
export function AuthCard({ title, subtitle, onClose, children, footer, width = 440, brandLarge }: {
  title: string; subtitle?: string; onClose?: () => void; children: React.ReactNode; footer?: React.ReactNode; width?: number; brandLarge?: boolean;
}) {
  usePlayerDarkFont();
  const mobile = useIsMobile();
  return (
    <SafeAreaView style={s.page}>
      <ScrollView contentContainerStyle={[s.scroll, mobile && { paddingHorizontal: 16 }]} keyboardShouldPersistTaps="handled">
        <View style={{ width: '100%', maxWidth: width, gap: mobile ? 22 : 28 }}>
          <AuthBrand large={brandLarge} />
          <AuthBlock title={title} subtitle={subtitle} onClose={onClose} footer={footer}>{children}</AuthBlock>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// Der Block selbst (auch für Dialoge auf dem Login nutzbar).
export function AuthBlock({ title, subtitle, onClose, children, footer }: {
  title: string; subtitle?: string; onClose?: () => void; children: React.ReactNode; footer?: React.ReactNode;
}) {
  const mobile = useIsMobile();
  return (
    <View style={[s.block, mobile && { borderWidth: 0 }]}>
      <View style={[s.head, mobile && { paddingHorizontal: 18, paddingVertical: 12 }]}>
        <Text style={s.headTitle}>{title.toUpperCase()}</Text>
        {subtitle ? <Text style={s.headSub} numberOfLines={1}>{subtitle}</Text> : null}
        <View style={{ flex: 1 }} />
        {onClose ? (
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Schließen" style={{ paddingLeft: 10 }}>
            <Ionicons name="close" size={18} color={PD.muted} />
          </Pressable>
        ) : null}
      </View>
      <View style={[s.body, mobile && { paddingHorizontal: 18, paddingVertical: 16 }]}>{children}</View>
      {footer ? <View style={[s.foot, mobile && s.mFoot]}>{footer}</View> : null}
    </View>
  );
}

// Eingabefeld mit Beschriftung darüber. secure = Passwortfeld mit Augensymbol.
export function AuthField({ label, value, onValue, secure, style, ...extra }: { label: string; value: string; onValue: (t: string) => void; secure?: boolean } & React.ComponentProps<typeof TextInput>) {
  const mobile = useIsMobile();
  const [show, setShow] = useState(false);
  const h = mobile ? 46 : 42;
  return (
    <View style={[s.field, style as any]}>
      <Text style={s.label}>{label}</Text>
      <View style={{ justifyContent: 'center' }}>
        <TextInput
          style={[s.input, { height: h, fontSize: mobile ? 16 : 14 }, secure && { paddingRight: h + 2 }]}
          value={value}
          onChangeText={onValue}
          placeholderTextColor={PD.photoText}
          secureTextEntry={!!secure && !show}
          {...(secure ? { autoCorrect: false, autoCapitalize: 'none' as const } : {})}
          {...extra}
        />
        {secure ? (
          <Pressable
            onPress={() => setShow((v) => !v)}
            accessibilityLabel={show ? 'Passwort verbergen' : 'Passwort anzeigen'}
            style={[s.eye, { width: h, height: h }]}
          >
            <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={mobile ? 20 : 18} color={show ? PD.accent : PD.muted} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

// 6-stelliger Code aus der Mail (nur Ziffern, groß und gesperrt).
export function AuthCodeField({ value, onValue, onSubmit, label = 'Code aus der E-Mail' }: { value: string; onValue: (t: string) => void; onSubmit?: () => void; label?: string }) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        style={[s.input, s.codeInput]}
        value={value}
        onChangeText={(t) => onValue(t.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        inputMode="numeric"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={6}
        placeholder="000000"
        placeholderTextColor={PD.btnBorder}
        onSubmitEditing={onSubmit}
        autoFocus
      />
    </View>
  );
}

// Hauptbutton (grün). full = volle Breite (im Inhalt), sonst kompakt (Fußzeile).
export function AuthButton({ label, onPress, loading, disabled, full = true }: { label: string; onPress: () => void; loading?: boolean; disabled?: boolean; full?: boolean }) {
  const mobile = useIsMobile();
  return (
    <Pressable
      onPress={onPress}
      disabled={loading || disabled}
      style={[s.btnPri, { height: mobile ? 44 : 40 }, full ? { alignSelf: 'stretch', marginTop: 4 } : mobile ? { alignSelf: 'stretch' } : null, (loading || disabled) && { opacity: 0.55 }]}
    >
      {loading ? <ActivityIndicator color={PD.bg} /> : <Text style={[s.btnPriText, mobile && { fontSize: 14 }]}>{label}</Text>}
    </Pressable>
  );
}

// Umrandeter Button. accent = grüner Rahmen/Schrift (z. B. "Als Spieler registrieren").
export function AuthGhostButton({ label, onPress, accent, grow }: { label: string; onPress: () => void; accent?: boolean; grow?: boolean }) {
  const mobile = useIsMobile();
  return (
    // Mobil volle Breite wie der Hauptbutton (Fußzeile stapelt untereinander), Desktop optional nebeneinander wachsend
    <Pressable onPress={onPress} style={[s.btnGhost, { height: mobile ? 44 : 40 }, accent && { borderColor: PD.accent }, mobile ? { alignSelf: 'stretch' } : grow && { flex: 1 }]}>
      <Text style={[s.btnGhostText, mobile && { fontSize: 14 }, accent && { color: PD.accent }]}>{label}</Text>
    </Pressable>
  );
}

export function AuthLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={s.link} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
      <Text style={s.linkText}>{label}</Text>
    </Pressable>
  );
}

export function AuthError({ text }: { text: string | null }) {
  return text ? <Text style={s.errorText}>{text}</Text> : null;
}

export function AuthInfo({ text, small }: { text: string; small?: boolean }) {
  const mobile = useIsMobile();
  return <Text style={[small ? s.hint : s.info, !small && mobile && { fontSize: 14 }]}>{text}</Text>;
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: PD.bg },
  scroll: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 32, paddingHorizontal: 24 },
  brandLine: { flex: 1, height: 1, backgroundColor: PD.btnBorder },
  brandX: { fontFamily: FONT, fontSize: 12, color: PD.muted },
  brandPm: { fontFamily: FONT, fontSize: 10.5, fontWeight: '600', letterSpacing: ls(0.16, 10.5), color: PD.muted },
  block: { backgroundColor: SURFACE, borderWidth: 1, borderColor: PD.btnBorder, width: '100%' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: PD.line2 },
  headTitle: { fontFamily: FONT, fontSize: 11, fontWeight: '700', letterSpacing: ls(0.16, 11), color: PD.accent },
  headSub: { fontFamily: FONT, fontSize: 12, color: PD.muted, flexShrink: 1 },
  body: { paddingHorizontal: 20, paddingVertical: 20, gap: 14 },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 18, borderTopWidth: 1, borderTopColor: PD.line2 },
  // Mobil: Buttons untereinander in voller Breite, Hauptbutton (zuletzt übergeben) oben
  mFoot: { paddingHorizontal: 18, paddingBottom: 20, flexDirection: 'column-reverse', alignItems: 'stretch' },
  field: { gap: 6 },
  label: { fontFamily: FONT, fontSize: 12.5, color: PD.muted },
  input: { backgroundColor: PD.bg, borderWidth: 1, borderColor: PD.btnBorder, color: PD.text, fontFamily: FONT, paddingHorizontal: 12, ...WEB_NO_OUTLINE },
  eye: { position: 'absolute', right: 0, top: 0, alignItems: 'center', justifyContent: 'center' },
  codeInput: { height: 60, fontSize: 28, fontWeight: '600', letterSpacing: 10, textAlign: 'center' },
  btnPri: { backgroundColor: PD.accent, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  btnPriText: { fontFamily: FONT, fontSize: 13.5, fontWeight: '600', color: PD.bg },
  btnGhost: { borderWidth: 1, borderColor: PD.btnBorder, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  btnGhostText: { fontFamily: FONT, fontSize: 13.5, fontWeight: '600', color: PD.text },
  link: { alignSelf: 'center', paddingVertical: 4 },
  linkText: { fontFamily: FONT, fontSize: 13, color: PD.muted, textDecorationLine: 'underline' },
  errorText: { fontFamily: FONT, fontSize: 12.5, lineHeight: 18, color: PD.danger },
  info: { fontFamily: FONT, fontSize: 13.5, lineHeight: 20, color: PD.muted2 },
  hint: { fontFamily: FONT, fontSize: 12.5, lineHeight: 18, color: PD.muted },
});
