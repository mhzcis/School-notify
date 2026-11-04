/**
 * Production wiring: Supabase auth gate -> per-user cloud repository -> App.
 */
import React, { useMemo } from 'react';
import App from './App';
import AuthGate from './auth/AuthGate';
import { createSupabaseAuthService } from './auth/authService';
import { getSupabase, invokeSmsFunction } from './lib/supabase';
import { SupabaseSchoolRepository } from './lib/repo/supabaseRepo';
import type { AuthUser } from './auth/authService';

function SignedInApp({ user, signOut, handleAuthFailure }: { user: AuthUser; signOut: () => Promise<void>; handleAuthFailure: () => void }) {
  const sb = getSupabase()!;
  const repo = useMemo(() => new SupabaseSchoolRepository(sb, user.id), [sb, user.id]);
  const checkGateway = useMemo(() => () => invokeSmsFunction({ action: 'status' }), []);
  return <App repo={repo} user={user} onSignOut={signOut} onAuthFailure={handleAuthFailure} checkGateway={checkGateway} />;
}

export default function Root() {
  const auth = useMemo(() => {
    const sb = getSupabase();
    return sb ? createSupabaseAuthService(sb) : null;
  }, []);
  return <AuthGate auth={auth}>{ctx => <SignedInApp {...ctx} />}</AuthGate>;
}
