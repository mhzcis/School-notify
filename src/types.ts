/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Student {
  id: string; // الرقم الأكاديمي أو رقم بطاقة التعريف أو معرف عشوائي
  name: string; // اسم الطالب
  nameEn?: string; // اسم الطالب انجليزي
  parentName: string; // اسم ولي أمر الطالب
  phone: string; // جوال العائلة (الرقم الرئيسي)
  phone2?: string; // تليفون العائلة (الرقم البديل)
  email?: string; // البريد الإلكتروني
  grade: string; // الصف
  section: string; // الشعبة
  district?: string; // المنطقة
  school?: string; // المدرسة
  idType?: string; // نوع بطاقة التعريف
  idNumber?: string; // رقم بطاقة التعريف
  individualRegNum?: string; // رقم تسجيل الفرد
  familyRegNum?: string; // رقم تسجيل العائلة
  refugeeStatus?: string; // حالة اللجوء
  motherName?: string; // اسم الأم
  parentJob?: string; // مهنة ولي الأمر
  motherJob?: string; // مهنة الأم
  nationality?: string; // الجنسية
  gender?: string; // الجنس
  birthDate?: string; // تاريخ الميلاد
  birthPlace?: string; // مكان الميلاد
  city?: string; // المدينة
  governorate?: string; // المحافظة
  originalTown?: string; // البلدة الأصلية
  address?: string; // العنوان
  religion?: string; // الديانة
  socialSecurity?: string; // شبكة الأمان الاجتماعي
  hasChronicDisease?: string; // هل لديه مرض مزمن
  livesInCamp?: string; // يسكن في المخيم
  previousYearGPA?: string; // معدل الطالب العام السابق
  notes?: string; // ملاحظات ومستحقات مخصصة
  moodleUsername?: string; // اسم مستخدم مودل الافتراضي
  /** كلمة مرور مودل الافتراضية — حساسة: تُخفى في القوائم والمعاينات ولا تُحفظ في السجلات. مخزنة في السحابة (school_notify.students.extra) لحساب المالك فقط وتحميها RLS. */
  moodlePassword?: string;
}

export interface MessageTemplate {
  id: string;
  title: string; // عنوان القالب
  content: string; // نص الرسالة مع متغيرات
  category: 'general' | 'attendance' | 'grades' | 'fees' | 'events'; // تصنيف القالب
}

export interface ScheduledMessage {
  id: string;
  title: string; // عنوان الحملة
  contentTemplate: string; // نص القالب مع المتغيرات المستخدم
  targetType: 'all' | 'grade' | 'section' | 'custom'; // فئة المستهدفين
  targetGrade?: string;
  targetSection?: string;
  targetStudentIds?: string[];
  phoneTarget?: 'primary' | 'secondary' | 'both'; // الرقم المحدد للإرسال
  scheduledTime: string; // تاريخ ووقت الإرسال
  status: 'pending' | 'sending' | 'completed' | 'cancelled';
  createdAt: string;
  totalRecipients: number;
}

export interface MessageLog {
  id: string;
  campaignId?: string; // حملة الإرسال (مجدولة أو فورية)
  studentId: string;
  studentName: string;
  parentName: string;
  phone: string;
  grade: string;
  section: string;
  messageContent: string; // المحتوى النهائي بعد استبدال المتغيرات
  sentTime: string;
  status: 'pending' | 'sent' | 'delivered' | 'failed'; // 'sent' = handed to gateway/app, NOT a delivery confirmation
  failureReason?: string;
  channel?: 'gateway' | 'manual'; // how the message was sent (optional, older logs don't have it)
}

export interface SchoolStats {
  totalStudents: number;
  totalGrades: number;
  totalSections: number;
  activeTemplates: number;
  scheduledCampaigns: number;
  deliveredCount: number;
  failedCount: number;
  pendingCount: number;
  sentCount?: number; // handed to gateway without delivery confirmation
}
