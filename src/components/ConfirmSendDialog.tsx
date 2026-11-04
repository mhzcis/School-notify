import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Send, X } from 'lucide-react';
import SecretText from './SecretText';
import { estimateCampaign, segmentInfo } from '../lib/sms';
import { UI_PREF_KEYS } from '../lib/smsPrefs';

export interface ConfirmSendDialogProps {
  open: boolean;
  mode: 'now' | 'schedule';
  /** number of selected students */
  studentCount: number;
  /** rendered message bodies, one per phone number that will receive a message */
  contents: string[];
  /** numbers excluded because they are missing/invalid */
  excludedCount: number;
  /** a sample rendered message (first recipient) */
  sampleText: string;
  /** Sample with secrets masked (shown by default; the real text is shown on demand). */
  sampleMaskedText?: string;
  /** Recipients whose Moodle placeholders will render empty. */
  missingMoodleCount?: number;
  sampleRecipientLabel?: string;
  scheduledLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Pre-send confirmation: shows how many messages will go out, SMS parts (Arabic = 70/67 per part),
 * an optional price-per-part cost estimate and a preview of a real rendered message.
 */
export default function ConfirmSendDialog(props: ConfirmSendDialogProps) {
  const { open, mode, studentCount, contents, excludedCount, sampleText, sampleMaskedText, missingMoodleCount = 0, sampleRecipientLabel, scheduledLabel, onConfirm, onCancel } = props;
  const [price, setPrice] = useState<string>(() => {
    try { return localStorage.getItem(UI_PREF_KEYS.smsSegmentPrice) || ''; } catch { return ''; }
  });

  useEffect(() => {
    try { localStorage.setItem(UI_PREF_KEYS.smsSegmentPrice, price); } catch { /* ignore */ }
  }, [price]);

  const priceNum = price.trim() === '' ? null : Number(price);
  const estimate = useMemo(() => estimateCampaign(contents, priceNum), [contents, priceNum]);
  const sampleSeg = segmentInfo(sampleText);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4" dir="rtl" id="confirm-send-dialog">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-black text-slate-800">
            {mode === 'now' ? 'تأكيد الإرسال الآن' : 'تأكيد جدولة الحملة'}
          </h3>
          <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-600 cursor-pointer" aria-label="إغلاق">
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

        {scheduledLabel && (
          <div className="text-xs text-slate-600">موعد الجدولة: <strong>{scheduledLabel}</strong> — ملاحظة: الحملات المجدولة لا تُرسل تلقائياً، يجب فتح التطبيق وإرسالها يدوياً في موعدها.</div>
        )}

        <div className="space-y-1">
          <div className="text-xs font-bold text-slate-600">
            معاينة رسالة فعلية{sampleRecipientLabel ? ` (${sampleRecipientLabel})` : ''}:
          </div>
          <div className="p-3 rounded-xl bg-emerald-50/50 border border-emerald-100 text-xs text-slate-800 whitespace-pre-wrap" id="confirm-sample-preview">
            {sampleText ? <SecretText block value={sampleText} maskedValue={sampleMaskedText ?? sampleText} /> : '—'}
          </div>
          <div className="text-[10px] text-slate-400">
            {sampleSeg.units} حرف · {sampleSeg.encoding === 'UCS-2' ? 'عربي/يونيكود (70 حرف للجزء الواحد، 67 لكل جزء عند التقسيم)' : 'لاتيني GSM (160 / 153)'} · {sampleSeg.segments} جزء
          </div>
        </div>

        <div className="flex gap-2 justify-end pt-2 border-t border-slate-100">
          <button type="button" onClick={onCancel} className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 cursor-pointer">
            إلغاء
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={estimate.messages === 0}
            id="confirm-send-button"
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
          >
            <Send className="w-4 h-4" />
            {mode === 'now' ? `تأكيد إرسال ${estimate.messages} رسالة` : 'تأكيد الجدولة'}
          </button>
        </div>
      </div>
    </div>
  );
}
