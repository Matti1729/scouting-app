import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme } from './src/contexts/ThemeContext';
import { AuthProvider } from './src/contexts/AuthContext';
import { AppNavigator } from './src/navigation/AppNavigator';
import { SwipeBack } from './src/components/SwipeBack';
import { SwipeDownClose } from './src/components/SwipeDownClose';
import { Platform } from 'react-native';

// iPhone-Safari zoomt beim Antippen eines Eingabefelds (Schrift < 16 px) ins Bild und bleibt
// vergrößert (Matti 2026-10-25: nie reinzoomen, alles soll sichtbar bleiben).
// maximum-scale=1 verhindert das automatische Zoomen; Zoomen mit zwei Fingern erlaubt iOS weiterhin.
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  let vp = document.querySelector('meta[name="viewport"]') as HTMLMetaElement | null;
  if (!vp) {
    vp = document.createElement('meta');
    vp.name = 'viewport';
    document.head.appendChild(vp);
  }
  // bestehende Angaben behalten (Expo-Vorlage), nur maximum-scale ergänzen
  const base = (vp.content || 'width=device-width, initial-scale=1').replace(/,?\s*maximum-scale=[^,]*/g, '');
  vp.content = `${base}, maximum-scale=1`;
}

function AppContent() {
  const { isDark } = useTheme();
  const navRef = useNavigationContainerRef();

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      {/* Browser-Tab immer "Scouting" statt interner Seitennamen (MatchList, PlayerEvaluation …) */}
      <NavigationContainer ref={navRef} documentTitle={{ formatter: () => 'Scouting' }}>
        <AppNavigator />
      </NavigationContainer>
      {/* Wischgesten am Handy: vom linken Rand zurück, Fenster am Kopf nach unten wegwischen */}
      <SwipeBack navRef={navRef} />
      <SwipeDownClose />
    </>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
