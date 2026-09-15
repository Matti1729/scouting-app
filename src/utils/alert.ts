import { Alert, AlertButton, Platform } from 'react-native';

// Alert.alert ist unter React Native Web ein No-op: Hinweise und Fehler beim
// Speichern wären im Browser unsichtbar. Hier: Web -> window.alert/confirm,
// Native -> normales Alert.alert. Signatur wie Alert.alert.
export function showAlert(title: string, message?: string, buttons?: AlertButton[]) {
  if (Platform.OS !== 'web') {
    Alert.alert(title, message, buttons);
    return;
  }
  const text = message ? `${title}\n\n${message}` : title;
  const actions = buttons || [];
  const cancel = actions.find(b => b.style === 'cancel');
  const confirm = actions.find(b => b.style !== 'cancel');
  if (actions.length >= 2 && confirm) {
    if (window.confirm(text)) confirm.onPress?.();
    else cancel?.onPress?.();
    return;
  }
  window.alert(text);
  actions[0]?.onPress?.();
}
