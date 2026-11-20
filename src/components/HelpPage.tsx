/**
 * Short Arabic help page: import, placeholders, safe sending, scheduling, reports, backups.
 * Static text only — no data is read or written here.
 */
import React from 'react';
import { HelpCircle, ShieldCheck } from 'lucide-react';
import { PLACEHOLDERS } from '../lib/template';
import { LARGE_SEND_THRESHOLD, QUIET_HOURS_LABEL } from '../lib/sendSafety';

interface Section { id: string; title: string; items: React.ReactNode[] }

const SECTIONS: Section[] = [
  {
    id: 'help-import',
    title: '1) استيراد الطلاب من إكسل',
    items: [
      'من «استيراد كشف إكسل» اختر ملف الكشف، ثم راجع مطابقة الأعمدة (الاسم، رقم الهوية، الصف، الشعبة، جوال ولي الأمر، الجوال الثاني).',
      'رقم الهوية إلزامي: إعادة استيراد نفس الملف تُحدّث الطالب الموجود ولا تكرره.',
      'الأعمدة غير الموجودة في الملف لا تمسح البيانات المحفوظة (مثل الجوال الثاني).',
      'لا يتم استيراد الملاحظات ولا كلمات مرور مودل من كشف الطلاب. بيانات دخول مودل لها نموذج خاص في «أدوات مودل».',
      'ملف بيانات دخول مودل يمكن أن يحتوي عمود «كلمة المرور الافتراضية» لاستخدامه في قالب «تغيير كلمة مرور مودل» عبر المتغير {{كلمة_المرور_الافتراضية}} (يظهر مخفياً في المعاينات والتقارير).',
      'يمكن إضافة طالب واحد أو تعديله من الصفحة الرئيسية.',
    ],
  },
  {
    id: 'help-recipients',
    title: '2) اختيار المستلمين',
    items: [
      'شاشة البث تبدأ دائماً بدون أي طالب محدد. اختر الكل أو صفاً أو شعبة، ثم اضغط «تحديد جميع النتائج» أو حدّد الطلاب يدوياً.',
      'يمكن البحث بالاسم أو رقم الهوية، أو لصق قائمة أرقام هويات لتحديدها فقط (مع عدد الأرقام غير المعروفة).',
      'يمكن حفظ التحديد كمجموعة باسم واضح وإعادة استخدامها لاحقاً.',
      'الأرقام الموجودة في «قائمة عدم الإرسال» (صفحة تهيئة SMS) تُستبعد من كل إرسال، ويظهر عددها في نافذة التأكيد.',
      'يتذكر التطبيق آخر صف وشعبة استخدمتهما (لا يتذكر الطلاب المحددين).',
    ],
  },
  {
    id: 'help-send',
    title: '3) الإرسال الآمن',
    items: [
      'لا يُرسل شيء قبل نافذة التأكيد: تعرض عدد الطلاب والرسائل والأجزاء والتكلفة وعينة من النص الحقيقي لأول المستلمين.',
      `عند ${LARGE_SEND_THRESHOLD} رسالة أو أكثر يجب كتابة العدد بالضبط قبل التأكيد.`,
      `ساعات الهدوء: ${QUIET_HOURS_LABEL}. الإرسال فيها يحتاج موافقة إضافية صريحة.`,
      'تحذير إذا وصل نفس النص لنفس الرقم خلال 24 ساعة.',
      'جرّب أولاً من «تهيئة بث رسائل SMS» ← «إرسال تجريبي» إلى رقمك فقط، ثم أكّد داخل الصفحة.',
      'يمكن وسم الحملة «تجريبية» لاستبعادها من الإحصاءات، وإعادة إرسال الفاشلة فقط من التقارير.',
      'أثناء الإرسال عبر البوابة يمكن الضغط «إيقاف مؤقت». يبقى الإرسال محفوظاً حتى بعد إعادة تحميل الصفحة، و«استئناف الإرسال» يرسل فقط الرسائل التي لم تُرسل بعد، مع نفس التأكيدات وساعات الهدوء وقائمة عدم الإرسال. الرسائل التي انقطع الاتصال أثناء إرسالها لا يُعاد إرسالها تلقائياً أبداً.',
    ],
  },
  {
    id: 'help-schedule',
    title: '4) الحملات المجدولة',
    items: [
      'اختر «جدولة» في شاشة البث وحدد التاريخ والوقت. الخادم يرسل الحملات المستحقة تلقائياً كل 5 دقائق.',
      'لا يتم الإرسال المجدول في ساعات الهدوء إلا إذا وافقت على ذلك عند الجدولة.',
      'يمكن إيقاف الإرسال المجدول لحسابك في أي وقت من صفحة «الحملات والمواعيد مجدولة».',
      'القوالب التي تحتوي على بيانات دخول مودل لا تُرسل تلقائياً إلا بموافقة إضافية عند الجدولة.',
    ],
  },
  {
    id: 'help-reports',
    title: '5) التقارير',
    items: [
      'تعرض حالة كل رسالة (أُرسلت، سُلّمت، فشلت) وتتحدث من الهاتف عبر SMSGate.',
      'يمكن تصدير التقرير الحالي إلى إكسل، وإخفاء الحملات التجريبية.',
    ],
  },
  {
    id: 'help-backup',
    title: '6) النسخ الاحتياطي',
    items: [
      'من «النسخ الاحتياطي والاستعادة» نزّل نسخة JSON بانتظام (يظهر تذكير بعد 7 أيام).',
      'يمكن حماية النسخة بكلمة مرور (تشفير داخل المتصفح). احفظ كلمة المرور في مكان آمن: بدونها لا يمكن فتح النسخة.',
      'الاستعادة تعرض معاينة، وتطلب كتابة «استعادة»، وتنزّل نسخة أمان أولاً، ولا تحذف أي بيانات موجودة.',
      'لا تحتوي النسخة على بيانات دخول مودل ولا أسرار بوابة SMS.',
    ],
  },
];

export default function HelpPage() {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-xs space-y-6" id="help-page" dir="rtl">
      <div className="pb-4 border-b border-slate-100">
        <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
          <HelpCircle className="w-5 h-5 text-indigo-600" />
          دليل الاستخدام السريع
        </h2>
        <p className="text-sm text-slate-500 mt-1">خطوات مختصرة للاستيراد والمتغيرات والإرسال الآمن والنسخ الاحتياطي.</p>
      </div>

      {SECTIONS.map(s => (
        <section key={s.id} id={s.id} className="space-y-2">
          <h3 className="font-bold text-slate-700 text-sm">{s.title}</h3>
          <ul className="list-disc pr-5 space-y-1 text-xs text-slate-600 leading-6">
            {s.items.map((it, i) => <li key={i}>{it}</li>)}
          </ul>
        </section>
      ))}

      <section id="help-placeholders" className="space-y-2">
        <h3 className="font-bold text-slate-700 text-sm">7) متغيرات القوالب</h3>
        <p className="text-xs text-slate-500">انسخ المتغير كما هو داخل نص القالب، وسيُستبدل بقيمة كل طالب في المعاينة والإرسال.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-right border border-slate-100">
            <thead className="bg-slate-50 text-slate-600">
              <tr><th className="p-2">المتغير</th><th className="p-2">المعنى</th></tr>
            </thead>
            <tbody>
              {PLACEHOLDERS.map(p => (
                <tr key={p.tag} className="border-t border-slate-100">
                  <td className="p-2 font-mono" dir="ltr">{p.tag}</td>
                  <td className="p-2">{p.label}{p.sensitive ? ' — تُخفى في المعاينة وتحتاج تأكيداً إضافياً' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-start gap-2">
        <ShieldCheck className="w-4 h-4 shrink-0" />
        <span>بيانات الطلاب محفوظة في سحابة محمية بتسجيل الدخول. لا تشارك كلمة مرور التطبيق، ولا تُرسل لغير أولياء الأمور.</span>
      </div>
    </div>
  );
}
