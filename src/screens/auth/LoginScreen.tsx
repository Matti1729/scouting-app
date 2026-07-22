import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, Platform, ActivityIndicator, Modal, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { supabase } from '../../config/supabase';

const showAlert = (title: string, message: string) => {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message, [{ text: 'OK' }]);
  }
};

export function LoginScreen() {
  const { signIn, signUpWithInvitation } = useAuth();
  const { colors } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  // Einladungs-Code-Modal (identisch zum KMH-Ablauf)
  const [showCodeModal, setShowCodeModal] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [codeLoading, setCodeLoading] = useState(false);

  // Registrierungs-Formular (nach gültigem Code)
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [verifiedCode, setVerifiedCode] = useState('');
  const [regFirst, setRegFirst] = useState('');
  const [regLast, setRegLast] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirm, setRegConfirm] = useState('');
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [regLoading, setRegLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      showAlert('Fehler', 'Bitte alle Felder ausfüllen');
      return;
    }
    setLoading(true);
    const { error } = await signIn(email, password);
    setLoading(false);
    if (error) showAlert('Fehler', error.message);
  };

  // Einladungs-Code prüfen: gültig + Scouting-Zugang → zur Registrierung.
  const handleInviteCode = async () => {
    if (!inviteCode.trim()) {
      setCodeError('Bitte gib einen Einladungscode ein.');
      return;
    }
    setCodeLoading(true);
    const code = inviteCode.trim();
    const { data: inv } = await supabase.rpc('verify_staff_invitation', { p_code: code });
    setCodeLoading(false);

    if (!inv) {
      setCodeError('Der eingegebene Einladungscode ist ungültig.');
      return;
    }
    if (!inv.access_scouting) {
      setCodeError('Dieser Code gilt nicht für die Scouting-App.');
      return;
    }
    setVerifiedCode(code);
    setRegFirst(inv.first_name || '');
    setRegLast(inv.last_name || '');
    setRegEmail(inv.email || '');
    setShowCodeModal(false);
    setMode('register');
  };

  const handleRegister = async () => {
    if (!regFirst || !regLast || !regEmail || !regPassword || !regConfirm) {
      showAlert('Fehler', 'Bitte alle Felder ausfüllen');
      return;
    }
    if (regPassword.length < 6) {
      showAlert('Fehler', 'Das Passwort muss mindestens 6 Zeichen haben');
      return;
    }
    if (regPassword !== regConfirm) {
      showAlert('Fehler', 'Die Passwörter stimmen nicht überein');
      return;
    }
    setRegLoading(true);
    const { error } = await signUpWithInvitation(regEmail, regPassword, `${regFirst} ${regLast}`, verifiedCode);
    setRegLoading(false);
    if (error) {
      showAlert('Fehler', error.message);
      return;
    }
    setMode('login');
    setEmail(regEmail);
    setPassword('');
    setRegPassword(''); setRegConfirm('');
    showAlert('Registrierung erfolgreich!', 'Dein Konto wurde erstellt. Du kannst dich jetzt anmelden.');
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.content, { backgroundColor: colors.background }]}>
        <Text style={[styles.title, { color: colors.text }]}>Karl M. Herzog</Text>
        <Text style={[styles.titleSecond, { color: colors.text }]}>Sportmanagement</Text>

        {mode === 'login' ? (
          <>
            <TextInput
              style={[styles.input, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder, color: colors.text }]}
              placeholder="E-Mail"
              placeholderTextColor={colors.textSecondary}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <TextInput
              style={[styles.input, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder, color: colors.text }]}
              placeholder="Passwort"
              placeholderTextColor={colors.textSecondary}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />

            <TouchableOpacity
              style={[styles.button, { backgroundColor: colors.primary }]}
              onPress={handleLogin}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={colors.primaryText} />
              ) : (
                <Text style={[styles.buttonText, { color: colors.primaryText }]}>Anmelden</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => { setShowCodeModal(true); setCodeError(null); setInviteCode(''); }}
              style={styles.registerLink}
            >
              <Text style={[styles.registerLinkText, { color: colors.textSecondary }]}>Mit Einladungscode registrieren</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={[styles.registerTitle, { color: colors.text }]}>Registrierung</Text>
            <Text style={[styles.registerSubtitle, { color: colors.textSecondary }]}>Erstelle dein Konto für die Scouting-App</Text>

            <TextInput
              style={[styles.input, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder, color: colors.text }]}
              placeholder="Vorname" placeholderTextColor={colors.textSecondary}
              value={regFirst} onChangeText={setRegFirst}
            />
            <TextInput
              style={[styles.input, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder, color: colors.text }]}
              placeholder="Nachname" placeholderTextColor={colors.textSecondary}
              value={regLast} onChangeText={setRegLast}
            />
            <TextInput
              style={[styles.input, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder, color: colors.text }]}
              placeholder="E-Mail" placeholderTextColor={colors.textSecondary}
              value={regEmail} onChangeText={setRegEmail}
              keyboardType="email-address" autoCapitalize="none"
            />
            <View style={[styles.passwordContainer, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder }]}>
              <TextInput
                style={[styles.passwordInput, { color: colors.text }]}
                placeholder="Passwort (min. 6 Zeichen)" placeholderTextColor={colors.textSecondary}
                value={regPassword} onChangeText={setRegPassword}
                secureTextEntry={!showRegPassword}
              />
              <TouchableOpacity style={styles.showButton} onPress={() => setShowRegPassword(!showRegPassword)}>
                <Text style={[styles.showButtonText, { color: colors.textSecondary }]}>
                  {showRegPassword ? 'Verbergen' : 'Anzeigen'}
                </Text>
              </TouchableOpacity>
            </View>
            <View style={[styles.passwordContainer, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder }]}>
              <TextInput
                style={[styles.passwordInput, { color: colors.text }]}
                placeholder="Passwort wiederholen" placeholderTextColor={colors.textSecondary}
                value={regConfirm} onChangeText={setRegConfirm}
                secureTextEntry={!showRegPassword}
              />
            </View>

            <TouchableOpacity
              style={[styles.button, { backgroundColor: colors.primary }]}
              onPress={handleRegister}
              disabled={regLoading}
            >
              {regLoading ? (
                <ActivityIndicator color={colors.primaryText} />
              ) : (
                <Text style={[styles.buttonText, { color: colors.primaryText }]}>Konto erstellen</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setMode('login')} style={styles.registerLink}>
              <Text style={[styles.registerLinkText, { color: colors.textSecondary }]}>← Zurück zur Anmeldung</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* Einladungs-Code-Modal — gleicher Ablauf wie in der KMH-App */}
      <Modal visible={showCodeModal} transparent animationType="fade" onRequestClose={() => setShowCodeModal(false)}>
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setShowCodeModal(false)} />
          <View style={styles.modalContent}>
            <View style={styles.modalTitleRow}>
              <Text style={styles.modalTitle}>Registrierung</Text>
              <TouchableOpacity onPress={() => setShowCodeModal(false)} style={styles.modalClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>Bitte Einladungscode eingeben</Text>

            <TextInput
              style={[styles.modalInput, codeError ? styles.modalInputError : null]}
              placeholder=""
              placeholderTextColor="rgba(255,255,255,0.3)"
              value={inviteCode}
              onChangeText={(t) => { setInviteCode(t); setCodeError(null); }}
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={handleInviteCode}
            />

            {codeError ? <Text style={styles.errorText}>{codeError}</Text> : null}

            <TouchableOpacity
              style={[styles.modalButton, codeLoading && { opacity: 0.6 }]}
              onPress={handleInviteCode}
              disabled={codeLoading}
            >
              <Text style={styles.modalButtonText}>{codeLoading ? 'Prüfen…' : 'Weiter'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, padding: 24, justifyContent: 'center', maxWidth: 400, width: '100%', alignSelf: 'center' },
  title: { fontSize: 32, fontWeight: 'bold', textAlign: 'center', marginBottom: 0 },
  titleSecond: { fontSize: 32, fontWeight: 'bold', textAlign: 'center', marginBottom: 32 },
  input: { borderWidth: 1, borderRadius: 12, padding: 16, fontSize: 16, marginBottom: 16 },
  button: { padding: 16, borderRadius: 12, alignItems: 'center', marginBottom: 16 },
  buttonText: { fontSize: 16, fontWeight: '600' },
  registerLink: { alignItems: 'center', paddingVertical: 4 },
  registerLinkText: { fontSize: 14 },
  registerTitle: { fontSize: 22, fontWeight: 'bold', marginBottom: 4 },
  registerSubtitle: { fontSize: 14, marginBottom: 20 },
  passwordContainer: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12, marginBottom: 16 },
  passwordInput: { flex: 1, padding: 16, fontSize: 16 },
  showButton: { paddingHorizontal: 16, paddingVertical: 16 },
  showButtonText: { fontSize: 14 },

  // Einladungs-Code-Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalContent: { backgroundColor: '#14181f', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', width: 360, maxWidth: '94%', padding: 22 },
  modalTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  modalClose: { padding: 4 },
  modalCloseText: { color: 'rgba(255,255,255,0.6)', fontSize: 16 },
  modalSubtitle: { color: 'rgba(255,255,255,0.6)', fontSize: 13, marginBottom: 14 },
  modalInput: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: '#fff', letterSpacing: 2 },
  modalInputError: { borderColor: '#ef4444' },
  errorText: { color: '#ef4444', fontSize: 12, marginTop: 8 },
  modalButton: { backgroundColor: '#fff', borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 14 },
  modalButtonText: { color: '#000', fontSize: 15, fontWeight: '700' },
});
