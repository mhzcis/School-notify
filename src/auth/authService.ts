/**
 * Thin auth abstraction so the login gate can be unit-tested with a fake.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface AuthUser {
  id: string;
  email?: string | null;
}

export type AuthEvent = 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED' | 'USER_UPDATED' | 'INITIAL_SESSION' | 'OTHER';

export type SignInError = 'invalid_credentials' | 'offline' | 'unknown';

export interface AuthService {
  /** Current persisted session user (null when signed out / expired and not refreshable). */
  getUser(): Promise<AuthUser | null>;
  onChange(cb: (event: AuthEvent, user: AuthUser | null) => void): () => void;
  signIn(email: string, password: string): Promise<{ user: AuthUser | null; error: SignInError | null }>;
  signOut(): Promise<void>;
  /** Server-side allow-list check: school_notify.is_allowed(). Throws on network errors. */
  isAllowed(): Promise<boolean>;
}

export class OfflineError extends Error {
  constructor() {
    super('offline');
    this.name = 'OfflineError';
  }
}

export function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const msg = String((err as any)?.message ?? err ?? '').toLowerCase();
  return (
    (err as any)?.name === 'AuthRetryableFetchError' ||
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed') ||
    msg.includes('load failed') ||
    msg === 'offline'
  );
}

function mapEvent(e: string): AuthEvent {
  switch (e) {
    case 'SIGNED_IN':
    case 'SIGNED_OUT':
    case 'TOKEN_REFRESHED':
    case 'USER_UPDATED':
    case 'INITIAL_SESSION':
      return e;
    default:
      return 'OTHER';
  }
}

export function createSupabaseAuthService(sb: SupabaseClient<any, any, any>): AuthService {
  return {
    async getUser() {
      const { data } = await sb.auth.getSession();
      const s = data.session;
      if (!s) return null;
      // Expired access token that could not be refreshed -> treat as signed out.
      if (s.expires_at && s.expires_at * 1000 < Date.now()) {
        const { data: refreshed, error } = await sb.auth.refreshSession();
        if (error || !refreshed.session) {
          if (error && isNetworkError(error)) throw new OfflineError();
          return null;
        }
        return { id: refreshed.session.user.id, email: refreshed.session.user.email };
      }
      return { id: s.user.id, email: s.user.email };
    },
    onChange(cb) {
      const { data } = sb.auth.onAuthStateChange((event, session) => {
        cb(mapEvent(event), session ? { id: session.user.id, email: session.user.email } : null);
      });
      return () => data.subscription.unsubscribe();
    },
    async signIn(email, password) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return { user: null, error: 'offline' };
      try {
        const { data, error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
        if (error) {
          if (isNetworkError(error)) return { user: null, error: 'offline' };
          const code = (error as any).code as string | undefined;
          const status = (error as any).status as number | undefined;
          if (code === 'invalid_credentials' || status === 400) return { user: null, error: 'invalid_credentials' };
          return { user: null, error: 'unknown' };
        }
        return { user: data.user ? { id: data.user.id, email: data.user.email } : null, error: null };
      } catch (err) {
        return { user: null, error: isNetworkError(err) ? 'offline' : 'unknown' };
      }
    },
    async signOut() {
      // 'local' clears the session in this browser even when offline.
      await sb.auth.signOut({ scope: 'local' }).catch(() => undefined);
    },
    async isAllowed() {
      const { data, error } = await sb.rpc('is_allowed');
      if (error) {
        if (isNetworkError(error)) throw new OfflineError();
        throw new Error(error.message || 'is_allowed failed');
      }
      return data === true;
    },
  };
}
