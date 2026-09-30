import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../config/supabase';

interface AuthContextType {
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, name: string) => Promise<{ error: Error | null }>;
  signUpWithInvitation: (email: string, password: string, firstName: string, lastName: string, code: string) => Promise<{ error: Error | null; needsConfirmation?: boolean }>;
  verifySignupCode: (email: string, code: string) => Promise<{ error: Error | null }>;
  resendSignupCode: (email: string) => Promise<{ error: Error | null }>;
  requestPasswordReset: (email: string) => Promise<{ error: Error | null }>;
  verifyRecoveryCode: (email: string, code: string) => Promise<{ error: Error | null }>;
  finishRecovery: (newPassword: string) => Promise<{ error: Error | null }>;
  cancelRecovery: () => Promise<void>;
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
  // Mit E-Mail-Bestätigung (Supabase "Confirm email", gilt für KMH-App und Scouting-App)
  // gibt es noch keine Session: dann kommt ein 6-stelliger Code per Mail, eingelöst wird
  // die Einladung erst in verifySignupCode.
  const signUpWithInvitation = async (email: string, password: string, firstName: string, lastName: string, code: string) => {
    registering.current = true;
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { name: `${firstName} ${lastName}`.trim(), first_name: firstName, last_name: lastName, invitation_code: code } },
      });
      if (error) return { error: error as Error | null };
      if (!data.session) return { error: null, needsConfirmation: true };
      const { error: consumeError } = await supabase.rpc('consume_staff_invitation', {
        p_code: code,
        p_first_name: firstName,
        p_last_name: lastName,
      });
      await supabase.auth.signOut();
      if (consumeError) return { error: consumeError as Error | null };
      return { error: null };
    } finally {
      registering.current = false;
    }
  };

  // Code aus der Bestätigungs-Mail: Konto aktivieren, Einladung einlösen, Zugang prüfen.
  const verifySignupCode = async (email: string, code: string) => {
    registering.current = true;
    try {
      const { data, error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.replace(/\D/g, ''), type: 'signup' });
      if (error) return { error: error as Error | null };
      const meta: any = data.user?.user_metadata || {};
      if (meta.invitation_code) {
        await supabase.rpc('consume_staff_invitation', { p_code: meta.invitation_code, p_first_name: meta.first_name ?? null, p_last_name: meta.last_name ?? null });
      }
      if (!data.user || !(await hasScoutingAccess(data.user.id))) {
        await supabase.auth.signOut();
        return { error: new Error(NO_ACCESS_MESSAGE) };
      }
      setSession(data.session);
      return { error: null };
    } finally {
      registering.current = false;
    }
  };

  const resendSignupCode = async (email: string) => {
    const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim() });
    return { error: error as Error | null };
  };

  const requestPasswordReset = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
    return { error: error as Error | null };
  };

  // Passwort vergessen: Code prüfen. Die Session bleibt "zurückgehalten" (registering),
  // bis das neue Passwort gesetzt ist -> der Login-Screen zeigt solange "Neues Passwort".
  const verifyRecoveryCode = async (email: string, code: string) => {
    registering.current = true;
    const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.replace(/\D/g, ''), type: 'recovery' });
    if (error) registering.current = false;
    return { error: error as Error | null };
  };

  const finishRecovery = async (newPassword: string) => {
    const { data, error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return { error: error as Error | null };
    registering.current = false;
    if (!data.user || !(await hasScoutingAccess(data.user.id))) {
      await supabase.auth.signOut();
      return { error: new Error(NO_ACCESS_MESSAGE) };
    }
    const { data: { session: s2 } } = await supabase.auth.getSession();
    setSession(s2);
    return { error: null };
  };

  const cancelRecovery = async () => {
    await supabase.auth.signOut();
    registering.current = false;
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ session, loading, signIn, signUp, signUpWithInvitation, verifySignupCode, resendSignupCode, requestPasswordReset, verifyRecoveryCode, finishRecovery, cancelRecovery, signOut }}>
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
