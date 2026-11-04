export type GateNotice = 'invalid_credentials' | 'not_authorized' | 'offline' | 'session_expired' | 'unknown' | 'missing_fields';

export const GATE_MESSAGES: Record<GateNotice, string> = {
  invalid_credentials: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
  not_authorized: 'هذا الحساب غير مصرح له باستخدام التطبيق، وتم تسجيل الخروج.',
  offline: 'لا يوجد اتصال بالإنترنت أو تعذر الوصول إلى الخادم. تحقق من الاتصال ثم حاول مجدداً.',
  session_expired: 'انتهت صلاحية الجلسة. الرجاء تسجيل الدخول من جديد.',
  unknown: 'حدث خطأ غير متوقع. حاول مرة أخرى.',
  missing_fields: 'الرجاء إدخال البريد الإلكتروني وكلمة المرور.',
};
