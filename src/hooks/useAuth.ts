import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase';

export interface AuthState {
  /** null means "playing as a guest", which is the app's normal, fully-supported state - not a
   *  logged-out error. Everything works without an account; signing in only adds a backup that
   *  follows the user to their other devices. */
  session: Session | null;
  email: string | null;
  /** False while the session is being restored from storage on load. Without it the UI would flash
   *  "signed out" at a returning user for a moment on every reload. */
  ready: boolean;
  /** No project configured: there is nothing to sign in to, so the UI hides the whole idea. */
  available: boolean;
}

/**
 * Who is signed in, if anyone. A thin wrapper over Supabase's own session handling - it already
 * persists and refreshes the session, so this only turns it into React state.
 */
export function useAuth(): AuthState {
  const supabase = getSupabase();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(!supabase);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;

    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      setReady(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setReady(true);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  return {
    session,
    email: session?.user.email ?? null,
    ready,
    available: !!supabase,
  };
}

/** Sends a sign-in link to an email address. No passwords: there is nothing here worth the support
 *  burden of storing one, and a link that expires is safer than a password a user reuses. */
export async function sendMagicLink(email: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: 'not configured' };
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function signOut(): Promise<void> {
  await getSupabase()?.auth.signOut();
}
