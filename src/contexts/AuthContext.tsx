import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../config/supabase';

interface AuthContextType {
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, name: string) => Promise<{ error: Error | null }>;
  signUpWithInvitation: (email: string, password: string, name: string, code: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Prüft, ob das Konto für die Scouting-App freigeschaltet ist.
// Freigabe wird zentral in der KMH-Admin-Verwaltung gesetzt (advisors.access_scouting).
async function hasScoutingAccess(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('advisors')
    .select('access_scouting')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    console.warn('Zugriffsprüfung fehlgeschlagen:', error);
    return false;
  }
  return data?.access_scouting === true;
}

const NO_ACCESS_MESSAGE =
  'Kein Zugang zur Suchmaschine. Bitte wende dich an einen Administrator.';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  // Während einer Code-Registrierung Session-Änderungen ignorieren,
  // damit die App nicht kurz aufgeht, bevor die Einladung eingelöst ist.
  const registering = useRef(false);

  useEffect(() => {
    // Initiale Session holen — aber nur akzeptieren, wenn Scouting-Zugang besteht.
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user && !(await hasScoutingAccess(session.user.id))) {
        await supabase.auth.signOut();
        setSession(null);
      } else {
        setSession(session);
      }
      setLoading(false);
    });

    // Auth-Änderungen überwachen
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (registering.current) return;
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error as Error | null };

    // Zugriff auf die Scouting-App prüfen — sonst sofort wieder abmelden.
    if (data.user && !(await hasScoutingAccess(data.user.id))) {
      await supabase.auth.signOut();
      setSession(null);
      return { error: new Error(NO_ACCESS_MESSAGE) };
    }
    return { error: null };
  };

  const signUp = async (email: string, password: string, name: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name },
      },
    });
    return { error: error as Error | null };
  };

  // Registrierung per Einladungs-Code: Konto anlegen, Einladung einlösen
  // (setzt Rolle + App-Zugriff serverseitig), danach abmelden — die Person
  // meldet sich anschließend regulär an.
  const signUpWithInvitation = async (email: string, password: string, name: string, code: string) => {
    registering.current = true;
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { name } },
      });
      if (error) return { error: error as Error | null };
      const { error: consumeError } = await supabase.rpc('consume_staff_invitation', { p_code: code });
      await supabase.auth.signOut();
      if (consumeError) return { error: consumeError as Error | null };
      return { error: null };
    } finally {
      registering.current = false;
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ session, loading, signIn, signUp, signUpWithInvitation, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
