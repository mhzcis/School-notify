/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Student, MessageTemplate, MessageLog, ScheduledMessage } from '../types';

export const DEFAULT_STUDENTS: Student[] = [
  {
    id: "ST1001",
    name: "أحمد محمد العتيبي",
    nameEn: "Ahmed Mohamed Al-Otaibi",
    parentName: "محمد العتيبي",
    phone: "0504123456",
    phone2: "024921021",
    email: "m.otaibi@example.com",
    grade: "الصف العاشر",
    section: "أ",
    notes: "طالب متميز - الرسوم المتبقية: 500 ريال"
  },
  {
    id: "ST1002",
    name: "سارة خالد عسيري",
    nameEn: "Sara Khaled Assiri",
    parentName: "خالد عسيري",
    phone: "0505234567",
    phone2: "034910291",
    email: "k.assiri@example.com",
    grade: "الصف العاشر",
    section: "أ",
    notes: "غياب متكرر - الرسوم المتبقية: لا يوجد"
  },
  {
    id: "ST1003",
    name: "فيصل عبد العزيز الشمري",
    nameEn: "Faisal Abdulaziz Al-Shammari",
    parentName: "عبد العزيز الشمري",
    phone: "0556345678",
    phone2: "049301292",
    email: "a.shamri@example.com",
    grade: "الصف العاشر",
    section: "ب",
    notes: "الرسوم المتبقية: 1200 ريال"
  },
  {
    id: "ST1004",
    name: "فاطمة عمر القحطاني",
    nameEn: "Fatima Omar Al-Qahtani",
    parentName: "عمر القحطاني",
    phone: "0507456789",
    phone2: "059902192",
    email: "o.qahtani@example.com",
    grade: "الصف العاشر",
    section: "ب",
    notes: "مستوى دراسي ممتاز"
  },
  {
    id: "ST1101",
    name: "خالد وليد الحربي",
    parentName: "وليد الحربي",
    phone: "0558567890",
    email: "w.harbi@example.com",
    grade: "الصف الحادي عشر",
    section: "أ",
    notes: "تأخر دراسي في الرياضيات - الرسوم المتبقية: 800 ريال"
  },
  {
    id: "ST1102",
    name: "ريم عبدالله البقمي",
    parentName: "عبدالله البقمي",
    phone: "0509678901",
    email: "a.buqami@example.com",
    grade: "الصف الحادي عشر",
    section: "أ",
    notes: "الرسوم المتبقية: لا يوجد"
  },
  {
    id: "ST1103",
    name: "سعد فهد الدوسري",
    parentName: "فهد الدوسري",
    phone: "0501239876",
    email: "f.dosari@example.com",
    grade: "الصف الحادي عشر",
    section: "ب",
    notes: "إنذار سلوكي أول - الرسوم المتبقية: 2500 ريال"
  },
  {
    id: "ST1201",
    name: "عبدالرحمن علي الشهري",
    parentName: "علي الشهري",
    phone: "0553451234",
    email: "a.shehri@example.com",
    grade: "الصف الثاني عشر",
    section: "أ",
    notes: "طالب متفوق بالثانوية العامة"
  },
  {
    id: "ST1202",
    name: "لينا صالح الزهراني",
    parentName: "صالح الزهراني",
    phone: "0504562345",
    email: "s.zahrani@example.com",
    grade: "الصف الثاني عشر",
    section: "ب",
    notes: "الرسوم المتبقية: 1500 ريال"
  },
  {
    id: "ST1203",
    name: "ماجد معاذ المطيري",
    parentName: "معاذ المطيري",
    phone: "0507891234",
    email: "m.mutairi@example.com",
    grade: "الصف الثاني عشر",
    section: "ب",
    notes: "غياب متكرر الحصة السادسة"
  }
];

export const DEFAULT_TEMPLATES: MessageTemplate[] = [
  {
    id: "TMP001",
    title: "إشعار غياب يومي",
    category: "attendance",
    content: "السلام عليكم أولياء أمورنا الأفاضل، نود إحاطتكم علماً بغياب ابننا/ابنتنا {{اسم_الطالب}} المقيد في {{الصف}}/{{الشعبة}} اليوم الموافق {{اليوم}} عن الحضور المدرسي دون عذر مسبق. الرجاء مراجعة الإدارة لتبرير الغياب. دمتم بود."
  },
  {
    id: "TMP002",
    title: "تذكير بالرسوم الدراسية المتأخرة",
    category: "fees",
    content: "عزيزي ولي الأمر {{اسم_ولي_الأمر}} المحترم، نود تذكيركم بضرورة سداد الأقساط المدرسية المتبقية للطالب {{اسم_الطالب}} والبالغة {{ملاحظات}} لتتمكن المدرسة من رصد درجاته ضمن الأنظمة. نشكر لكم حسن تعاونكم الدائم."
  },
  {
    id: "TMP003",
    title: "دعوة لحضور اجتماع مجلس الآباء",
    category: "events",
    content: "تحية طيبة السيد {{اسم_ولي_الأمر}}، ندعوكم لحضور اجتماع مجلس أولياء الأمور لمناقشة التحصيل الدراسي والملاحظات السلوكية لطلاب {{الصف}}، وتحديداً لمتابعة أداء {{اسم_الطالب}}، وذلك بمشيئة الله يوم الخميس القادم الساعة 5:30 مساءً بمسرح المدرسة."
  },
  {
    id: "TMP004",
    title: "تميز دراسي وتفوق",
    category: "grades",
    content: "إلى ولي أمر الطالب البطل {{اسم_الطالب}}، يسر إدارة المدرسة تهنئتكم بحصول ولدكم على تقييم متميز ومستوى دراسي لافت في {{الصف}} شعبة {{الشعبة}}. هنيئاً لكم هذا التميز ونتمنى له دوام العطاء."
  },
  {
    id: "TMP005",
    title: "تنبيه سلوكي هام",
    category: "general",
    content: "نفيدكم علماً السيد {{اسم_ولي_الأمر}} بضرورة توجيه الطالب {{اسم_الطالب}} حيال الالتزام بالزي المدرسي الموحد والأنظمة الداخلية للمدرسة لتفادي حسم درجات السلوك والمواظبة. شاكرين تفهمكم وحرصكم."
  }
];

export const MOCK_SCHEDULED_MESSAGES: ScheduledMessage[] = [
  {
    id: "SCH001",
    title: "حملة الترحيب بالعام الدراسي الجديد",
    contentTemplate: "أهلاً ومرحباً بكم أولياء أمور {{الصف}} الأعزاء. نرحب بكم في مستهل العام الدراسي وبولدنا {{اسم_الطالب}}. نأمل لكم عاماً حافلاً بالإنجاز والنجاح.",
    targetType: "grade",
    targetGrade: "الصف العاشر",
    scheduledTime: "2026-09-01T08:00:00",
    status: "pending",
    createdAt: "2026-05-28T12:00:00",
    totalRecipients: 4
  },
  {
    id: "SCH002",
    title: "تذكير تسليم مشاريع التخرج للمرحلة الثانوية",
    contentTemplate: "عزيزنا ولي أمر {{اسم_الطالب}}، يرجى التكرم بالحرص على إنهاء متطلبات مشروع التخرج لولدنا قبل الموعد النهائي للاستلام. شاكرين تعاونكم.",
    targetType: "grade",
    targetGrade: "الصف الثاني عشر",
    scheduledTime: "2026-06-15T09:00:00",
    status: "pending",
    createdAt: "2026-05-29T06:00:00",
    totalRecipients: 3
  }
];

export const MOCK_LOGS: MessageLog[] = [
  {
    id: "LOG101",
    studentId: "ST1001",
    studentName: "أحمد محمد العتيبي",
    parentName: "محمد العتيبي",
    phone: "0504123456",
    grade: "الصف العاشر",
    section: "أ",
    messageContent: "عزيزي ولي الأمر محمد العتيبي المحترم، نود تذكيركم بضرورة سداد الأقساط المدرسية المتبقية للطالب أحمد محمد العتيبي والبالغة طالب متميز - الرسوم المتبقية: 500 ريال لتتمكن المدرسة من رصد درجاته ضمن الأنظمة. نشكر لكم حسن تعاونكم الدائم.",
    sentTime: "2026-05-29T06:10:00Z",
    status: "delivered"
  },
  {
    id: "LOG102",
    studentId: "ST1002",
    studentName: "سارة خالد عسيري",
    parentName: "خالد عسيري",
    phone: "0505234567",
    grade: "الصف العاشر",
    section: "أ",
    messageContent: "السلام عليكم أولياء أمورنا الأفاضل، نود إحاطتكم علماً بغياب ابننا/ابنتنا سارة خالد عسيري المقيد في الصف العاشر/أ اليوم الموافق السبت عن الحضور المدرسي دون عذر مسبق. الرجاء مراجعة الإدارة لتبرير الغياب. دمتم بود.",
    sentTime: "2026-05-29T06:12:00Z",
    status: "delivered"
  },
  {
    id: "LOG103",
    studentId: "ST1101",
    studentName: "خالد وليد الحربي",
    parentName: "وليد الحربي",
    phone: "0558567890",
    grade: "الصف الحادي عشر",
    section: "أ",
    messageContent: "عزيزي ولي الأمر وليد الحربي المحترم، نود تذكيركم بضرورة سداد الأقساط المدرسية المتبقية للطالب خالد وليد الحربي والبالغة تأخر دراسي في الرياضيات - الرسوم المتبقية: 800 ريال لتتمكن المدرسة من رصد درجاته ضمن الأنظمة. نشكر لكم حسن تعاونكم الدائم.",
    sentTime: "2026-05-29T06:15:00Z",
    status: "failed",
    failureReason: "الرقم غير متصل بالشبكة (Network offline)"
  }
];
