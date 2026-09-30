// Login/Registrierung der Scouting-App im gleichen 19b-Layout wie die KMH-App
// (Entwurf claude.ai/artifact/WkyeALcK5S3N9gXHSPhvuY). Alle Schritte laufen in diesem
// Screen (die Scouting-App hat vor dem Login keinen eigenen Stack):
// Login -> Einladungscode -> Registrieren -> Code aus der Mail
// Login -> Passwort vergessen -> Code -> Neues Passwort
import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Modal, Pressable, Platform, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../config/supabase';
import { useIsMobile } from '../../hooks/useIsMobile';
import {
  PD, FONT, usePlayerDarkFont, AuthBrand, AuthBlock, AuthCard, AuthField, AuthCodeField,
  AuthButton, AuthGhostButton, AuthLink, AuthError, AuthInfo,
} from '../../components/AuthUI';

type Mode = 'login' | 'register' | 'verify' | 'forgot' | 'recoveryCode' | 'newPassword';

const codeErrorText = (msg: string) => /expired|invalid/i.test(msg)
  ? 'Der Code ist falsch oder abgelaufen. Prüfe die Eingabe oder fordere einen neuen Code an.'
  : msg;

export function LoginScreen() {
  const { signIn, signUpWithInvitation, verifySignupCode, resendSignupCode, requestPasswordReset, verifyRecoveryCode, finishRecovery, cancelRecovery } = useAuth();
  const isMobile = useIsMobile();
  usePlayerDarkFont();

  const [mode, setMode] = useState<Mode>('login');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Login
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Einladungscode-Dialog
  const [showCodeModal, setShowCodeModal] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [codeLoading, setCodeLoading] = useState(false);

  // Registrierung
  const [verifiedCode, setVerifiedCode] = useState('');
  const [regFirst, setRegFirst] = useState('');
  const [regLast, setRegLast] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirm, setRegConfirm] = useState('');

  // Code aus der Mail / Passwort vergessen
  const [codeEmail, setCodeEmail] = useState('');
  const [mailCode, setMailCode] = useState('');
  const [resent, setResent] = useState(false);
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');

  const go = (m: Mode) => { setError(null); setMode(m); };
  const toLogin = () => { setMailCode(''); setResent(false); go('login'); };

  const handleLogin = async () => {
    setError(null);
    if (!email || !password) { setError('Bitte E-Mail und Passwort eingeben.'); return; }
    setLoading(true);
    const { error: err } = await signIn(email.trim(), password);
    setLoading(false);
    if (!err) return;
    if (/email not confirmed/i.test(err.message)) {
      // Konto existiert, E-Mail noch nicht bestätigt -> neuen Code schicken, Code-Eingabe öffnen
      await resendSignupCode(email.trim());
      setCodeEmail(email.trim()); setMailCode(''); go('verify');
      return;
    }
    setError(/invalid login credentials/i.test(err.message) ? 'E-Mail oder Passwort ist falsch.' : err.message);
  };

  // Einladungs-Code prüfen: gültig + Scouting-Zugang -> Registrierung
  const handleInviteCode = async () => {
    if (!inviteCode.trim()) { setCodeError('Bitte gib einen Einladungscode ein.'); return; }
    setCodeLoading(true);
    const code = inviteCode.trim();
    const { data: inv } = await supabase.rpc('verify_staff_invitation', { p_code: code });
    setCodeLoading(false);
    if (!inv) { setCodeError('Der eingegebene Einladungscode ist ungültig.'); return; }
    if (!inv.access_scouting) { setCodeError('Dieser Code gilt nicht für die Scouting-App.'); return; }
    setVerifiedCode(code);
    setRegFirst(inv.first_name || '');
    setRegLast(inv.last_name || '');
    setRegEmail(inv.email || '');
    setShowCodeModal(false);
    go('register');
  };

  const handleRegister = async () => {
    setError(null);
    if (!regFirst.trim() || !regLast.trim() || !regEmail.trim() || !regPassword || !regConfirm) { setError('Bitte alle Felder ausfüllen.'); return; }
    if (regPassword.length < 6) { setError('Das Passwort muss mindestens 6 Zeichen lang sein.'); return; }
    if (regPassword !== regConfirm) { setError('Die Passwörter stimmen nicht überein.'); return; }
    setLoading(true);
    const { error: err, needsConfirmation } = await signUpWithInvitation(regEmail.trim(), regPassword, regFirst.trim(), regLast.trim(), verifiedCode);
    setLoading(false);
    if (err) {
      setError(/sending confirmation email/i.test(err.message) ? 'Die Bestätigungs-Mail konnte nicht verschickt werden. Bitte versuche es später erneut.' : err.message);
      return;
    }
    setRegPassword(''); setRegConfirm('');
    if (needsConfirmation) { setCodeEmail(regEmail.trim()); setMailCode(''); setResent(false); go('verify'); return; }
    setEmail(regEmail.trim()); setPassword(''); go('login');
  };

  const handleVerify = async () => {
    setError(null);
    if (mailCode.length !== 6) { setError('Bitte gib den 6-stelligen Code aus der E-Mail ein.'); return; }
    setLoading(true);
    const { error: err } = mode === 'verify' ? await verifySignupCode(codeEmail, mailCode) : await verifyRecoveryCode(codeEmail, mailCode);
    setLoading(false);
    if (err) { setError(codeErrorText(err.message)); return; }
    if (mode === 'recoveryCode') { setNewPw(''); setNewPw2(''); go('newPassword'); }
    // verify: Session steht, der Navigator wechselt in die App.
  };

  const handleResend = async () => {
    setError(null);
    const { error: err } = mode === 'verify' ? await resendSignupCode(codeEmail) : await requestPasswordReset(codeEmail);
    if (err) { setError(/rate limit|security purposes/i.test(err.message) ? 'Bitte warte kurz, bevor du einen neuen Code anforderst.' : 'Der Code konnte nicht gesendet werden.'); return; }
    setResent(true); setMailCode('');
  };

  const handleForgot = async () => {
    setError(null);
    const e = codeEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { setError('Bitte gib eine gültige E-Mail-Adresse ein.'); return; }
    setLoading(true);
    const { error: err } = await requestPasswordReset(e);
    setLoading(false);
    if (err) { setError(/rate limit|security purposes/i.test(err.message) ? 'Bitte warte kurz, bevor du es erneut versuchst.' : 'Die E-Mail konnte nicht gesendet werden. Bitte versuche es später erneut.'); return; }
    setMailCode(''); setResent(false); go('recoveryCode');
  };

  const handleNewPassword = async () => {
    setError(null);
    if (newPw.length < 6) { setError('Das Passwort muss mindestens 6 Zeichen lang sein.'); return; }
    if (newPw !== newPw2) { setError('Die Passwörter stimmen nicht überein.'); return; }
    setLoading(true);
    const { error: err } = await finishRecovery(newPw);
    setLoading(false);
    if (err) setError(/same password|different from the old/i.test(err.message) ? 'Das neue Passwort darf nicht dem alten entsprechen.' : err.message);
  };

  // --- Schritte nach dem Login (eigene Seite mit Logo + Block) ---
  if (mode === 'register') {
    const pair = (a: React.ReactNode, b: React.ReactNode) => isMobile ? <>{a}{b}</> : (
      <View style={{ flexDirection: 'row', gap: 12 }}><View style={{ flex: 1 }}>{a}</View><View style={{ flex: 1 }}>{b}</View></View>
    );
    return (
      <AuthCard title="Registrieren" subtitle={isMobile ? undefined : 'Dein Scouting-Zugang'} width={480} onClose={toLogin}
        footer={<><View style={{ flex: 1 }} /><AuthButton label="Konto erstellen" onPress={handleRegister} loading={loading} full={false} /></>}>
        {pair(
          <AuthField label="Vorname" value={regFirst} onValue={(t) => { setRegFirst(t); setError(null); }} autoCapitalize="words" />,
          <AuthField label="Nachname" value={regLast} onValue={(t) => { setRegLast(t); setError(null); }} autoCapitalize="words" />,
        )}
        <AuthField label="E-Mail" value={regEmail} onValue={(t) => { setRegEmail(t); setError(null); }} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} placeholder="name@beispiel.de" />
        {pair(
          <AuthField label="Passwort" value={regPassword} onValue={(t) => { setRegPassword(t); setError(null); }} secure />,
          <AuthField label="Passwort bestätigen" value={regConfirm} onValue={(t) => { setRegConfirm(t); setError(null); }} secure onSubmitEditing={handleRegister} />,
        )}
        <AuthInfo small text="Mindestens 6 Zeichen. Danach schicken wir dir einen Bestätigungscode per E-Mail." />
        <AuthError text={error} />
      </AuthCard>
    );
  }

  if (mode === 'verify' || mode === 'recoveryCode') {
    const signup = mode === 'verify';
    return (
      <AuthCard title={signup ? 'Fast geschafft' : 'Code eingeben'} onClose={toLogin}
        footer={
          <>
            <AuthLink label={resent ? 'Neuer Code gesendet' : 'Code erneut senden'} onPress={handleResend} />
            {!signup ? <AuthLink label="Andere Adresse" onPress={() => go('forgot')} /> : null}
            <View style={{ flex: 1 }} />
            <AuthButton label="Bestätigen" onPress={handleVerify} loading={loading} disabled={mailCode.length !== 6} full={false} />
          </>
        }>
        <AuthInfo text={signup
          ? `Wir haben dir einen 6-stelligen Code an ${codeEmail} geschickt. Gib ihn hier ein, dann ist dein Zugang aktiv. Der Code ist 1 Stunde gültig.`
          : `Wenn es zu ${codeEmail} einen Zugang gibt, haben wir dir einen 6-stelligen Code geschickt. Gib ihn hier ein und wähle danach dein neues Passwort. Der Code ist 1 Stunde gültig.`} />
        <AuthCodeField value={mailCode} onValue={(t) => { setMailCode(t); setError(null); }} onSubmit={handleVerify} />
        <AuthError text={error} />
      </AuthCard>
    );
  }

  if (mode === 'forgot') {
    return (
      <AuthCard title="Passwort vergessen" onClose={toLogin}
        footer={<><View style={{ flex: 1 }} /><AuthButton label="Code senden" onPress={handleForgot} loading={loading} full={false} /></>}>
        <AuthInfo text="Gib die E-Mail-Adresse ein, mit der du dich registriert hast. Wir schicken dir einen Code zum Zurücksetzen." />
        <AuthField label="E-Mail" value={codeEmail} onValue={(t) => { setCodeEmail(t); setError(null); }} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} onSubmitEditing={handleForgot} autoFocus placeholder="name@beispiel.de" />
        <AuthError text={error} />
      </AuthCard>
    );
  }

  if (mode === 'newPassword') {
    return (
      <AuthCard title="Neues Passwort" subtitle={codeEmail ? `für ${codeEmail}` : undefined}
        footer={
          <>
            <AuthLink label="Abbrechen" onPress={async () => { await cancelRecovery(); toLogin(); }} />
            <View style={{ flex: 1 }} />
            <AuthButton label="Passwort speichern" onPress={handleNewPassword} loading={loading} full={false} />
          </>
        }>
        <AuthField label="Neues Passwort" value={newPw} onValue={(t) => { setNewPw(t); setError(null); }} secure autoFocus />
        <AuthField label="Passwort bestätigen" value={newPw2} onValue={(t) => { setNewPw2(t); setError(null); }} secure onSubmitEditing={handleNewPassword} />
        <AuthInfo small text="Mindestens 6 Zeichen." />
        <AuthError text={error} />
      </AuthCard>
    );
  }

  // --- Login ---
  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={[styles.scroll, isMobile && { paddingHorizontal: 16 }]} keyboardShouldPersistTaps="handled">
        <View style={{ width: '100%', maxWidth: 420, gap: isMobile ? 26 : 32 }}>
          <AuthBrand large />

          <AuthBlock title="Anmelden" subtitle="Scouting">
            <AuthField label="E-Mail" value={email} onValue={(t) => { setEmail(t); setError(null); }} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} placeholder="name@beispiel.de" />
            <AuthField label="Passwort" value={password} onValue={(t) => { setPassword(t); setError(null); }} secure onSubmitEditing={handleLogin} />
            <AuthError text={error} />
            <AuthButton label="Anmelden" onPress={handleLogin} loading={loading} />
            <AuthLink label="Passwort vergessen?" onPress={() => { setCodeEmail(email.trim()); go('forgot'); }} />
          </AuthBlock>

          {/* Gleiche Breite wie der Anmelden-Button: Innenabstand des Blocks (mobil 18, Desktop 20 + 1 Rahmen) */}
          <View style={{ alignItems: 'center', gap: 12, paddingHorizontal: isMobile ? 18 : 21 }}>
            <Text style={styles.label}>Noch kein Zugang?</Text>
            <View style={{ alignSelf: 'stretch' }}>
              <AuthGhostButton accent label="Mit Einladungscode registrieren" onPress={() => { setShowCodeModal(true); setCodeError(null); setInviteCode(''); }} />
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Einladungscode-Dialog, mittig auf Desktop und mobil */}
      <Modal visible={showCodeModal} transparent animationType="fade" onRequestClose={() => setShowCodeModal(false)}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setShowCodeModal(false)} />
          <View style={{ width: '100%', maxWidth: 440 }}>
            <AuthBlock
              title="Scouting-Zugang"
              onClose={() => setShowCodeModal(false)}
              footer={<><View style={{ flex: 1 }} /><AuthButton label="Weiter" onPress={handleInviteCode} loading={codeLoading} full={false} /></>}
            >
              <AuthInfo text="Gib den Einladungscode aus deiner Einladung ein." />
              <View style={{ gap: 6 }}>
                <Text style={styles.label}>Einladungscode</Text>
                <TextInput
                  style={[styles.codeInput, codeError ? { borderColor: PD.danger } : null]}
                  value={inviteCode}
                  onChangeText={(t) => { setInviteCode(t); setCodeError(null); }}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  autoFocus
                  onSubmitEditing={handleInviteCode}
                />
              </View>
              <AuthError text={codeError} />
            </AuthBlock>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: PD.bg },
  scroll: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 32, paddingHorizontal: 24 },
  label: { fontFamily: FONT, fontSize: 12.5, color: PD.muted },
  backdrop: { flex: 1, backgroundColor: 'rgba(14,15,14,0.78)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  codeInput: {
    height: 52, backgroundColor: PD.bg, borderWidth: 1, borderColor: PD.btnBorder, color: PD.text,
    fontFamily: FONT, fontSize: 20, fontWeight: '600', letterSpacing: 4, textAlign: 'center', paddingHorizontal: 12,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
});
