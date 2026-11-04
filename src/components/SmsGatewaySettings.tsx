/**
 * SMS sending settings.
 *
 * Silent sending goes ONLY through the authenticated Supabase Edge Function `school-notify-sms`,
 * which forwards to SMSGate using credentials stored as server secrets. The browser never sees,
 * stores or asks for gateway credentials. The only local preference is the on/off toggle.
 */
import React, { useState } from 'react';
import { SlidersHorizontal, Smartphone, Loader2, ShieldCheck, AlertCircle, Info, Cloud, RefreshCw, Send } from 'lucide-react';
import { readBatchDelaySec, readUseCloudGateway, writeBatchDelaySec, writeUseCloudGateway } from '../lib/smsPrefs';
import { invokeSmsFunction } from '../lib/supabase';
import {
  GATEWAY_STATE_LABELS, countGatewayStates, gatewayCountsText, pollMessageStatus, fetchStatusesOnce, GatewayState, proxyErrorMessage, sendViaProxy, ProxyInvoker,
} from '../lib/smsProxy';
import { segmentInfo } from '../lib/sms';
import { checkPhone, PHONE_PROBLEM_LABELS } from '../lib/phone';

export type GatewayStatus = 'unknown' | 'checking' | 'configured' | 'not_configured' | 'offline' | 'error';

interface SmsGatewaySettingsProps {
  schoolName: string;
  gatewayStatus: GatewayStatus;
  onRefreshStatus: () => void | Promise<void>;
  /** Injected for tests; defaults to the Edge Function. */
  invoke?: ProxyInvoker;
  /** Status polling options (injected for tests). */
  pollOptions?: { intervalMs?: number; timeoutMs?: number };
}

export const NOT_CONFIGURED_MESSAGE =
  'بوابة SMS غير مهيأة بعد على الخادم. يجب على مالك النظام إضافة SMSGATE_USERNAME و SMSGATE_PASSWORD في إعدادات Supabase (Edge Functions › Secrets).';

export default function SmsGatewaySettings({ schoolName, gatewayStatus, onRefreshStatus, invoke = invokeSmsFunction, pollOptions }: SmsGatewaySettingsProps) {
  const [useCloud, setUseCloud] = useState<boolean>(() => readUseCloudGateway());
  // The test phone is intentionally kept in memory only (never persisted).
  const [testPhone, setTestPhone] = useState('');
  const [testState, setTestState] = useState<{ loading: boolean; ok?: boolean; text?: string }>({ loading: false });
  const [delaySec, setDelaySec] = useState<number>(() => readBatchDelaySec());

  const testText = `رسالة تجريبية من نظام الإشعارات المدرسية - ${schoolName}`;
  const seg = segmentInfo(testText);

  const toggle = (v: boolean) => {
    setUseCloud(v);
    writeUseCloudGateway(v);
  };

  const [lastTest, setLastTest] = useState<{ id: string; state: GatewayState } | null>(null);
  const handleRefreshTest = async () => {
    if (!lastTest) return;
    setTestState(prev => ({ ...prev, loading: true }));
    const st = (await fetchStatusesOnce(invoke, new Map([[lastTest.id, lastTest.state]]))).get(lastTest.id)!;
    setLastTest({ id: st.id, state: st.state });
    setTestState({ loading: false, ok: st.state !== 'Failed' && st.state !== 'Cancelled', text: `الحالة: ${GATEWAY_STATE_LABELS[st.state]}${st.error ? `: ${st.error}` : ''}` });
  };

  const handleTestSend = async () => {
    setLastTest(null);
    const check = checkPhone(testPhone);
    if (!check.valid) {
      setTestState({ loading: false, ok: false, text: `رقم غير صالح: ${check.problem ? PHONE_PROBLEM_LABELS[check.problem] : ''}` });
      return;
    }
    if (!window.confirm(`سيتم إرسال رسالة تجريبية واحدة إلى رقم واحد (${seg.segments} جزء SMS). متابعة؟`)) return;
    setTestState({ loading: true });
    const { results, fatalError } = await sendViaProxy(invoke, [{ id: 'test', phone: testPhone, text: testText }]);
    const r = results[0];
    if (r?.ok) {
      if (!r.gatewayMessageId) {
        setTestState({ loading: false, ok: true, text: 'قبلت البوابة الرسالة التجريبية: 1 — الحالة غير متاحة (لم تُرجع البوابة رقم الرسالة).' });
      } else {
        setTestState({ loading: true, ok: true, text: 'قبلت البوابة الرسالة التجريبية: 1 — جاري متابعة حالتها على الهاتف...' });
        const map = await pollMessageStatus(invoke, [r.gatewayMessageId], {
          timeoutMs: 5 * 60_000,
          ...pollOptions,
          onUpdate: m => setTestState({ loading: true, ok: true, text: `قبلت البوابة الرسالة التجريبية: 1 — الحالة: ${GATEWAY_STATE_LABELS[m.get(r.gatewayMessageId!)!.state]}` }),
        });
        const st = map.get(r.gatewayMessageId)!;
        setLastTest({ id: st.id, state: st.state });
        const c = countGatewayStates(map.values());
        setTestState({
          loading: false,
          ok: st.state !== 'Failed' && st.state !== 'Cancelled',
          text: `${gatewayCountsText(c)}. (${GATEWAY_STATE_LABELS[st.state]}${st.error ? `: ${st.error}` : ''})`,
        });
      }
    } else {
      setTestState({ loading: false, ok: false, text: proxyErrorMessage(fatalError || r?.error) });
    }
    void onRefreshStatus();
  };

  const statusBox = (() => {
    switch (gatewayStatus) {
      case 'configured':
        return { cls: 'bg-emerald-50 border-emerald-200 text-emerald-800', text: 'خادم الإرسال يعمل وبوابة SMSGate مهيأة.' };
      case 'not_configured':
        return { cls: 'bg-amber-50 border-amber-200 text-amber-800', text: NOT_CONFIGURED_MESSAGE };
      case 'offline':
        return { cls: 'bg-rose-50 border-rose-200 text-rose-800', text: 'تعذر الوصول إلى خادم الإرسال. تحقق من اتصال الإنترنت.' };
      case 'error':
        return { cls: 'bg-rose-50 border-rose-200 text-rose-800', text: 'تعذر فحص حالة خادم الإرسال. حاول مرة أخرى لاحقاً.' };
      default:
        return { cls: 'bg-slate-50 border-slate-200 text-slate-600', text: 'جاري فحص حالة خادم الإرسال...' };
    }
  })();

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-xs space-y-6" id="sms-gateway-settings" dir="rtl">
      <div className="pb-4 border-b border-slate-100">
        <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
          <SlidersHorizontal className="w-5 h-5 text-indigo-600" />
          تهيئة بث رسائل SMS
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          يتم الإرسال الصامت عبر خادم آمن (Supabase Edge Function) يتحقق من تسجيل دخولك ثم يمرر الرسائل إلى بوابة SMSGate.
          لا تُحفظ أي بيانات دخول للبوابة في المتصفح.
        </p>
      </div>

      {/* Mode */}
      <section className="space-y-3">
        <h3 className="font-bold text-slate-700 text-sm">طريقة الإرسال</h3>
        <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer">
          <input type="radio" name="sms-mode" checked={useCloud} onChange={() => toggle(true)} id="mode-cloud" className="mt-0.5" />
          <span><Cloud className="w-4 h-4 inline text-indigo-600" /> إرسال صامت تلقائي عبر خادم SMS السحابي (SMSGate)</span>
        </label>
        <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer">
          <input type="radio" name="sms-mode" checked={!useCloud} onChange={() => toggle(false)} id="mode-manual" className="mt-0.5" />
          <span><Smartphone className="w-4 h-4 inline text-slate-600" /> إرسال يدوي من تطبيق الرسائل على الهاتف (رسالة تلو الأخرى)</span>
        </label>
      </section>

      {/* Server status */}
      <section className="space-y-3 pt-4 border-t border-slate-100">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-slate-700 text-sm">حالة خادم الإرسال</h3>
          <button
            type="button"
            onClick={() => void onRefreshStatus()}
            className="text-xs font-bold text-indigo-700 flex items-center gap-1 cursor-pointer"
            id="btn-refresh-gateway-status"
          >
            {gatewayStatus === 'checking' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            فحص الحالة
          </button>
        </div>
        <div className={`p-3 rounded-lg border text-xs flex items-start gap-2 ${statusBox.cls}`} id="gateway-status-box" data-status={gatewayStatus}>
          {gatewayStatus === 'configured' ? <ShieldCheck className="w-4 h-4 shrink-0" /> : <Info className="w-4 h-4 shrink-0" />}
          <span>{statusBox.text}</span>
        </div>
      </section>

      {/* Batch pacing */}
      <section className="space-y-2 pt-4 border-t border-slate-100">
        <h3 className="font-bold text-slate-700 text-sm">سرعة الإرسال الجماعي</h3>
        <p className="text-xs text-slate-500">
          تُرسل الرسائل على دفعات صغيرة (5 رسائل لكل دفعة) مع انتظار بين كل دفعة وأخرى (الافتراضي ثانيتان)، لتجنّب حدود الهاتف أو الشريحة.
          إذا ظهر خطأ RESULT_RIL_MODEM_ERR أو فشل متكرر، زِد الانتظار هنا أو في إعدادات تطبيق SMSGate على الهاتف.
        </p>
        <label className="flex items-center gap-2 text-xs text-slate-700">
          الانتظار بين الدفعات (ثانية):
          <input
            type="number"
            min={0}
            max={300}
            value={delaySec}
            onChange={e => {
              const n = Number(e.target.value);
              setDelaySec(n);
              writeBatchDelaySec(n);
            }}
            className="border border-slate-300 rounded-lg px-2 py-1 text-xs w-20"
            id="input-batch-delay"
          />
        </label>
      </section>

      {/* Test send */}
      <section className="space-y-3 pt-4 border-t border-slate-100">
        <h3 className="font-bold text-slate-700 text-sm">إرسال رسالة تجريبية</h3>
        <p className="text-xs text-slate-500">
          نص الرسالة: «{testText}» — {seg.units} حرف، {seg.segments} جزء SMS.
        </p>
        <div className="flex flex-wrap gap-2 items-center">
          <input
            type="tel"
            dir="ltr"
            value={testPhone}
            onChange={e => setTestPhone(e.target.value)}
            placeholder="05XXXXXXXX"
            className="border border-slate-300 rounded-lg px-3 py-2 text-xs w-48"
            id="input-test-phone"
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => void handleTestSend()}
            disabled={testState.loading || !testPhone.trim()}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-xs font-bold rounded-lg flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed"
            id="btn-test-send"
          >
            {testState.loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            إرسال تجريبي
          </button>
          {lastTest && (
            <button
              type="button"
              onClick={() => void handleRefreshTest()}
              disabled={testState.loading}
              className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-100 disabled:opacity-40 text-slate-700 text-xs font-bold rounded-lg cursor-pointer"
              id="btn-refresh-test-status"
            >
              تحديث الحالة
            </button>
          )}
        </div>
        {testState.text && (
          <div
            className={`p-3 rounded-lg text-xs flex items-start gap-2 ${testState.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}
            id="test-send-result"
          >
            {testState.ok ? <ShieldCheck className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
            <span>{testState.text}</span>
          </div>
        )}
      </section>
    </div>
  );
}
