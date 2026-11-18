import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Send, X } from 'lucide-react';
import SecretText from './SecretText';
import { estimateCampaign, segmentInfo } from '../lib/sms';
import { UI_PREF_KEYS } from '../lib/smsPrefs';
import { LARGE_SEND_THRESHOLD, QUIET_HOURS_LABEL, requiresTypedCount, typedCountMatches } from '../lib/sendSafety';

export interface ConfirmSample {
  label: string;
  text: string;
  maskedText?: string;
}

export interface ConfirmSendDialogProps {
  open: boolean;
  mode: 'now' | 'schedule';
  /** number of selected students */
  studentCount: number;
  /** rendered message bodies, one per phone number that will receive a message */
  contents: string[];
  /** numbers excluded because they are missing/invalid */
  excludedCount: number;
  /** a sample rendered message (first recipient) — used when `samples` is omitted */
  sampleText: string;
  /** Sample with secrets masked (shown by default; the real text is shown on demand). */
  sampleMaskedText?: string;
  /** Recipients whose Moodle placeholders will render empty. */
  missingMoodleCount?: number;
  sampleRecipientLabel?: string;
  /** Real rendered texts for the first 3–5 recipients (preferred). */
  samples?: ConfirmSample[];
  scheduledLabel?: string;
  /** When true, sending is inside 22:00–07:00 Asia/Jerusalem and needs an explicit override. */
  quietHoursActive?: boolean;
  quietHoursLabel?: string;
  /** Count of same-phone + same-body sends in the last 24 hours (warn, do not block). */
  duplicateCount?: number;
  /** When true, the teacher must tick an extra box because the template includes Moodle credentials. */
  requiresCredentialsConfirm?: boolean;
  onConfirm: (decision?: ConfirmDecision) => void;
  onCancel: () => void;
}

export interface ConfirmDecision {
  quietHoursOverride: boolean;
  credentialsConfirmed: boolean;
}

/**
 * Pre-send confirmation: shows how many messages will go out, SMS parts (Arabic = 70/67 per part),
 * an optional price-per-part cost estimate and a preview of 3–5 real rendered messages.
 */
export default function ConfirmSendDialog(props: ConfirmSendDialogProps) {
  const {
    open, mode, studentCount, contents, excludedCount, sampleText, sampleMaskedText,
    missingMoodleCount = 0, sampleRecipientLabel, samples, scheduledLabel,
    quietHoursActive = false, quietHoursLabel = QUIET_HOURS_LABEL, duplicateCount = 0,
    requiresCredentialsConfirm = false,
    onConfirm, onCancel,
  } = props;
  const [price, setPrice] = useState<string>(() => {
    try { return localStorage.getItem(UI_PREF_KEYS.smsSegmentPrice) || ''; } catch { return ''; }
  });
  const [typedCount, setTypedCount] = useState('');
  const [quietOverride, setQuietOverride] = useState(false);
  const [credentialsOverride, setCredentialsOverride] = useState(false);
  const [locked, setLocked] = useState(false);
  const lockedRef = useRef(false);

  useEffect(() => {
    try { localStorage.setItem(UI_PREF_KEYS.smsSegmentPrice, price); } catch { /* ignore */ }
  }, [price]);

  useEffect(() => {
    if (!open) return;
    setTypedCount('');
    setQuietOverride(false);
    setCredentialsOverride(false);
    setLocked(false);
    lockedRef.current = false;
  }, [open, studentCount, contents.length]);

  const priceNum = price.trim() === '' ? null : Number(price);
  const estimate = useMemo(() => estimateCampaign(contents, priceNum), [contents, priceNum]);
  const preview: ConfirmSample[] = (samples && samples.length)
    ? samples.slice(0, 5)
    : (sampleText ? [{ label: sampleRecipientLabel || 'المستلم الأول', text: sampleText, maskedText: sampleMaskedText }] : []);
  const sampleSeg = segmentInfo(preview[0]?.text || sampleText);
  const needsTyped = requiresTypedCount(estimate.messages);
  const typedOk = !needsTyped || typedCountMatches(typedCount, estimate.messages);
  const quietOk = !quietHoursActive || quietOverride;
  const credentialsOk = !requiresCredentialsConfirm || credentialsOverride;
  const canConfirm = estimate.messages > 0 && typedOk && quietOk && credentialsOk && !locked;

  const handleConfirm = () => {
    if (!canConfirm || lockedRef.current) return;
    lockedRef.current = true;
    setLocked(true);
    onConfirm({ quietHoursOverride: quietOverride, credentialsConfirmed: credentialsOverride });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4" dir="rtl" id="confirm-send-dialog">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-black text-slate-800">
            {mode === 'now' ? 'تأكيد الإرسال الآن' : 'تأكيد جدولة الحملة'}
          </h3>
          <button type="button" onClick={onCancel} disabled={locked} className="text-slate-400 hover:text-slate-600 cursor-pointer" aria-label="إغلاق">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
            <div className="text-slate-500">الطلاب المحددون</div>
            <div className="text-lg font-black font-mono text-slate-800" id="confirm-student-count">{studentCount}</div>
          </div>
          <div className="p-2.5 rounded-xl bg-indigo-50 border border-indigo-100">
            <div className="text-slate-500">رسائل ستُرسل (أرقام صالحة)</div>
            <div className="text-lg font-black font-mono text-indigo-700" id="confirm-message-count">{estimate.messages}</div>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
            <div className="text-slate-500">إجمالي أجزاء SMS</div>
            <div className="text-lg font-black font-mono text-slate-800" id="confirm-total-segments">{estimate.totalSegments}</div>
            <div className="text-[10px] text-slate-400">أطول رسالة: {estimate.maxSegmentsPerMessage} جزء</div>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
            <label className="text-slate-500 block" htmlFor="confirm-price-input">سعر الجزء الواحد (اختياري)</label>
            <input
              id="confirm-price-input"
              type="number"
              min="0"
              step="0.001"
              value={price}
              onChange={e => setPrice(e.target.value)}
              placeholder="مثال: 0.05"
              className="w-full mt-1 px-2 py-1 border border-slate-200 rounded-md text-xs font-mono"
            />
            <div className="text-[10px] text-slate-600 mt-1" id="confirm-estimated-cost">
              التكلفة التقديرية: {estimate.estimatedCost === null ? '—' : <strong className="font-mono">{estimate.estimatedCost}</strong>}
            </div>
          </div>
        </div>

        {missingMoodleCount > 0 && (
          <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex gap-2" id="confirm-missing-moodle">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>({missingMoodleCount}) طالب بدون بيانات مودل؛ سيظهر مكانها فارغاً في رسائلهم.</span>
          </div>
        )}

        {excludedCount > 0 && (
          <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>سيتم استبعاد ({excludedCount}) رقم غير صالح أو مفقود من الإرسال.</span>
          </div>
        )}

        {duplicateCount > 0 && (
          <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex gap-2" id="confirm-duplicate-warning">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>تنبيه: ({duplicateCount}) رسالة بنفس النص نُقلت لنفس الرقم خلال آخر 24 ساعة. يمكنك المتابعة بعد المراجعة.</span>
          </div>
        )}

        {quietHoursActive && (
          <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs space-y-2" id="confirm-quiet-hours">
            <div className="flex gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>الآن ضمن ساعات الهدوء ({quietHoursLabel}). الإرسال في هذا الوقت يحتاج تأكيداً إضافياً.</span>
            </div>
            <label className="flex items-center gap-2 font-bold cursor-pointer">
              <input
                id="confirm-quiet-override"
                type="checkbox"
                checked={quietOverride}
                onChange={e => setQuietOverride(e.target.checked)}
              />
              أؤكد أنني أريد الإرسال خلال ساعات الهدوء
            </label>
          </div>
        )}

        {requiresCredentialsConfirm && (
          <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs space-y-2" id="confirm-credentials-box">
            <div className="flex gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>هذه الرسالة تتضمن بيانات دخول مودل (اسم مستخدم أو كلمة مرور). تظهر كلمة المرور في المعاينة مخفية، وتُرسل فقط بعد هذا التأكيد الإضافي. لن تُحفظ في التقارير بنصها الصريح.</span>
            </div>
            <label className="flex items-center gap-2 font-bold cursor-pointer">
              <input
                id="confirm-credentials-override"
                type="checkbox"
                checked={credentialsOverride}
                onChange={e => setCredentialsOverride(e.target.checked)}
              />
              أؤكد أنني أريد إرسال بيانات دخول مودل لهذه المجموعة فقط
            </label>
          </div>
        )}

        {scheduledLabel && (
          <div className="text-xs text-slate-600">موعد الجدولة: <strong>{scheduledLabel}</strong> — الحملات المجدولة تُحفظ كـ«قيد الانتظار» حتى تُرسل (الإرسال التلقائي من السيرفر مرحلة لاحقة).</div>
        )}

        <div className="space-y-2">
          <div className="text-xs font-bold text-slate-600">
            معاينة الرسالة الفعلية لأول {preview.length} مستلم{preview.length > 1 ? 'ين' : ''}:
          </div>
          {preview.length === 0 ? (
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 text-xs text-slate-400">—</div>
          ) : preview.map((s, i) => (
            <div key={i} className="space-y-1">
              <div className="text-[10px] font-bold text-slate-500">{s.label}</div>
              <div className={`p-3 rounded-xl bg-emerald-50/50 border border-emerald-100 text-xs text-slate-800 whitespace-pre-wrap ${i === 0 ? '' : ''}`} id={i === 0 ? 'confirm-sample-preview' : `confirm-sample-preview-${i + 1}`}>
                <SecretText block value={s.text} maskedValue={s.maskedText ?? s.text} />
              </div>
            </div>
          ))}
          {preview[0] && (
            <div className="text-[10px] text-slate-400">
              {sampleSeg.units} حرف · {sampleSeg.encoding === 'UCS-2' ? 'عربي/يونيكود (70 حرف للجزء الواحد، 67 لكل جزء عند التقسيم)' : 'لاتيني GSM (160 / 153)'} · {sampleSeg.segments} جزء
            </div>
          )}
        </div>

        {needsTyped && (
          <div className="p-2.5 rounded-xl bg-indigo-50 border border-indigo-100 text-xs space-y-1" id="confirm-typed-count-box">
            <label htmlFor="confirm-typed-count" className="font-bold text-indigo-800 block">
              إرسال كبير ({estimate.messages} رسالة، الحد {LARGE_SEND_THRESHOLD}). اكتب العدد للتأكيد:
            </label>
            <input
              id="confirm-typed-count"
              type="text"
              inputMode="numeric"
              value={typedCount}
              onChange={e => setTypedCount(e.target.value)}
              placeholder={String(estimate.messages)}
              className="w-full px-2 py-1.5 border border-indigo-200 rounded-md text-sm font-mono text-center"
            />
            {typedCount && !typedOk && <p className="text-rose-600">العدد غير مطابق.</p>}
          </div>
        )}

        <div className="flex gap-2 justify-end pt-2 border-t border-slate-100">
          <button type="button" onClick={onCancel} disabled={locked} className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 cursor-pointer">
            إلغاء
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm}
            id="confirm-send-button"
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
          >
            <Send className="w-4 h-4" />
            {locked ? 'جارٍ التنفيذ…' : (mode === 'now' ? `تأكيد إرسال ${estimate.messages} رسالة` : 'تأكيد الجدولة')}
          </button>
        </div>
      </div>
    </div>
  );
}
