// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AuthGate from './AuthGate';
import { AuthEvent, AuthService, AuthUser, OfflineError } from './authService';
import { GATE_MESSAGES } from './messages';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

class FakeAuth implements AuthService {
  user: AuthUser | null = null;
  allowed: boolean | 'offline' = true;
  password = 'fake-password-1';
  listeners: Array<(e: AuthEvent, u: AuthUser | null) => void> = [];
  signOutCalls = 0;
  isAllowedCalls = 0;
  async getUser() { return this.user; }
  onChange(cb: (e: AuthEvent, u: AuthUser | null) => void) {
    this.listeners.push(cb);
    return () => { this.listeners = this.listeners.filter(l => l !== cb); };
  }
  async signIn(email: string, password: string) {
    if (email === 'offline@example.test') return { user: null, error: 'offline' as const };
    if (password !== this.password) return { user: null, error: 'invalid_credentials' as const };
    this.user = { id: 'u-1', email };
    return { user: this.user, error: null };
  }
  async signOut() { this.signOutCalls++; this.user = null; this.emit('SIGNED_OUT', null); }
  async isAllowed() {
    this.isAllowedCalls++;
    if (this.allowed === 'offline') throw new OfflineError();
    return this.allowed;
  }
  emit(e: AuthEvent, u: AuthUser | null) { this.listeners.forEach(l => l(e, u)); }
}

let container: HTMLDivElement;
let root: Root;
const children = vi.fn((ctx: any) => <div id="protected-app">{ctx.user.email}<button id="out" onClick={() => void ctx.signOut()}>out</button></div>);

beforeEach(() => {
  children.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); });
};

function setInput(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

async function login(email: string, password: string) {
  act(() => {
    setInput(container.querySelector('#login-email') as HTMLInputElement, email);
    setInput(container.querySelector('#login-password') as HTMLInputElement, password);
  });
  await act(async () => {
    (container.querySelector('#login-form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await flush();
}

const q = (sel: string) => container.querySelector(sel);

describe('AuthGate', () => {
  it('misconfigured (no client) renders nothing of the app', async () => {
    act(() => root.render(<AuthGate auth={null}>{children}</AuthGate>));
    expect(q('#gate-misconfigured')).not.toBeNull();
    expect(children).not.toHaveBeenCalled();
  });

  it('signed out shows the Arabic RTL login form with no sign-up / reset UI', async () => {
    const auth = new FakeAuth();
    act(() => root.render(<AuthGate auth={auth}>{children}</AuthGate>));
    await flush();
    expect(q('#login-screen')?.getAttribute('dir')).toBe('rtl');
    expect(q('#login-email')).not.toBeNull();
    expect(container.textContent).not.toMatch(/إنشاء حساب|نسيت|sign ?up|forgot/i);
    expect(children).not.toHaveBeenCalled();
    expect(auth.isAllowedCalls).toBe(0);
  });

  it('wrong credentials show the Arabic error and never render the app', async () => {
    const auth = new FakeAuth();
    act(() => root.render(<AuthGate auth={auth}>{children}</AuthGate>));
    await flush();
    await login('teacher@example.test', 'wrong');
    expect(q('#login-error')?.getAttribute('data-notice')).toBe('invalid_credentials');
    expect(q('#login-error')?.textContent).toContain(GATE_MESSAGES.invalid_credentials);
    expect(children).not.toHaveBeenCalled();
  });

  it('offline sign-in shows the offline message', async () => {
    const auth = new FakeAuth();
    act(() => root.render(<AuthGate auth={auth}>{children}</AuthGate>));
    await flush();
    await login('offline@example.test', 'x');
    expect(q('#login-error')?.getAttribute('data-notice')).toBe('offline');
  });

  it('allowed user renders the app only after is_allowed() is true', async () => {
    const auth = new FakeAuth();
    act(() => root.render(<AuthGate auth={auth}>{children}</AuthGate>));
    await flush();
    await login('teacher@example.test', auth.password);
    expect(auth.isAllowedCalls).toBe(1);
    expect(q('#protected-app')?.textContent).toContain('teacher@example.test');
  });

  it('non allow-listed user is signed out and told "not authorized"', async () => {
    const auth = new FakeAuth();
    auth.allowed = false;
    act(() => root.render(<AuthGate auth={auth}>{children}</AuthGate>));
    await flush();
    await login('other@example.test', auth.password);
    expect(auth.signOutCalls).toBe(1);
    expect(q('#protected-app')).toBeNull();
    expect(q('#login-error')?.getAttribute('data-notice')).toBe('not_authorized');
    expect(children).not.toHaveBeenCalled();
  });

  it('persisted session is restored (and re-verified) without showing the login form', async () => {
    const auth = new FakeAuth();
    auth.user = { id: 'u-1', email: 'teacher@example.test' };
    act(() => root.render(<AuthGate auth={auth}>{children}</AuthGate>));
    expect(q('#gate-loading')).not.toBeNull();
    await flush();
    expect(q('#protected-app')).not.toBeNull();
    expect(auth.isAllowedCalls).toBe(1);
  });

  it('allow-list check failing offline does not render the app', async () => {
    const auth = new FakeAuth();
    auth.user = { id: 'u-1', email: 'teacher@example.test' };
    auth.allowed = 'offline';
    act(() => root.render(<AuthGate auth={auth}>{children}</AuthGate>));
    await flush();
    expect(q('#protected-app')).toBeNull();
    expect(q('#login-error')?.getAttribute('data-notice')).toBe('offline');
  });

  it('token expiry (unexpected SIGNED_OUT) returns to login with "session expired"', async () => {
    const auth = new FakeAuth();
    auth.user = { id: 'u-1', email: 'teacher@example.test' };
    act(() => root.render(<AuthGate auth={auth}>{children}</AuthGate>));
    await flush();
    expect(q('#protected-app')).not.toBeNull();
    auth.user = null;
    act(() => auth.emit('SIGNED_OUT', null));
    await flush();
    expect(q('#protected-app')).toBeNull();
    expect(q('#login-error')?.getAttribute('data-notice')).toBe('session_expired');
  });

  it('manual logout returns to the login screen without an error', async () => {
    const auth = new FakeAuth();
    auth.user = { id: 'u-1', email: 'teacher@example.test' };
    act(() => root.render(<AuthGate auth={auth}>{children}</AuthGate>));
    await flush();
    await act(async () => { (q('#out') as HTMLButtonElement).click(); });
    await flush();
    expect(q('#protected-app')).toBeNull();
    expect(q('#login-screen')).not.toBeNull();
    expect(q('#login-error')).toBeNull();
  });
});
