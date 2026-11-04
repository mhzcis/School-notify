/**
 * Hosting capabilities.
 *
 * This build is deployed as a purely static site on GitHub Pages. There is no
 * backend: the old Express proxy (server.ts) does not exist here, so any feature
 * that relied on `/api/...` endpoints is unavailable until a server-side proxy
 * (planned: a Supabase Edge Function) is added.
 *
 * Set VITE_SERVER_PROXY=true at build time only if a same-origin `/api` proxy
 * really exists.
 */
export const SERVER_PROXY_AVAILABLE: boolean =
  (import.meta as any).env?.VITE_SERVER_PROXY === 'true';

export const CLOUD_NEEDS_PROXY_MESSAGE =
  'الإرسال عبر سحابة SMSGate غير متاح في النسخة المنشورة على GitHub Pages: خدمة SMSGate السحابية لا تسمح بالاتصال المباشر من المتصفح (CORS)، ويلزم وسيط خادم (Proxy) سيُضاف لاحقاً عبر Supabase. استخدم حالياً الإرسال اليدوي عبر واتساب/SMS.';

export const LOCAL_HTTP_BLOCKED_MESSAGE =
  'الإرسال عبر SMSGate المحلي (http://IP-الجوال) محجوب من المتصفح لأن الموقع يعمل عبر https (Mixed Content). يعمل فقط إذا فُتح التطبيق محلياً عبر http على نفس الشبكة. استخدم حالياً الإرسال اليدوي عبر واتساب/SMS.';

export const CUSTOM_QUEUE_NEEDS_SERVER_MESSAGE =
  'بوابة "مساعد SMS المدرسي" (طابور الرسائل على الخادم) غير متاحة في النسخة المنشورة على GitHub Pages لأنها تحتاج خادماً يحفظ الطابور. ستُضاف لاحقاً عبر Supabase. استخدم حالياً الإرسال اليدوي عبر واتساب/SMS.';

export const OTHER_GATEWAY_MESSAGE =
  'هذه البوابة غير مفعّلة. الرجاء استخدام تطبيق SMSGate أو الإرسال اليدوي.';

export interface GatewayModeLike {
  gatewayType: string;
  androidAppType?: string;
}

/**
 * Returns a human-readable reason (Arabic) why the configured silent gateway cannot
 * send from this deployment, or null if it can be attempted.
 */
export function gatewayBlockReason(
  config: GatewayModeLike,
  opts: { proxyAvailable?: boolean; pageProtocol?: string } = {}
): string | null {
  const proxyAvailable = opts.proxyAvailable ?? SERVER_PROXY_AVAILABLE;
  const protocol =
    opts.pageProtocol ?? (typeof window !== 'undefined' ? window.location.protocol : 'http:');
  if (config.gatewayType !== 'android_local') return OTHER_GATEWAY_MESSAGE;
  if (config.androidAppType === 'android_custom_gateway') {
    return proxyAvailable ? null : CUSTOM_QUEUE_NEEDS_SERVER_MESSAGE;
  }
  if (config.androidAppType === 'sms_gate_cloud') {
    return proxyAvailable ? null : CLOUD_NEEDS_PROXY_MESSAGE;
  }
  // Local SMSGate on the phone is reached over plain http://<ip>:8080
  if (protocol === 'https:') return LOCAL_HTTP_BLOCKED_MESSAGE;
  return null;
}
