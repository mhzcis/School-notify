/**
 * Do-not-send list editor. Numbers here are skipped by every send (immediate, resend-failed,
 * and scheduled server sends). Phones are shown masked by default.
 */
import React, { useState } from 'react';
import { Ban, Loader2, Trash2, Eye, EyeOff } from 'lucide-react';
import { maskPhone, parseSuppressed, type SuppressedPhone } from '../lib/suppression';

interface Props {
  available: boolean;
  rows: SuppressedPhone[];
  onAdd: (entry: SuppressedPhone) => Promise<void>;
  onRemove: (phone: string) => Promise<void>;
}

export default function SuppressionListPanel({ available, rows, onAdd, onRemove }: Props) {
  const [phone, setPhone] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [reveal, setReveal] = useState(false);

  const add = async () => {
    const p = parseSuppressed(phone, reason);
    if (!p.ok) {
      setMsg({ ok: false, text: 'رقم غير صالح. اكتب رقم جوال مثل 05XXXXXXXX.' });
      return;
    }
    if (rows.some(r => r.phone === p.entry.phone)) {
      setMsg({ ok: false, text: 'هذا الرقم موجود في القائمة بالفعل.' });
      return;
    }
    setBusy(true);
    try {
      await onAdd(p.entry);
      setPhone('');
      setReason('');
      setMsg({ ok: true, text: `أُضيف الرقم ${maskPhone(p.entry.phone)} إلى قائمة عدم الإرسال.` });
    } catch {
      setMsg({ ok: false, text: 'تعذر حفظ الرقم في السحابة. حاول مرة أخرى.' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: string) => {
    if (!window.confirm(`إزالة الرقم ${maskPhone(p)} من قائمة عدم الإرسال؟ سيعود الإرسال إليه ممكناً.`)) return;
    setBusy(true);
    try {
      await onRemove(p);
      setMsg({ ok: true, text: `أُزيل الرقم ${maskPhone(p)} من القائمة.` });
    } catch {
      setMsg({ ok: false, text: 'تعذر إزالة الرقم. حاول مرة أخرى.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-xs space-y-4" id="suppression-panel" dir="rtl">
      <div>
        <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
          <Ban className="w-5 h-5 text-rose-600" />
          قائمة عدم الإرسال
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          الأرقام هنا لا تصلها أي رسالة: الإرسال الفوري، وإعادة إرسال الفاشلة، والحملات المجدولة. يظهر عدد المستبعدين في نافذة التأكيد.
        </p>
      </div>

      {!available ? (
        <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs" id="suppression-unavailable">
          قائمة عدم الإرسال غير مفعلة في قاعدة البيانات بعد.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 items-center">
            <input
              type="tel" dir="ltr" value={phone} onChange={e => setPhone(e.target.value)} placeholder="05XXXXXXXX"
              className="border border-slate-300 rounded-lg px-3 py-2 text-xs w-40" id="input-suppress-phone" autoComplete="off"
            />
            <input
              type="text" value={reason} onChange={e => setReason(e.target.value)} placeholder="السبب (اختياري)" maxLength={200}
              className="border border-slate-300 rounded-lg px-3 py-2 text-xs flex-1 min-w-[10rem]" id="input-suppress-reason"
            />
            <button
              type="button" onClick={() => void add()} disabled={busy || !phone.trim()}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white text-xs font-bold rounded-lg flex items-center gap-2 cursor-pointer"
              id="btn-suppress-add"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
              إضافة
            </button>
          </div>

          {msg && (
            <div className={`p-2 rounded-lg text-xs ${msg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`} id="suppression-msg" role="status">
              {msg.text}
            </div>
          )}

          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-600" id="suppression-count">عدد الأرقام: {rows.length}</span>
            {rows.length > 0 && (
              <button type="button" onClick={() => setReveal(v => !v)} className="text-xs text-indigo-700 font-bold flex items-center gap-1 cursor-pointer" id="btn-suppress-reveal">
                {reveal ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                {reveal ? 'إخفاء الأرقام' : 'إظهار الأرقام'}
              </button>
            )}
          </div>
          {rows.length > 0 && (
            <ul className="divide-y divide-slate-100 border border-slate-100 rounded-lg" id="suppression-list">
              {rows.map(r => (
                <li key={r.phone} className="flex items-center justify-between gap-2 p-2 text-xs">
                  <span className="font-mono" dir="ltr">{reveal ? r.phone : maskPhone(r.phone)}</span>
                  <span className="flex-1 text-slate-500 truncate">{r.reason}</span>
                  <button type="button" onClick={() => void remove(r.phone)} disabled={busy} className="p-1 text-rose-600 hover:bg-rose-50 rounded cursor-pointer" title="إزالة">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
