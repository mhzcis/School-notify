import React, { useState, useEffect } from 'react';
import { readObject } from '../lib/storage';
import { gatewayBlockReason, SERVER_PROXY_AVAILABLE } from '../lib/hosting';
import { 
  SlidersHorizontal, 
  Smartphone, 
  Loader2, 
  Check, 
  ShieldCheck, 
  AlertCircle, 
  Info,
  Server,
  Cloud,
  Wifi,
  Copy,
  RefreshCw,
  Key,
  Database,
  Trash2
} from 'lucide-react';

interface SmsGatewaySettingsProps {
  schoolName: string;
}

export default function SmsGatewaySettings({ schoolName }: SmsGatewaySettingsProps) {
  // 1. SILENT HANDS-FREE API GATEWAY CONFIGS
  const [useSilentGateway, setUseSilentGateway] = useState<boolean>(() => {
    return localStorage.getItem('resal_use_silent_gateway') === 'true';
  });

  const [silentGatewayConfig, setSilentGatewayConfig] = useState<{
    name: string;
    apiUrl: string;
    method: 'GET' | 'POST';
    headers: string;
    body: string;
    testPhone: string;
    gatewayType: 'android_local' | 'custom_api';
    androidIp: string;
    androidAppType: 'sms_gateway_core' | 'android_sms_server' | 'sms_gate_app' | 'sms_gate_cloud' | 'custom' | 'android_custom_gateway';
    smsGateCloudToken?: string;
    smsGateCloudUsername?: string;
    smsGateCloudPassword?: string;
    smsGateLocalToken?: string;
    smsGateLocalUsername?: string;
    smsGateLocalPassword?: string;
    androidCustomApiKey?: string;
  }>(() => {
    const parsed: any = readObject<Record<string, any>>('resal_silent_gateway_config', {});
    return {
      name: parsed.name || 'بوابة الـ API المدرسية المستقلة',
      apiUrl: parsed.apiUrl || 'http://192.168.1.50:8080/send?phone={{PHONE}}&message={{MESSAGE}}',
      method: parsed.method || 'GET',
      headers: parsed.headers || '{\n  "Content-Type": "application/json"\n}',
      body: parsed.body || '{\n  "phone": "{{PHONE}}",\n  "text": "{{MESSAGE}}"\n}',
      testPhone: parsed.testPhone || '0599000000',
      gatewayType: parsed.gatewayType || 'android_local',
      androidIp: parsed.androidIp || '192.168.1.15',
      androidAppType: parsed.androidAppType || 'android_custom_gateway', // default to our beautiful new custom gateway
      smsGateCloudToken: parsed.smsGateCloudToken || '',
      smsGateCloudUsername: parsed.smsGateCloudUsername || '',
      smsGateCloudPassword: parsed.smsGateCloudPassword || '',
      smsGateLocalToken: parsed.smsGateLocalToken || '',
      smsGateLocalUsername: parsed.smsGateLocalUsername || '',
      smsGateLocalPassword: parsed.smsGateLocalPassword || '',
      androidCustomApiKey: parsed.androidCustomApiKey || ''
    };
  });

  const [testSendingStatus, setTestSendingStatus] = useState<{
    loading: boolean;
    success?: boolean;
    text?: string;
  }>({ loading: false });

  // Custom Android SMS Gateway monitoring states
  const [serverConfig, setServerConfig] = useState<{
    androidCustomApiKey: string;
    lastActiveTimestamp: number | null;
    pendingCount: number;
    sendingCount: number;
    sentCount: number;
    failedCount: number;
    queue: Array<{
      id: number;
      phoneNumber: string;
      message: string;
      studentName?: string;
      status: 'pending' | 'sending' | 'sent' | 'failed';
      errorMessage?: string | null;
      timestamp: number;
      updatedAt?: number;
    }>;
  } | null>(null);

  const [apiSaving, setApiSaving] = useState(false);
  const [queueClearing, setQueueClearing] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Sync states to LocalStorage
  useEffect(() => {
    localStorage.setItem('resal_use_silent_gateway', String(useSilentGateway));
  }, [useSilentGateway]);

  useEffect(() => {
    localStorage.setItem('resal_silent_gateway_config', JSON.stringify(silentGatewayConfig));
  }, [silentGatewayConfig]);

  // Fetch queue & config details from server for monitoring
  const fetchServerConfig = async () => {
    if (!SERVER_PROXY_AVAILABLE) return; // static hosting: no /api backend
    try {
      const res = await fetch('/api/sms/config');
      if (res.ok) {
        const data = await res.json();
        setServerConfig(data);
      }
    } catch (e) {
      console.error("Error fetching server config:", e);
    }
  };

  useEffect(() => {
    fetchServerConfig();
    const interval = setInterval(fetchServerConfig, 5000); // refresh every 5 seconds
    return () => clearInterval(interval);
  }, []);

  const handleSaveApiKey = async () => {
    if (!SERVER_PROXY_AVAILABLE) {
      alert('لا يوجد خادم في النسخة المنشورة على GitHub Pages، لذلك لا يمكن حفظ رمز الأمان على الخادم حالياً.');
      return;
    }
    setApiSaving(true);
    try {
      const response = await fetch('/api/sms/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: silentGatewayConfig.androidCustomApiKey || '' })
      });
      const data = await response.json();
      if (response.ok && data.success) {
        alert('✅ تم حفظ وتأكيد رمز الأمان بنجاح على السيرفر! يرجى إدخال نفس الرمز تماماً في إعدادات التطبيق بهاتفك الأندرويد.');
        fetchServerConfig();
      } else {
        alert('❌ فشل حفظ رمز الأمان على السيرفر: ' + (data.message || 'خطأ غير معروف'));
      }
    } catch (e: any) {
      alert('❌ فشل الاتصال بالسيرفر لحفظ رمز الأمان: ' + e.message);
    } finally {
      setApiSaving(false);
    }
  };

  const handleClearQueue = async () => {
    if (!SERVER_PROXY_AVAILABLE) return;
    if (!window.confirm('هل أنت متأكد من رغبتك في تصفية طابور الرسائل بالكامل؟ سيتم مسح الرسائل المعلقة والقديمة من السيرفر.')) return;
    setQueueClearing(true);
    try {
      const res = await fetch('/api/sms/clear-queue', { method: 'POST' });
      if (res.ok) {
        fetchServerConfig();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setQueueClearing(false);
    }
  };

  const copyToClipboard = (text: string, fieldName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 3000);
  };

  // Formats phone numbers into clean international format
  const formatPhoneWithPlus = (phone: string): string => {
    if (!phone) return '';
    let clean = phone.trim().replace(/\+/g, '').replace(/\s+/g, '');
    if (clean.startsWith('05')) {
      clean = '970' + clean.substring(1);
    }
    if (clean.startsWith('00')) {
      return '+' + clean.substring(2);
    }
    if (!clean.startsWith('+')) {
      return '+' + clean;
    }
    return clean;
  };

  const testSilentGatewayConnection = async () => {
    const blockReason = gatewayBlockReason(silentGatewayConfig);
    if (blockReason) {
      setTestSendingStatus({ loading: false, success: false, text: `⚠️ ${blockReason}` });
      return;
    }
    if (silentGatewayConfig.androidAppType === 'android_custom_gateway') {
      setTestSendingStatus({ loading: true });
      try {
        const response = await fetch('/api/send-sms', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            phone: silentGatewayConfig.testPhone,
            message: `رسالة فحص وتأكيد نجاح الربط مع مساعد SMS المدرسي - ${schoolName}`,
            studentName: 'طالب افتراضي فحص',
            customGateway: {
              androidAppType: 'android_custom_gateway'
            }
          })
        });

        const resData = await response.json();
        if (response.ok && resData.success) {
          setTestSendingStatus({
            loading: false,
            success: true,
            text: `✓ رائع! تم إدراج رسالة الفحص بنجاح في السيرفر (المعرف: ${resData.messageId}). سيقوم تطبيق "مساعد SMS المدرسي" بسحبها تلقائياً عند قيامه بعملية الـ Polling التالية من هاتفك وبثها كرسالة نصية.`
          });
          fetchServerConfig();
        } else {
          setTestSendingStatus({
            loading: false,
            success: false,
            text: `⚠️ عذراً: فشل إدراج رسالة الفحص: ${resData.message || 'رمز خطأ مجهول'}`
          });
        }
      } catch (err: any) {
        setTestSendingStatus({
          loading: false,
          success: false,
          text: `❌ عذراً: فشل الاتصال بخدمة الرسائل بالسيرفر: ${err.message || String(err)}`
        });
      }
      return;
    }

    if (silentGatewayConfig.gatewayType === 'android_local') {
      if (silentGatewayConfig.androidAppType === 'sms_gate_cloud') {
        const username = silentGatewayConfig.smsGateCloudUsername || "";
        const password = silentGatewayConfig.smsGateCloudPassword || "";
        if (!username.trim() || !password.trim()) {
          return alert('الرجاء كتابة اسم المستخدم وكلمة المرور الخاصة بسحابة SMSGate أولاً.');
        }
        setTestSendingStatus({ loading: true });
        try {
          const response = await fetch('/api/send-sms', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              phone: silentGatewayConfig.testPhone,
              message: `رسالة فحص وتأكيد نجاح الاتصال ببوابتك الذكية - ${schoolName}`,
              studentName: 'طالب افتراضي فحص',
              customGateway: {
                androidAppType: 'sms_gate_cloud',
                smsGateCloudUsername: username.trim(),
                smsGateCloudPassword: password.trim()
              }
            })
          });

          const resData = await response.json();
          if (response.ok && resData.success) {
            setTestSendingStatus({
              loading: false,
              success: true,
              text: `✓ رائع! نجح الاتصال السحابي وتم إرسال رسالة الفحص إلى سحابة SMSGate بنجاح لـ (${schoolName}). يرجى مراجعة هاتفك للتأكد من وصولها.`
            });
          } else {
            setTestSendingStatus({
              loading: false,
              success: false,
              text: `⚠️ عذراً: سيرفر SMSGate Cloud أعاد كود خطأ: ${resData.message || 'رمز خطأ مجهول'}`
            });
          }
        } catch (err: any) {
          setTestSendingStatus({
            loading: false,
            success: false,
            text: `❌ عذراً: فشل الاتصال بخادم الرسائل السحابي: ${err.message || String(err)}`
          });
        }
        return;
      }

      // Local WiFi SMSGate Mode
      if (!silentGatewayConfig.androidIp.trim()) {
        return alert('الرجاء إدخال عنوان الـ IP المحلي لهاتفك الخاص بـ SMSGate أولاً.');
      }
      setTestSendingStatus({ loading: true });
      try {
        let cleanIp = silentGatewayConfig.androidIp.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
        if (!cleanIp.includes(':')) {
          cleanIp = cleanIp + ':8080';
        }
        
        const localUrl = `http://${cleanIp}/message`;
        const headers: Record<string, string> = {
          'Content-Type': 'application/json'
        };
        const username = silentGatewayConfig.smsGateLocalUsername || '';
        const password = silentGatewayConfig.smsGateLocalPassword || '';
        if (username.trim() || password.trim()) {
          headers['Authorization'] = `Basic ${btoa(username.trim() + ':' + password.trim())}`;
        }

        const formattedPhone = formatPhoneWithPlus(silentGatewayConfig.testPhone);

        const requestOptions = {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({
            textMessage: { text: `رسالة فحص الاتصال المحلي للبوابة - ${schoolName}` },
            phoneNumbers: [formattedPhone]
          })
        };

        await fetch(localUrl, requestOptions);

        setTestSendingStatus({
          loading: false,
          success: true,
          text: `✓ تم إرسال طلب الفحص بنجاح من متصفحك إلى الجوال محلياً لـ (${schoolName})! يرجى فحص هاتفك للتأكد من وصول الرسالة عبر تطبيق SMSGate.`
        });
      } catch (err: any) {
        setTestSendingStatus({
          loading: false,
          success: false,
          text: `❌ عذراً: فشل الاتصال بجوال الأندرويد محلياً. تأكد أن الهاتف موصول بنفس شبكة الـ Wi-Fi، وأن تطبيق SMSGate قيد التشغيل، وأنك قمت بتعديل أمان المحتوى لـ "Insecure Content" بالمتصفح: ${err.message || String(err)}`
        });
      }
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm text-right space-y-6 animate-fade-in" dir="rtl" id="sms-gateway-settings-panel">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
        <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl">
          <SlidersHorizontal className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-slate-800 font-sans">تهيئة وإعداد بث رسائل SMS</h2>
          <p className="text-xs text-slate-500 font-medium">قم بتهيئة وتنشيط بوابة البث عبر هاتف الأندرويد لتمكين الإرسال الفوري والصامت</p>
        </div>
      </div>

      {!SERVER_PROXY_AVAILABLE && (
        <div className="p-4 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 text-xs leading-6 space-y-1" id="static-hosting-gateway-notice" role="alert">
          <div className="font-bold text-sm">⚠️ تنبيه: النسخة المنشورة على GitHub Pages تعمل بدون خادم</div>
          <div>• <b>الإرسال اليدوي عبر واتساب/SMS</b> (فتح الرسائل واحدة تلو الأخرى) يعمل بشكل كامل.</div>
          <div>• <b>سحابة SMSGate</b> و<b>مساعد SMS المدرسي (طابور الخادم)</b> غير متاحين حالياً: يلزم وسيط خادم (Proxy) سيُضاف لاحقاً عبر Supabase.</div>
          <div>• <b>SMSGate المحلي (http://IP-الجوال)</b> يحجبه المتصفح من موقع https، ويعمل فقط إذا فُتح التطبيق محلياً عبر http على نفس الشبكة.</div>
          <div>• بيانات الدخول المدخلة هنا تُحفظ في متصفحك فقط (localStorage) كنص عادي.</div>
      </div>
      )}

      {/* Main Feature Toggle Card */}
      <div className={`p-5 rounded-2xl border transition duration-200 ${
        useSilentGateway 
          ? 'bg-emerald-50/40 border-emerald-200/80 text-emerald-950' 
          : 'bg-slate-50/50 border-slate-200 text-slate-700'
      }`}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1">
            <h3 className="text-sm font-black flex items-center gap-2">
              <ShieldCheck className={`w-5 h-5 ${useSilentGateway ? 'text-emerald-600' : 'text-slate-400'}`} />
              تنشيط بوابة الإرسال الصامت والتلقائي عبر الهاتف (SMSGate)
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed font-sans max-w-2xl">
              عند التفعيل، سيقوم النظام ببث الرسائل دفعة واحدة مباشرة صامتاً عبر الجوال دون الحاجة لتأكيد الإرسال اليدوي لكل رسالة فردية أو فتح نوافذ منبثقة. عند الإغلاق، سيتحول النظام تلقائياً لوضع البث اليدوي المتتابع والآمن.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setUseSilentGateway(prev => !prev)}
            className={`px-5 py-2.5 rounded-xl font-bold text-xs shadow-xs transition duration-200 cursor-pointer text-center shrink-0 ${
              useSilentGateway 
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white' 
                : 'bg-indigo-650 hover:bg-indigo-700 text-white'
            }`}
          >
            {useSilentGateway ? '✓ البوابة الصامتة نشطة ومفعلة' : 'تفعيل البوابة الصامتة الآن'}
          </button>
        </div>
      </div>

      {/* Instruction/Setup steps Accordion or Info Board */}
      <div className="bg-indigo-50/40 border border-indigo-100 p-5 rounded-xl space-y-4">
        <h4 className="text-xs font-black text-indigo-900 flex items-center gap-1.5">
          <span>💡</span>
          <span>كيف أقوم بربط جوالي لتفعيل ميزة الإرسال صامتاً؟ (دليل خطوة بخطوة)</span>
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs leading-relaxed text-slate-650 font-sans">
          <div className="bg-white p-3.5 rounded-xl border border-slate-100 shadow-3xs">
            <strong className="text-indigo-800 block mb-1">1. تنزيل التطبيق المجاني:</strong>
            افتح متجر التطبيقات على هاتف الأندرويد وقم بتنزيل تطبيق الربط المباشر:
            <strong className="text-slate-800 block mt-1 font-bold">"SMSGate (sms-gate.app)"</strong>
          </div>
          <div className="bg-white p-3.5 rounded-xl border border-slate-100 shadow-3xs">
            <strong className="text-indigo-800 block mb-1">2. اختر وضع الإرسال المناسب:</strong>
            إما **الوضع السحابي (Cloud Mode)** الأكثر استقراراً وموثوقية، أو **الوضع المحلي (Local Server)** العامل في نطاق شبكة الـ Wi-Fi.
          </div>
          <div className="bg-white p-3.5 rounded-xl border border-slate-100 shadow-3xs">
            <strong className="text-emerald-800 block mb-1 font-bold">3. أدخل البيانات وباشر البث:</strong>
            أدخل بيانات الدخول والـ IP بالأسفل، وسيبث النظام إشعارات أولياء الأمور مخصومة من رصيد باقة شريحة هاتفك مباشرة!
          </div>
        </div>
      </div>

      {/* Configuration Settings Box */}
      <div className="border border-slate-150 rounded-2xl overflow-hidden">
        <div className="bg-slate-50 border-b border-slate-150 p-4">
          <label className="block text-xs font-black text-slate-700 mb-1 flex items-center gap-1.5">
            <Smartphone className="w-4 h-4 text-slate-500" />
            <span>طريقة بث رسائل SMS المحجوزة في جوالك الأندرويد:</span>
          </label>
          <select
            value={silentGatewayConfig.androidAppType}
            onChange={e => {
              const val = e.target.value as any;
              setSilentGatewayConfig(prev => ({
                ...prev,
                androidAppType: val,
                gatewayType: 'android_local'
              }));
            }}
            className="w-full sm:max-w-md px-3 py-2.5 border border-slate-200 rounded-xl text-xs outline-hidden focus:border-indigo-500 bg-white cursor-pointer font-bold text-indigo-900 shadow-3xs"
          >
            <option value="android_custom_gateway">📱 تطبيق "مساعد SMS المدرسي" الخاص بك (سحب سحابي تلقائي صامت 🚀)</option>
            <option value="sms_gate_cloud">☁️ تطبيق SMSGate (الوضع السحابي الذكي - إرسال فوري وآمن 🌟)</option>
            <option value="sms_gate_app">📡 تطبيق SMSGate (الوضع المحلي المباشر عبر شبكة الواي فاي 📲)</option>
          </select>
          <span className="text-[10px] text-slate-400 mt-1.5 block leading-relaxed font-sans">
            * يوصى بشدة بـ <strong>تطبيق "مساعد SMS المدرسي" المخصص</strong> لكونه يعمل بصورة تلقائية وخلفية مستمرة، ويقوم بعملية Polling دورية لسحب الرسائل من سيرفر المنصة وبثها مجاناً من باقة شريحة هاتفك.
          </span>
        </div>

        <div className="p-5 space-y-4">
          {/* Unified configuration inputs */}
          {silentGatewayConfig.androidAppType === 'android_custom_gateway' ? (
            <div className="space-y-5 text-right font-sans">
              {/* 1. API Endpoints for Copying */}
              <div className="bg-slate-50 border border-slate-150 rounded-xl p-4 space-y-4">
                <h6 className="text-xs font-black text-slate-800 flex items-center gap-1.5 border-b border-slate-100 pb-2">
                  <Server className="w-4 h-4 text-indigo-600" />
                  <span>عناوين الربط لتطبيق "مساعد SMS المدرسي" (API Endpoints):</span>
                </h6>
                
                <div className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="font-bold text-slate-700">1. رابط جلب الرسائل المعلقة (GET / Fetch):</span>
                      <span className="text-emerald-700 font-bold font-mono text-[9px] bg-emerald-50 px-1.5 py-0.5 rounded">GET</span>
                    </div>
                    <div className="flex gap-2 items-center">
                      <input
                        type="text"
                        readOnly
                        value={`${window.location.origin}/api/sms/pending`}
                        className="w-full bg-white border border-slate-200 px-3 py-1.5 rounded-lg text-xs font-mono text-indigo-900 outline-hidden"
                        dir="ltr"
                      />
                      <button
                        type="button"
                        onClick={() => copyToClipboard(`${window.location.origin}/api/sms/pending`, 'pendingUrl')}
                        className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-750 rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer shrink-0"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>{copiedField === 'pendingUrl' ? 'تم النسخ!' : 'نسخ'}</span>
                      </button>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="font-bold text-slate-700">2. رابط تحديث حالة الإرسال (POST / Status Report):</span>
                      <span className="text-blue-700 font-bold font-mono text-[9px] bg-blue-50 px-1.5 py-0.5 rounded">POST</span>
                    </div>
                    <div className="flex gap-2 items-center">
                      <input
                        type="text"
                        readOnly
                        value={`${window.location.origin}/api/sms/status`}
                        className="w-full bg-white border border-slate-200 px-3 py-1.5 rounded-lg text-xs font-mono text-indigo-900 outline-hidden"
                        dir="ltr"
                      />
                      <button
                        type="button"
                        onClick={() => copyToClipboard(`${window.location.origin}/api/sms/status`, 'statusUrl')}
                        className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-750 rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer shrink-0"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>{copiedField === 'statusUrl' ? 'تم النسخ!' : 'نسخ'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* 2. Security Key Configuration */}
              <div className="bg-amber-50/25 border border-amber-200/50 rounded-xl p-4 space-y-3">
                <h6 className="text-xs font-black text-amber-950 flex items-center gap-1.5">
                  <Key className="w-4 h-4 text-amber-600" />
                  <span>مفتاح الأمان السري للربط (API Security Key / Bearer Token):</span>
                </h6>
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  يجب كتابة هذا الرمز نفسه في إعدادات تطبيق الهاتف (Android App) في خانة <strong>API Key</strong> لضمان المصادقة وحماية البيانات.
                </p>
                
                <div className="flex gap-2 items-center flex-wrap sm:flex-nowrap">
                  <input
                    type="text"
                    value={silentGatewayConfig.androidCustomApiKey || ''}
                    onChange={e => {
                      const val = e.target.value;
                      setSilentGatewayConfig(prev => ({ ...prev, androidCustomApiKey: val }));
                    }}
                    placeholder="أدخل رمز أمان قوي وطويل خاص بك"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono outline-hidden focus:border-amber-500 bg-white"
                    dir="ltr"
                  />
                  <button
                    type="button"
                    disabled={apiSaving}
                    onClick={handleSaveApiKey}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg transition shrink-0 cursor-pointer flex items-center gap-1"
                  >
                    {apiSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    <span>تأكيد وحفظ المفتاح</span>
                  </button>
                </div>
              </div>

              {/* 3. Monitoring Board */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {/* Last Active */}
                <div className="col-span-2 bg-indigo-50/30 border border-indigo-100 rounded-xl p-3 text-right flex flex-col justify-center">
                  <span className="text-[10px] text-indigo-950 font-bold block mb-1">📱 حالة اتصال التطبيق بالجوال</span>
                  {serverConfig && serverConfig.lastActiveTimestamp ? (
                    <div className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse shrink-0"></span>
                      <span className="text-xs font-bold text-emerald-800">
                        {Date.now() - serverConfig.lastActiveTimestamp < 60000 
                          ? "نشط متصل حالياً" 
                          : `آخر اتصال: ${new Date(serverConfig.lastActiveTimestamp).toLocaleTimeString('ar-EG')}`}
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 bg-slate-300 rounded-full shrink-0"></span>
                      <span className="text-xs font-bold text-slate-500">في انتظار أول اتصال...</span>
                    </div>
                  )}
                </div>

                {/* Pending count */}
                <div className="bg-amber-50/40 border border-amber-100 rounded-xl p-3">
                  <span className="text-[10px] text-amber-950 font-bold block mb-0.5">⏳ قيد الانتظار</span>
                  <span className="text-lg font-black text-amber-700">{serverConfig?.pendingCount ?? 0}</span>
                </div>

                {/* Sending/Processing count */}
                <div className="bg-sky-50/40 border border-sky-100 rounded-xl p-3">
                  <span className="text-[10px] text-sky-950 font-bold block mb-0.5">⚡ جاري الإرسال</span>
                  <span className="text-lg font-black text-sky-700">{serverConfig?.sendingCount ?? 0}</span>
                </div>

                {/* Sent + Failed count */}
                <div className="bg-emerald-50/30 border border-emerald-100 rounded-xl p-3">
                  <span className="text-[10px] text-emerald-950 font-bold block mb-0.5">✓ تم / ⚠️ فشل</span>
                  <span className="text-sm font-black text-emerald-800">
                    {serverConfig?.sentCount ?? 0} / <span className="text-rose-600">{serverConfig?.failedCount ?? 0}</span>
                  </span>
                </div>
              </div>

              {/* 4. Queue / Logs list */}
              <div className="border border-slate-100 rounded-xl overflow-hidden bg-white shadow-3xs">
                <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
                  <div className="text-[11px] font-black text-slate-750 flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5 text-indigo-600" />
                    <span>طابور الرسائل المجدولة (آخر 50 رسالة):</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={fetchServerConfig}
                      className="p-1 hover:bg-slate-200 text-slate-600 rounded transition cursor-pointer"
                      title="تحديث البيانات"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={queueClearing}
                      onClick={handleClearQueue}
                      className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-100 rounded-lg text-[10px] font-bold transition cursor-pointer flex items-center gap-1 shrink-0"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>تصفية الطابور</span>
                    </button>
                  </div>
                </div>

                <div className="max-h-[220px] overflow-y-auto">
                  {serverConfig && serverConfig.queue && serverConfig.queue.length > 0 ? (
                    <table className="w-full text-right border-collapse text-[11px]">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 text-[10px]">
                          <th className="p-2 text-center w-12 font-black">المعرف</th>
                          <th className="p-2 font-black">رقم الهاتف</th>
                          <th className="p-2 font-black">نص الرسالة</th>
                          <th className="p-2 font-black text-center w-24">الحالة</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50 font-sans">
                        {[...serverConfig.queue].reverse().map((t) => (
                          <tr key={t.id} className="hover:bg-slate-50/50">
                            <td className="p-2 text-center font-mono font-semibold text-slate-500">{t.id}</td>
                            <td className="p-2 font-mono font-bold text-indigo-950">{t.phoneNumber}</td>
                            <td className="p-2 text-slate-600 truncate max-w-[200px]" title={t.message}>
                              {t.studentName ? <span className="text-[10px] font-bold bg-indigo-50 text-indigo-700 px-1 py-0.5 rounded ml-1">{t.studentName}</span> : null}
                              {t.message}
                            </td>
                            <td className="p-2 text-center">
                              {t.status === 'pending' && <span className="px-2 py-0.5 bg-amber-105 text-amber-800 rounded-full font-bold text-[9px]">⏳ قيد الانتظار</span>}
                              {t.status === 'sending' && <span className="px-2 py-0.5 bg-sky-100 text-sky-800 rounded-full font-bold text-[9px] animate-pulse">⚡ جاري البث</span>}
                              {t.status === 'sent' && <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-full font-bold text-[9px]">✓ تم الإرسال</span>}
                              {t.status === 'failed' && (
                                <span 
                                  className="px-2 py-0.5 bg-rose-105 text-rose-800 rounded-full font-bold text-[9px] cursor-help inline-block"
                                  title={t.errorMessage || 'فشل مجهول'}
                                >
                                  ⚠️ فشل
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="p-8 text-center text-slate-400 text-xs font-medium">
                      لا يوجد أي رسائل معلقة أو مرسلة حالياً في طابور مساعد SMS المدرسي.
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-emerald-50/20 p-4 rounded-xl border border-emerald-100/60 text-right space-y-4">
              <h5 className="text-xs font-bold text-emerald-950 border-b border-emerald-100 pb-2 flex items-center gap-1.5">
                {silentGatewayConfig.androidAppType === 'sms_gate_cloud' ? (
                  <>
                    <Cloud className="w-4 h-4 text-emerald-600" />
                    <span>إعدادات الدخول والربط السحابي لـ SMSGate (Cloud API Setup):</span>
                  </>
                ) : (
                  <>
                    <Wifi className="w-4 h-4 text-emerald-600" />
                    <span>إعدادات الدخول والربط المحلي لـ SMSGate (WiFi Local Server Setup):</span>
                  </>
                )}
              </h5>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {silentGatewayConfig.androidAppType !== 'sms_gate_cloud' && (
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      عنوان IP الجوال المعروض في التطبيق (Device Local IP):
                    </label>
                    <input
                      type="text"
                      value={silentGatewayConfig.androidIp}
                      onChange={e => setSilentGatewayConfig(prev => ({ ...prev, androidIp: e.target.value }))}
                      placeholder="مثال: 192.168.1.15"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono outline-hidden focus:border-indigo-500 bg-white"
                      dir="ltr"
                    />
                    <span className="text-[9px] text-slate-400 block mt-1">* الصق الـ IP الظاهر في شاشة التطبيق بهاتفك.</span>
                  </div>
                )}

                {silentGatewayConfig.androidAppType === 'sms_gate_cloud' ? (
                  <>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1">
                        <span>👤</span>
                        <span>اسم مستخدم السحابة (Cloud Username):</span>
                      </label>
                      <input
                        type="text"
                        value={silentGatewayConfig.smsGateCloudUsername || ''}
                        onChange={e => setSilentGatewayConfig(prev => ({ ...prev, smsGateCloudUsername: e.target.value }))}
                        placeholder="مثال: cloud_user@myschool.com"
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono outline-hidden focus:border-emerald-500 bg-white"
                        dir="ltr"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-750 mb-1 flex items-center gap-1">
                        <span>🔑</span>
                        <span>كلمة مرور السحابة (Cloud Password):</span>
                      </label>
                      <input
                        type="password"
                        value={silentGatewayConfig.smsGateCloudPassword || ''}
                        onChange={e => setSilentGatewayConfig(prev => ({ ...prev, smsGateCloudPassword: e.target.value }))}
                        placeholder="أدخل كلمة مرور حساب السحابة"
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono outline-hidden focus:border-emerald-500 bg-white"
                        dir="ltr"
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1">
                        <span>👤</span>
                        <span>اسم مستخدم المحلي (Local Username):</span>
                      </label>
                      <input
                        type="text"
                        value={silentGatewayConfig.smsGateLocalUsername || ''}
                        onChange={e => setSilentGatewayConfig(prev => ({ ...prev, smsGateLocalUsername: e.target.value }))}
                        placeholder="مثال: local_admin"
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono outline-hidden focus:border-indigo-500 bg-white"
                        dir="ltr"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1">
                        <span>🔑</span>
                        <span>كلمة مرور المحلي (Local Password):</span>
                      </label>
                      <input
                        type="password"
                        value={silentGatewayConfig.smsGateLocalPassword || ''}
                        onChange={e => setSilentGatewayConfig(prev => ({ ...prev, smsGateLocalPassword: e.target.value }))}
                        placeholder="أدخل كلمة مرور حساب المحلي"
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono outline-hidden focus:border-indigo-500 bg-white"
                        dir="ltr"
                      />
                    </div>
                  </>
                )}
              </div>

              {silentGatewayConfig.androidAppType === 'sms_gate_cloud' ? (
                <p className="text-[10.5px] text-slate-500 leading-relaxed font-sans mt-2">
                  💡 <strong>ما هي هذه الإعدادات؟</strong> هي بيانات الدخول (اسم المستخدم وكلمة المرور) التي تستخدمها لتسجيل الدخول إلى تطبيق أو لوحة تحكم موقع <a href="https://sms-gate.app" target="_blank" rel="noreferrer" className="text-indigo-650 underline font-bold">sms-gate.app</a>. سيقوم خادم {schoolName} بتوليد طلب إرسال مشفر وآمن ومصادقته لتسليمه مباشرة إلى جوالك وبث الرسائل فوراً مخصومة من شريحة هاتفك!
                </p>
              ) : (
                <div className="space-y-2 mt-2 font-sans text-right">
                  <p className="text-[10.5px] text-slate-500 leading-relaxed font-sans font-semibold">
                    📌 <strong>كيف يعمل الربط المحلي؟</strong> سيقوم المتصفح بإرسال الرسائل مباشرة إلى هاتف الأندرويد عبر الـ Wi-Fi المشتركة إلى مسار <code className="bg-slate-100 font-mono text-[9px] px-1 rounded text-red-650">{"http://<device_local_ip>:8080/message"}</code> مستخدماً مصادقة Basic Authentication الآمنة ببيانات حسابك المعرف في SMSGate.
                  </p>
                  
                  <div className="bg-amber-50/45 border border-amber-100/80 p-4 rounded-lg text-amber-950 text-[10.5px] leading-relaxed">
                    ⚠️ <strong>تنبيه هام جداً لنجاح الاتصال المحلي (Mixed Content Security):</strong>
                    بسبب معايير الأمان وقفل المتصفحات، يقوم المتصفح تلقائياً بحجب اتصالات الويب الصادرة من هذا الرابط المشفر (<code className="font-mono text-[9px] text-indigo-800">HTTPS</code>) إلى الرابط غير المشفر الخاص بـ IP الجوال (<code className="font-mono text-[9px] text-indigo-800">HTTP</code>). إذا ظهر لك فشل الإرسال، يرجى القيام بـ:
                    <ul className="list-decimal list-inside mr-3 mt-1.5 space-y-1 font-bold font-sans">
                      <li>اضغط على أيقونة 🎛️ (أو القفل 🔒) بجانب شريط رابط هذا الموقع بالأعلى.</li>
                      <li>اضغط على <strong>إعدادات الموقع (Site Settings)</strong> لفتح صفحة الصلاحيات في متصفحك.</li>
                      <li>ابحث عن صلاحية <strong>المحتوى غير الآمن (Insecure content)</strong> وقم بتغييرها من "حظر" إلى <strong>"السماح" (Allow)</strong>، ثم أعد تحميل الصفحة.</li>
                      <li>أو بكل بساطة: استخدم <strong>"الوضع السحابي الآمن للـ SMSGate"</strong> ليعمل معك تلقائياً دون أي قيود! 🌟</li>
                    </ul>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Connection verification tester panel */}
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-150 flex flex-wrap items-center justify-between gap-3 text-right">
            <div className="space-y-2 max-w-sm">
              <div className="text-xs font-black text-slate-750">فحص وتأكيد نجاح الاتصال برابط بوابتك:</div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-slate-500 font-bold shrink-0">رقم جوال للفحص:</span>
                <input
                  type="text"
                  value={silentGatewayConfig.testPhone}
                  onChange={e => setSilentGatewayConfig(prev => ({ ...prev, testPhone: e.target.value }))}
                  placeholder="مثال: 0599000000"
                  className="px-2.5 py-1 border border-slate-200 rounded-lg text-xs font-mono w-[130px] bg-white focus:border-indigo-500"
                  dir="ltr"
                />
              </div>
            </div>

            <button
              type="button"
              disabled={testSendingStatus.loading}
              onClick={testSilentGatewayConnection}
              className="px-4 py-2 bg-indigo-650 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl transition shadow-xs cursor-pointer flex items-center gap-1.5 shrink-0"
            >
              {testSendingStatus.loading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  جاري الفحص...
                </>
              ) : (
                <>
                  فحص اتصال البوابة ⚡
                </>
              )}
            </button>

            {testSendingStatus.text && (
              <div className={`w-full mt-2 text-xs font-bold rounded-xl p-3 border ${
                testSendingStatus.success ? 'bg-emerald-50 text-emerald-800 border-emerald-100' : 'bg-rose-50 text-rose-800 border-rose-100'
              }`}>
                {testSendingStatus.text}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
