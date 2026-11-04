import React, { useState } from 'react';
import { Lock, LogIn, Loader2, AlertCircle, WifiOff } from 'lucide-react';
import { GATE_MESSAGES, GateNotice } from './messages';

interface LoginScreenProps {
  busy: boolean;
  notice: GateNotice | null;
  onSubmit: (email: string, password: string) => void;
  onRetry?: () => void;
}

/** Email + password sign-in only. No sign-up and no password-reset UI by design. */
export default function LoginScreen({ busy, notice, onSubmit, onRetry }: LoginScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [localNotice, setLocalNotice] = useState<GateNotice | null>(null);
  const shown = localNotice ?? notice;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setLocalNotice('missing_fields');
      return;
    }
    setLocalNotice(null);
    onSubmit(email, password);
  };

  return (
    <div dir="rtl" className="min-h-screen flex items-center justify-center bg-slate-50 p-4 font-sans" id="login-screen">
      <form onSubmit={submit} className="w-full max-w-sm bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-4" id="login-form" noValidate>
        <div className="text-center space-y-1">
          <div className="mx-auto w-12 h-12 rounded-xl bg-indigo-600 text-white flex items-center justify-center">
            <Lock className="w-6 h-6" />
          </div>
          <h1 className="text-lg font-bold text-slate-800">تسجيل الدخول</h1>
          <p className="text-xs text-slate-500">نظام إشعارات المدرسة — الدخول للمستخدمين المصرح لهم فقط.</p>
        </div>

        {shown && (
          <div role="alert" id="login-error" data-notice={shown} className="flex items-start gap-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs">
            {shown === 'offline' ? <WifiOff className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
            <span>{GATE_MESSAGES[shown]}</span>
          </div>
        )}

        <label className="block text-xs font-bold text-slate-700">
          البريد الإلكتروني
          <input
            type="email"
            dir="ltr"
            autoComplete="username"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-left"
            id="login-email"
            disabled={busy}
          />
        </label>
        <label className="block text-xs font-bold text-slate-700">
          كلمة المرور
          <input
            type="password"
            dir="ltr"
            autoComplete="current-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-left"
            id="login-password"
            disabled={busy}
          />
        </label>

        <button
          type="submit"
          disabled={busy}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-bold py-2.5"
          id="login-submit"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
          {busy ? 'جاري التحقق...' : 'دخول'}
        </button>

        {notice === 'offline' && onRetry && (
          <button type="button" onClick={onRetry} className="w-full text-xs text-indigo-700 underline" id="login-retry">
            إعادة المحاولة
          </button>
        )}
      </form>
    </div>
  );
}
