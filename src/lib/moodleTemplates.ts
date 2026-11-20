/**
 * Built-in Moodle message templates (wording only). Passwords are placeholders
 * filled at send time from the owner-only credentials table, never from students.extra.
 */
import type { MessageTemplate } from '../types';

export const MOODLE_HELP_URL = 'https://mhzcis.github.io/moodle';

/** Approved 6-line notice for students who have not logged into Moodle. */
export const NEVER_LOGGED_IN_TEMPLATE: Omit<MessageTemplate, 'id'> = {
  title: 'تذكير لغير الداخلين إلى مودل',
  category: 'general',
  content: [
    'عزيزي ولي الأمر {{اسم_ولي_الأمر}}، نود تذكيركم بدخول الطالب {{اسم_الطالب}} إلى منصة مودل.',
    'بيانات الدخول:',
    'اسم المستخدم: {{اسم_مستخدم_مودل}}',
    'كلمة المرور: {{كلمة_مرور_مودل}}',
    `شرح الدخول: ${MOODLE_HELP_URL}`,
    'معلمكم / محمد أبو زهري',
  ].join('\n'),
};

export const QUIZ_REMINDER_TEMPLATE: Omit<MessageTemplate, 'id'> = {
  title: 'تذكير باختبار مودل قبل الإغلاق',
  category: 'grades',
  content: [
    'عزيزي ولي الأمر {{اسم_ولي_الأمر}}، تذكير بأداء الطالب {{اسم_الطالب}} ({{الشعبة}}) للاختبار على منصة مودل.',
    'موعد الإغلاق: {{موعد_الإغلاق}}',
    'رابط فتح الاختبار: {{رابط_الاختبار}}',
    'معلمكم / محمد أبو زهري',
  ].join('\n'),
};

export const ASSIGNMENT_REMINDER_TEMPLATE: Omit<MessageTemplate, 'id'> = {
  title: 'تذكير بتسليم واجب مودل',
  category: 'grades',
  content: [
    'عزيزي ولي الأمر {{اسم_ولي_الأمر}}، نذكّركم بضرورة تسليم واجب الطالب {{اسم_الطالب}} على منصة مودل قبل موعد الإغلاق {{موعد_الإغلاق}}.',
    'معلمكم / محمد أبو زهري',
  ].join('\n'),
};

/**
 * Sent after the teacher resets a student's Moodle password to the default.
 * {{كلمة_المرور_الافتراضية}} is filled at send time from the owner-only credentials table
 * (masked in previews/logs) and needs the extra credentials confirmation.
 */
export const PASSWORD_CHANGED_TEMPLATE: Omit<MessageTemplate, 'id'> = {
  title: 'تغيير كلمة مرور مودل',
  category: 'general',
  content: [
    'عزيزي ولي الأمر {{اسم_ولي_الأمر}}، تمت إعادة تعيين كلمة مرور الطالب {{اسم_الطالب}} على منصة مودل.',
    'اسم المستخدم: {{اسم_مستخدم_مودل}}',
    'كلمة المرور الجديدة: {{كلمة_المرور_الافتراضية}}',
    'يُرجى تغييرها بعد أول دخول وعدم مشاركتها.',
    `شرح الدخول: ${MOODLE_HELP_URL}`,
    'معلمكم / محمد أبو زهري',
  ].join('\n'),
};

export const BUILTIN_MOODLE_TEMPLATES: Array<Omit<MessageTemplate, 'id'>> = [
  NEVER_LOGGED_IN_TEMPLATE,
  QUIZ_REMINDER_TEMPLATE,
  ASSIGNMENT_REMINDER_TEMPLATE,
  PASSWORD_CHANGED_TEMPLATE,
];
