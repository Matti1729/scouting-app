import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Farben für die Scouting-App
const lightColors = {
  background: '#f5f5f5',
  surface: '#ffffff',
  surfaceSecondary: '#f0f0f0',
  primary: '#1a5f2a', // Fußball-Grün
  primaryLight: '#2d8a3e',
  primaryText: '#ffffff',
  text: '#1a1a1a',
  textSecondary: '#666666',
  border: '#e0e0e0',
  inputBackground: '#ffffff',
  inputBorder: '#d0d0d0',
  cardBackground: '#ffffff',
  cardBorder: '#e8e8e8',
  success: '#22c55e',
  warning: '#f59e0b',
  error: '#ef4444',
  accent: '#3b82f6',
};

const darkColors = {
  background: '#0a0a0a',
  surface: '#1a1a1a',
  surfaceSecondary: '#252525',
  primary: '#22c55e', // Helleres Grün für Dark Mode
  primaryLight: '#4ade80',
  primaryText: '#000000',
  text: '#f5f5f5',
  textSecondary: '#a0a0a0',
  border: '#333333',
  inputBackground: '#1a1a1a',
  inputBorder: '#404040',
  cardBackground: '#1a1a1a',
  cardBorder: '#2a2a2a',
  success: '#22c55e',
  warning: '#f59e0b',
  error: '#ef4444',
  accent: '#60a5fa',
};

export type ThemeColors = typeof lightColors;

interface ThemeContextType {
  colors: ThemeColors;
  isDark: boolean;
  toggleTheme: () => void;
  setTheme: (dark: boolean) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemColorScheme = useColorScheme();
  const [isDark, setIsDark] = useState(systemColorScheme === 'dark');

  useEffect(() => {
    // Lade gespeicherte Theme-Präferenz
    AsyncStorage.getItem('theme').then((value) => {
      if (value !== null) {
        setIsDark(value === 'dark');
      }
    });
  }, []);

  const toggleTheme = useCallback(() => {
    setIsDark(prev => {
      const newValue = !prev;
      AsyncStorage.setItem('theme', newValue ? 'dark' : 'light');
      return newValue;
    });
  }, []);

  const setTheme = useCallback((dark: boolean) => {
    setIsDark(dark);
    AsyncStorage.setItem('theme', dark ? 'dark' : 'light');
  }, []);

  // Memoize colors to prevent unnecessary re-renders in consumers
  const colors = useMemo(() => isDark ? darkColors : lightColors, [isDark]);

  // Memoize the entire context value to prevent re-renders when parent re-renders
  const value = useMemo(() => ({
    colors,
    isDark,
    toggleTheme,
    setTheme,
  }), [colors, isDark, toggleTheme, setTheme]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
