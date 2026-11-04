/**
 * Login gate: nothing inside `children` is rendered (and so no data is fetched)
 * until there is a session AND the server confirms school_notify.is_allowed().
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, ServerCrash } from 'lucide-react';
import { AuthService, AuthUser, OfflineError, isNetworkError } from './authService';
import LoginScreen from './LoginScreen';
import { GateNotice } from './messages';

export type GateStatus = 'loading' | 'signed_out' | 'checking' | 'ready' | 'misconfigured';

export interface GateContext {
  user: AuthUser;
  signOut: () => Promise<void>;
  /** Call when a data request fails with an auth error (expired/revoked session). */
  handleAuthFailure: () => void;
}

interface AuthGateProps {
  auth: AuthService | null;
  children: (ctx: GateContext) => React.ReactNode;
}

export default function AuthGate({ auth, children }: AuthGateProps) {
  const [status, setStatus] = useState<GateStatus>(auth ? 'loading' : 'misconfigured');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [notice, setNotice] = useState<GateNotice | null>(null);
  const userRef = useRef<AuthUser | null>(null);
  const statusRef = useRef<GateStatus>(status);
  const manualSignOut = useRef(false);
  const mounted = useRef(true);

  const set = useCallback((s: GateStatus, u: AuthUser | null, n: GateNotice | null) => {
    if (!mounted.current) return;
    statusRef.current = s;
    userRef.current = u;
    setStatus(s);
    setUser(u);
    setNotice(n);
  }, []);

  /** Verifies the allow-list for a signed-in user. */
  const verify = useCallback(
    async (u: AuthUser | null, expiredNotice: GateNotice | null = null) => {
      if (!auth) return;
      if (!u) {
        set('signed_out', null, expiredNotice);
        return;
      }
      set('checking', null, null);
      try {
        const allowed = await auth.isAllowed();
        if (allowed) {
          set('ready', u, null);
        } else {
          manualSignOut.current = true;
          await auth.signOut();
          set('signed_out', null, 'not_authorized');
        }
      } catch (err) {
        // Never render the app on an unverified session.
        set('signed_out', null, err instanceof OfflineError || isNetworkError(err) ? 'offline' : 'unknown');
      }
    },
    [auth, set]
  );

  const init = useCallback(async () => {
    if (!auth) return;
    set('loading', null, null);
    try {
      const u = await auth.getUser();
      await verify(u);
    } catch (err) {
      set('signed_out', null, isNetworkError(err) || err instanceof OfflineError ? 'offline' : 'unknown');
    }
  }, [auth, set, verify]);

  useEffect(() => {
    mounted.current = true;
    if (!auth) return;
    void init();
    const unsubscribe = auth.onChange((event, u) => {
      // Defer: calling auth APIs synchronously inside the auth callback can dead-lock supabase-js.
      setTimeout(() => {
        if (event === 'SIGNED_OUT') {
          const wasManual = manualSignOut.current;
          manualSignOut.current = false;
          // Only an unexpected sign-out of a running app (expired/revoked token, other tab) shows a notice.
          if (statusRef.current === 'ready') set('signed_out', null, wasManual ? null : 'session_expired');
        } else if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
          if (statusRef.current === 'ready' && u && userRef.current?.id !== u.id) void verify(u);
        } else if (event === 'SIGNED_IN') {
          // Another tab signed in a different user -> re-verify.
          if (statusRef.current === 'ready' && u && userRef.current?.id !== u.id) void verify(u);
        }
      }, 0);
    });
    const onFocus = () => {
      if (statusRef.current === 'ready') {
        auth
          .getUser()
          .then(u => {
            if (!u) set('signed_out', null, 'session_expired');
          })
          .catch(() => undefined);
      }
    };
    window.addEventListener('focus', onFocus);
    return () => {
      mounted.current = false;
      unsubscribe();
      window.removeEventListener('focus', onFocus);
    };
  }, [auth, init, set, verify]);

  const handleLogin = async (email: string, password: string) => {
    if (!auth) return;
    set('checking', null, null);
    const { user: u, error } = await auth.signIn(email, password);
    if (error || !u) {
      set('signed_out', null, error ?? 'unknown');
      return;
    }
    await verify(u);
  };

  const signOut = useCallback(async () => {
    if (!auth) return;
    manualSignOut.current = true;
    await auth.signOut();
    set('signed_out', null, null);
  }, [auth, set]);

  const handleAuthFailure = useCallback(() => {
    if (!auth) return;
    auth
      .getUser()
      .then(u => {
        if (!u) set('signed_out', null, 'session_expired');
        else void verify(u, 'session_expired');
      })
      .catch(() => undefined);
  }, [auth, set, verify]);

  if (status === 'misconfigured') {
    return (
      <div dir="rtl" className="min-h-screen flex items-center justify-center p-6 bg-slate-50" id="gate-misconfigured">
        <div className="max-w-md text-center space-y-2 bg-white border border-amber-200 rounded-2xl p-6">
          <ServerCrash className="w-8 h-8 mx-auto text-amber-600" />
          <h1 className="font-bold text-slate-800">التطبيق غير مهيأ للاتصال بالخادم</h1>
          <p className="text-sm text-slate-600">لم يتم ضبط إعدادات الاتصال بالسحابة في هذه النسخة، لذلك لا يمكن تسجيل الدخول.</p>
        </div>
      </div>
    );
  }

  if (status === 'loading') {
    return (
      <div dir="rtl" className="min-h-screen flex items-center justify-center bg-slate-50" id="gate-loading">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
        <span className="mr-2 text-sm text-slate-600">جاري التحقق من الجلسة...</span>
      </div>
    );
  }

  if (status === 'ready' && user) {
    return <>{children({ user, signOut, handleAuthFailure })}</>;
  }

  return <LoginScreen busy={status === 'checking'} notice={notice} onSubmit={handleLogin} onRetry={() => void init()} />;
}
