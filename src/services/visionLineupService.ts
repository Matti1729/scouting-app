// visionLineupService.ts - Aufstellungen aus Bildern/PDFs extrahieren
//
// Nutzt Claude Vision API über Supabase Edge Function

import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { supabase } from '../config/supabase';

const SUPABASE_URL = 'https://ozggtruvnwozhwjbznsm.supabase.co';
const VISION_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/lineup-vision`;

export type MediaSource = 'camera' | 'gallery' | 'document';

export interface ScrapedPlayer {
  nummer: string;
  vorname: string;
  name: string;
  position: string;
  jahrgang: string;
}

export interface ScrapedLineups {
  homeTeam: string;
  awayTeam: string;
  homeStarters: ScrapedPlayer[];
  homeSubs: ScrapedPlayer[];
  awayStarters: ScrapedPlayer[];
  awaySubs: ScrapedPlayer[];
  available: boolean;
}

export interface VisionResult {
  success: boolean;
  data?: ScrapedLineups;
  error?: string;
}

/**
 * Bild von Kamera oder Galerie auswählen
 */
export async function pickImage(source: 'camera' | 'gallery'): Promise<{ uri: string; mimeType: string } | null> {
  // Berechtigungen anfragen
  if (source === 'camera') {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      throw new Error('Kamerazugriff wurde verweigert');
    }
  } else {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      throw new Error('Fotozugriff wurde verweigert');
    }
  }

  const result = source === 'camera'
    ? await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.8,
        base64: false,
      })
    : await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
        base64: false,
      });

  if (result.canceled || !result.assets?.[0]) {
    return null;
  }

  const asset = result.assets[0];
  return {
    uri: asset.uri,
    mimeType: asset.mimeType || 'image/jpeg',
  };
}

/**
 * PDF-Dokument auswählen
 */
export async function pickDocument(): Promise<{ uri: string; mimeType: string } | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/pdf', 'image/*'],
    copyToCacheDirectory: true,
  });

  if (result.canceled || !result.assets?.[0]) {
    return null;
  }

  const asset = result.assets[0];
  return {
    uri: asset.uri,
    mimeType: asset.mimeType || 'application/pdf',
  };
}

/**
 * Datei-URI zu Base64 konvertieren
 */
async function fileToBase64(uri: string): Promise<string> {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: 'base64',
  });
  return base64;
}

/**
 * Aufstellungen aus Bild/PDF mit Claude Vision extrahieren
 */
export async function extractLineupsFromImage(
  uri: string,
  mimeType: string,
  homeTeamHint?: string,
  awayTeamHint?: string
): Promise<VisionResult> {
  try {
    console.log('Converting file to base64...');
    const imageBase64 = await fileToBase64(uri);
    console.log('Base64 length:', imageBase64.length);

    console.log('Calling vision API...');
    const { data: { session } } = await supabase.auth.getSession();

    const response = await fetch(VISION_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token || ''}`,
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96Z2d0cnV2bndvemh3amJ6bnNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5NDI5ODYsImV4cCI6MjA4MjUxODk4Nn0.QCaSqAQPrIl-DXKiT82wbWAJ23KbeOTpRvq8YI46hCY',
      },
      body: JSON.stringify({
        imageBase64,
        mimeType,
        homeTeamHint,
        awayTeamHint,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Vision API error:', response.status, errorText);
      throw new Error(`HTTP ${response.status}`);
    }

    const result = await response.json();

    if (!result.success) {
      return { success: false, error: result.error || 'Vision-Verarbeitung fehlgeschlagen' };
    }

    return { success: true, data: result.data };

  } catch (err) {
    console.error('Vision extraction error:', err);
    return {
      success: false,
      error: 'Fehler bei der Bildverarbeitung. Bitte versuche es erneut.',
    };
  }
}

/**
 * Kompletter Flow: Medium auswählen und Aufstellungen extrahieren
 */
export async function pickAndExtractLineups(
  source: MediaSource,
  homeTeamHint?: string,
  awayTeamHint?: string
): Promise<VisionResult> {
  try {
    let file: { uri: string; mimeType: string } | null = null;

    if (source === 'camera' || source === 'gallery') {
      file = await pickImage(source);
    } else if (source === 'document') {
      file = await pickDocument();
    }

    if (!file) {
      return { success: false, error: 'Keine Datei ausgewählt' };
    }

    return await extractLineupsFromImage(
      file.uri,
      file.mimeType,
      homeTeamHint,
      awayTeamHint
    );

  } catch (err: unknown) {
    console.error('Pick and extract error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unbekannter Fehler';
    return { success: false, error: errorMessage };
  }
}
