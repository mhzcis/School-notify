/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { readPref, UI_PREF_KEYS } from '../lib/smsPrefs';
import React, { useState, useMemo } from 'react';
import { SchoolStats, Student } from '../types';
import { checkPhone, isSendablePhone, PHONE_PROBLEM_LABELS } from '../lib/phone';
import SecretText from './SecretText';
import { 
  Users2, 
  School, 
  Landmark, 
  Sparkles, 
  BookOpen, 
  Clock, 
  CheckCircle2, 
  MessageSquareText, 
  AlertCircle, 
  FileSpreadsheet,
  Search,
  Trash2,
  Phone,
  Eye,
  X,
  Filter,
  Smartphone,
  Settings,
  Calendar,
  MapPin,
  User,
  Activity,
  Layers,
  GraduationCap
} from 'lucide-react';

interface DashboardOverviewProps {
  stats: SchoolStats;
  onNavigateToTab: (tab: 'compose' | 'importer' | 'templates' | 'scheduler' | 'reports') => void;
  userEmail?: string;
  students?: Student[];
  onUpdateStudents?: React.Dispatch<React.SetStateAction<Student[]>>;
  schoolName: string;
  onUpdateSchoolName: (name: string) => void;
}

export default function DashboardOverview({ 
  stats, 
  onNavigateToTab, 
  userEmail,
  students = [],
  onUpdateStudents,
  schoolName,
  onUpdateSchoolName
}: DashboardOverviewProps) {

  // Local state for searching & filtering the student directory
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedGradeFilter, setSelectedGradeFilter] = useState('all');
  const [selectedSectionFilter, setSelectedSectionFilter] = useState('all');

  // Deletion operation selector
  const [showDeletionConsole, setShowDeletionConsole] = useState(false);
  const [bulkGradeToDelete, setBulkGradeToDelete] = useState('');
  const [bulkSectionToDelete, setBulkSectionToDelete] = useState('');

  // Modals / Dropdowns for student inspection
  const [activeDetailsStudent, setActiveDetailsStudent] = useState<Student | null>(null);
  const [activeWhatsAppStudent, setActiveWhatsAppStudent] = useState<Student | null>(null);
  const [activeCallStudent, setActiveCallStudent] = useState<Student | null>(null);

  // Custom dialogs to bypass blocked iframe alerts/confirms
  const [confirmationDialog, setConfirmationDialog] = useState<{
    isOpen: boolean;
    title: string;
    description: string;
    onConfirm: () => void;
    type: 'danger' | 'warning';
  }>({
    isOpen: false,
    title: '',
    description: '',
    onConfirm: () => {},
    type: 'danger',
  });

  const [alertDialog, setAlertDialog] = useState<{
    isOpen: boolean;
    title: string;
    description: string;
  }>({
    isOpen: false,
    title: '',
    description: '',
  });

  // Pagination or list limit for performance
  const [studentsLimit, setStudentsLimit] = useState(25);

  // Compute distinct Grades and Sections for search filters
  const gradesList = useMemo(() => {
    return Array.from(new Set(students.map(s => s.grade))).filter(Boolean);
  }, [students]);

  const sectionsListForSelectedGrade = useMemo(() => {
    if (selectedGradeFilter === 'all') {
      return Array.from(new Set(students.map(s => s.section))).filter(Boolean);
    }
    return Array.from(
      new Set(
        students
          .filter(s => s.grade === selectedGradeFilter)
          .map(s => s.section)
      )
    ).filter(Boolean);
  }, [students, selectedGradeFilter]);

  // Bulk grades list for deletion dropdowns
  const bulkGradesList = useMemo(() => {
    return Array.from(new Set(students.map(s => s.grade))).filter(Boolean);
  }, [students]);

  const bulkSectionsList = useMemo(() => {
    if (!bulkGradeToDelete) return [];
    return Array.from(
      new Set(
        students
          .filter(s => s.grade === bulkGradeToDelete)
          .map(s => s.section)
      )
    ).filter(Boolean);
  }, [students, bulkGradeToDelete]);

  // Filter students dynamically based on search inputs and selectors
  const filteredStudents = useMemo(() => {
    return students.filter(student => {
      // 1. Search term match name, nameEn, phone, phone2, parentName, notes, or idNumber
      const query = searchTerm.toLowerCase().trim();
      let matchesSearch = true;
      if (query) {
        matchesSearch = 
          (student.name && student.name.toLowerCase().includes(query)) ||
          (student.nameEn && student.nameEn.toLowerCase().includes(query)) ||
          (student.phone && student.phone.includes(query)) ||
          (student.phone2 && student.phone2.includes(query)) ||
          (student.parentName && student.parentName.toLowerCase().includes(query)) ||
          (student.notes && student.notes.toLowerCase().includes(query)) ||
          (student.idNumber && student.idNumber.includes(query)) ||
          (student.id && student.id.toLowerCase().includes(query));
      }

      // 2. Grade filter
      let matchesGrade = true;
      if (selectedGradeFilter !== 'all') {
        matchesGrade = student.grade === selectedGradeFilter;
      }

      // 3. Section filter
      let matchesSection = true;
      if (selectedSectionFilter !== 'all') {
        matchesSection = student.section === selectedSectionFilter;
      }

      return matchesSearch && matchesGrade && matchesSection;
    });
  }, [students, searchTerm, selectedGradeFilter, selectedSectionFilter]);

  // General helper: cleans a mobile number for WhatsApp link extraction
  const getCleanMobileForWhatsApp = (phoneNumber: string): string => {
    let cleaned = phoneNumber.replace(/\D/g, ''); // strip any non-digit chars
    if (cleaned.startsWith('0')) {
      cleaned = cleaned.substring(1); // remove leading zero
    }
    // Remove default double prefixes if they exist safely
    const prefixes = ['966', '970', '972', '962', '20'];
    for (const p of prefixes) {
      if (cleaned.startsWith(p)) {
        cleaned = cleaned.substring(p.length);
        break;
      }
    }
    return cleaned;
  };

  const getWhatsAppLinks = (phoneNumber: string) => {
    const prefix = readPref(UI_PREF_KEYS.phonePrefix, 'none');
    let clean = phoneNumber.replace(/\D/g, '');
    if (clean.startsWith('0')) {
      clean = clean.substring(1);
    }
    
    // safe clean up of international prefixes
    const prefixes = ['966', '970', '972', '962', '20'];
    for (const p of prefixes) {
      if (clean.startsWith(p)) {
        clean = clean.substring(p.length);
        break;
      }
    }

    if (prefix === '966') {
      return [
        { url: `https://wa.me/966${clean}`, label: 'المملكة العربية السعودية (+966)', color: 'bg-emerald-600 hover:bg-emerald-700' },
        { url: `https://wa.me/972${clean}`, label: 'فلسطين (+972)', color: 'bg-teal-600 hover:bg-teal-700' },
        { url: `https://wa.me/970${clean}`, label: 'فلسطين البديلة (+970)', color: 'bg-indigo-600 hover:bg-indigo-700' }
      ];
    }
    if (prefix === '970' || prefix === '972' || prefix === 'none') {
      return [
        { url: `https://wa.me/972${clean}`, label: 'فلسطين (+972)', color: 'bg-emerald-600 hover:bg-emerald-700' },
        { url: `https://wa.me/970${clean}`, label: 'فلسطين البديلة (+970)', color: 'bg-teal-600 hover:bg-teal-700' }
      ];
    }
    if (prefix === '962') {
      return [{ url: `https://wa.me/962${clean}`, label: 'الأردن (+962)', color: 'bg-indigo-600 hover:bg-indigo-700' }];
    }
    if (prefix === '20') {
      return [{ url: `https://wa.me/20${clean}`, label: 'مصر (+20)', color: 'bg-blue-600 hover:bg-blue-700' }];
    }
    
    return [
      { url: `https://wa.me/972${clean}`, label: 'فلسطين (+972)', color: 'bg-emerald-600 hover:bg-emerald-700' },
      { url: `https://wa.me/970${clean}`, label: 'فلسطين البديلة (+970)', color: 'bg-teal-600 hover:bg-teal-700' },
      { url: `https://wa.me/${phoneNumber.replace(/\D/g, '')}`, label: 'الرقم المباشر المسجل', color: 'bg-indigo-650 hover:bg-indigo-700' }
    ];
  };

  // Student specific deletion - updated with custom dialog modal
  const handleDeleteSingleStudent = (student: Student) => {
    if (!onUpdateStudents) return;
    setConfirmationDialog({
      isOpen: true,
      title: 'تأكيد حذف الطالب نهائياً',
      description: `هل أنت متأكد من حذف الطالب/ة (${student.name}) نهائياً من سجل المدرسة؟ سيؤدي ذلك لمسح كافة بياناته.`,
      type: 'danger',
      onConfirm: () => {
        onUpdateStudents(prev => prev.filter(s => s.id !== student.id));
        setAlertDialog({
          isOpen: true,
          title: 'حفظ التغييرات',
          description: `تم إزالة سجل الطالب (${student.name}) بنجاح من سجلات الفصول.`
        });
      }
    });
  };

  // Entire Section deletion - updated with custom dialog modal and warning overlay
  const handleDeleteSectionGroup = () => {
    if (!onUpdateStudents) return;
    if (!bulkGradeToDelete || !bulkSectionToDelete) {
      setAlertDialog({
        isOpen: true,
        title: 'تنبيه',
        description: 'الرجاء اختيار الصف والشعبة المراد حذفهما.'
      });
      return;
    }

    const count = students.filter(s => s.grade === bulkGradeToDelete && s.section === bulkSectionToDelete).length;
    if (count === 0) {
      setAlertDialog({
        isOpen: true,
        title: 'تنبيه',
        description: 'لا يوجد طلاب حالياً في هذه الشعبة المحددة.'
      });
      return;
    }

    setConfirmationDialog({
      isOpen: true,
      title: 'تحذير: حذف كافة طلاب الشعبة',
      description: `هل أنت متأكد من حذف كافة طلاب الشعبة (${bulkSectionToDelete}) بالصف (${bulkGradeToDelete}) بالكامل؟ سيتم حذف عدد (${count}) طلاب نهائياً وبشكل قطعي.`,
      type: 'danger',
      onConfirm: () => {
        onUpdateStudents(prev => prev.filter(s => !(s.grade === bulkGradeToDelete && s.section === bulkSectionToDelete)));
        setBulkSectionToDelete('');
        setAlertDialog({
          isOpen: true,
          title: 'تم الحذف بنجاح',
          description: 'تم حذف طلاب الشعبة المحددة بالكامل بنجاح.'
        });
      }
    });
  };

  // Entire Grade deletion - updated with custom dialog modal and warning overlay
  const handleDeleteGradeGroup = () => {
    if (!onUpdateStudents) return;
    if (!bulkGradeToDelete) {
      setAlertDialog({
        isOpen: true,
        title: 'تنبيه',
        description: 'الرجاء اختيار الصف الدراسي المراد حذفه.'
      });
      return;
    }

    const count = students.filter(s => s.grade === bulkGradeToDelete).length;
    if (count === 0) {
      setAlertDialog({
        isOpen: true,
        title: 'تنبيه',
        description: 'لا يوجد طلاب حالياً في هذا الصف الدراسي.'
      });
      return;
    }

    setConfirmationDialog({
      isOpen: true,
      title: 'تحذير حرج: حذف الصف الدراسي بالكامل',
      description: `هل أنت متأكد من حذف الصف الدراسي (${bulkGradeToDelete}) بالكامل بجميع شعبه بجميع طلابه؟ سيتم حذف عدد (${count}) طلاب نهائياً وبشكل لا يمكن التراجع عنه.`,
      type: 'danger',
      onConfirm: () => {
        onUpdateStudents(prev => prev.filter(s => s.grade !== bulkGradeToDelete));
        setBulkGradeToDelete('');
        setBulkSectionToDelete('');
        setAlertDialog({
          isOpen: true,
          title: 'تم الحذف بنجاح',
          description: 'تم حذف الصف الدراسي المحدد بجميع شعبه وطلابه بنجاح.'
        });
      }
    });
  };

  // Wipe All database records - updated with custom dialog modal and warning overlay
  const handleWipeEntireRegistry = () => {
    if (!onUpdateStudents) return;
    const count = students.length;
    if (count === 0) {
      setAlertDialog({
        isOpen: true,
        title: 'تنبيه',
        description: 'السجل فارغ بالفعل ولا يحتوي على أي بيانات لتصفيرها.'
      });
      return;
    }

    setConfirmationDialog({
      isOpen: true,
      title: '⚠️ تنبيه خطير جداً: تصفير السجل المدرسي بالكامل',
      description: `هل أنت متأكد تماماً وبشكل حتمي من حذف كافة سجلات الطلاب بالكامل وتصفير البرنامج؟ سيتم خسارة بيانات عدد (${count}) طلاب نهائياً من المتصفح ولا يمكن التراجع عن هذا الإجراء قطرياً.`,
      type: 'danger',
      onConfirm: () => {
        onUpdateStudents([]);
        setAlertDialog({
          isOpen: true,
          title: 'تهيئة وتصفير ناجح',
          description: 'تم تصفير السجل المدرسي بنجاح وتفريغ قاعدة بيانات الطلاب بالكامل.'
        });
      }
    });
  };

  return (
    <div className="space-y-6" id="dashboard-overview-container">
      
      {/* Editorial Welcome Card */}
      <div className="relative overflow-hidden rounded-3xl bg-radial from-slate-900 via-slate-800 to-slate-950 p-6 sm:p-8 text-white shadow-xl border border-slate-800">
        <div className="absolute right-0 top-0 -mr-16 -mt-16 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute left-0 bottom-0 -ml-16 -mb-16 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
          <div className="md:col-span-8 text-right space-y-3">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-500/15 border border-emerald-500/20 rounded-full text-xs text-emerald-400 font-bold mb-1">
              <Sparkles className="w-3.5 h-3.5" />
              منصة الاتصال المدرسي الذكية • الإصدار المطور
            </div>
            <h1 className="text-2xl sm:text-3.5xl font-black tracking-tight text-white leading-tight">
              أهلاً بك في نظام <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-indigo-400">ريـســال (Resal)</span> للتواصل الذكي
            </h1>
            <p className="text-slate-300 text-sm max-w-2xl leading-relaxed">
              قم بإدارة الفصول والشعب، استيراد بيانات الطلاب من ملفات إكسل بسرعة فائقة، صياغة وإرسال التنبيهات الفورية والرسائل الجماعية لأولياء الأمور مع جدولة دقيقة ومتابعة حالة الاستلام الحية.
            </p>
            {userEmail && (
              <p className="text-[11px] text-slate-400 font-mono">
                المسؤول الحالي: {userEmail}
              </p>
            )}
          </div>

          <div className="md:col-span-4 flex flex-col sm:flex-row md:flex-col gap-3 justify-end items-stretch sm:items-center md:items-stretch">
            <button
              onClick={() => onNavigateToTab('importer')}
              className="flex items-center justify-center gap-2 px-5 py-3 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white font-bold rounded-2xl shadow-lg transition duration-200 text-sm cursor-pointer hover:scale-102"
              id="dt-nav-excel-import"
            >
              <FileSpreadsheet className="w-4.5 h-4.5" />
              استيراد الطلاب من ملف إكسل
            </button>
            <button
              onClick={() => onNavigateToTab('compose')}
              className="flex items-center justify-center gap-2 px-5 py-3 bg-white/10 hover:bg-white/15 text-white font-bold border border-white/10 hover:border-white/20 rounded-2xl transition duration-200 text-sm cursor-pointer hover:scale-102"
              id="dt-nav-message-compose"
            >
              <MessageSquareText className="w-4.5 h-4.5" />
              إعداد وبث رسالة جماعية
            </button>
          </div>
        </div>
      </div>

      {/* Grid of Analytical KPI Widgets */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5" id="stats-kpi-grid">
        
        {/* Metric 1 */}
        <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-3xs hover:shadow-2xs transition-all duration-200 flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs text-slate-400 font-bold font-sans">إجمالي الطلاب بالسجلات</div>
            <div className="text-3xl font-black font-mono text-slate-800">{stats.totalStudents}</div>
            <p className="text-[10px] text-slate-500 font-sans">
              موزعين على <strong className="text-indigo-600 font-bold">{stats.totalGrades} صفوف</strong> و <strong className="text-indigo-600 font-bold">{stats.totalSections} شعب</strong>
            </p>
          </div>
          <div className="p-3.5 bg-indigo-50 text-indigo-600 rounded-2xl">
            <Users2 className="w-6 h-6" />
          </div>
        </div>

        {/* Metric 2 */}
        <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-3xs hover:shadow-2xs transition-all duration-200 flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs text-slate-400 font-bold font-sans">القوانين والقوالب الجاهزة</div>
            <div className="text-3xl font-black font-mono text-slate-800">{stats.activeTemplates}</div>
            <p className="text-[10px] text-slate-550 font-sans">
              <button onClick={() => onNavigateToTab('templates')} className="text-emerald-600 hover:underline font-bold">
                تعديل وإضافة قوالب صياغة جديدة
              </button>
            </p>
          </div>
          <div className="p-3.5 bg-emerald-50 text-emerald-600 rounded-2xl">
            <BookOpen className="w-6 h-6" />
          </div>
        </div>

        {/* Metric 3 */}
        <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-3xs hover:shadow-2xs transition-all duration-200 flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs text-slate-400 font-bold font-sans">حملات الإرسال المجدولة</div>
            <div className="text-3xl font-black font-mono text-slate-800">{stats.scheduledCampaigns}</div>
            <p className="text-[10px] text-slate-500 font-sans subpixel-antialiased">
              لا تُرسل تلقائياً — أرسلها يدوياً من شاشة الجدولة
            </p>
          </div>
          <div className="p-3.5 bg-amber-50 text-amber-600 rounded-2xl">
            <Clock className="w-6 h-6" />
          </div>
        </div>

        {/* Metric 4 */}
        <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-3xs hover:shadow-2xs transition-all duration-200 flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs text-slate-400 font-bold font-sans">نسبة نجاح الإرسال</div>
            <div className="text-3xl font-black font-mono text-slate-800">
              {(() => {
                const ok = stats.deliveredCount + (stats.sentCount || 0);
                const attempted = ok + stats.failedCount;
                return attempted > 0 ? `${Math.round((ok / attempted) * 100)}%` : '—';
              })()}
            </div>
            <p className="text-[10px] text-slate-500 font-sans font-medium">
              أُرسلت: <strong className="text-emerald-600 font-mono font-bold">{stats.deliveredCount + (stats.sentCount || 0)}</strong> • الفشل: <strong className="text-rose-600 font-mono font-bold">{stats.failedCount}</strong>
            </p>
          </div>
          <div className="p-3.5 bg-sky-50 text-sky-600 rounded-2xl">
            <CheckCircle2 className="w-6 h-6" />
          </div>
        </div>

      </div>

      {/* Guide Bento Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Flow visual helper */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-100 p-6 space-y-4">
          <h3 className="font-bold text-slate-800 text-sm">🔄 دورة وإجراءات التواصل السريع:</h3>
          
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 relative">
              <span className="absolute left-3 top-3 text-[10px] font-mono font-black text-slate-300">01</span>
              <FileSpreadsheet className="w-5 h-5 text-emerald-600 mb-2" />
              <h4 className="font-bold text-slate-800 mb-1">رفع وتحديث الملف</h4>
              <p className="text-slate-500 leading-relaxed">استورد كشف الطلاب من ملف إكسل المحدث ليتكفل النظام بإلحاقهم وتحديث هواتفهم تلقائياً.</p>
            </div>

            <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 relative">
              <span className="absolute left-3 top-3 text-[10px] font-mono font-black text-slate-300">02</span>
              <MessageSquareText className="w-5 h-5 text-indigo-600 mb-2" />
              <h4 className="font-bold text-slate-800 mb-1">الصياغة والجدولة</h4>
              <p className="text-slate-500 leading-relaxed">حدّد الفئة المستهدفة، اختر قالب صياغة متغيّر، ورتّب الموعد المناسب لبث التنبيهات والطلبات.</p>
            </div>

            <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 relative">
              <span className="absolute left-3 top-3 text-[10px] font-mono font-black text-slate-300">03</span>
              <CheckCircle2 className="w-5 h-5 text-sky-600 mb-2" />
              <h4 className="font-bold text-slate-800 mb-1">الرصد والمراقبة الحية</h4>
              <p className="text-slate-500 leading-relaxed">راقب نجاح وصول الرسائل لهواتف أولياء الأمور وحلل التقارير والأخطاء في حالة الفشل الفني فورا.</p>
            </div>
          </div>
        </div>

        {/* Quick Tips */}
        <div className="lg:col-span-5 bg-gradient-to-br from-indigo-50/50 to-indigo-100/30 rounded-2xl border border-indigo-100/50 p-6 flex flex-col justify-between space-y-4">
          <div>
            <h3 className="font-bold text-indigo-900 text-sm flex items-center gap-1.5 mb-2">
              <Sparkles className="w-4 h-4 text-indigo-600 shrink-0" />
              نصيحة لإدارة فعالة لقواعد البيانات المدرسية 🏫
            </h3>
            <p className="text-slate-600 text-xs leading-relaxed">
              عند تصميم كشوفات الطلاب في تطبيق الإكسل المعتمد للمدرسة الخاص بك، احرص على مطابقة أسماء الفصول بدقة (مثل: "الصف العاشر"، "الصف الحادي عشر") ليتكفل البرنامج بجمع الطلاب ضمن شعبهم المحددة لتلافي الأخطاء الإملائية والارتباك أثناء حملات الطوارئ غائبي الحضور!
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => onNavigateToTab('importer')}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition duration-150 cursor-pointer"
            >
              افتح الآن نافذة الاستيراد
            </button>
          </div>
        </div>
      </div>

      {/* ==================== 🏫 FULL-FEATURED STUDENT DIRECTORY SCREEN (MAIN) ==================== */}
      <div className="bg-white rounded-3xl border border-slate-100 p-6 shadow-sm space-y-6" id="student-directory-section">
        
        {/* Section Header with Quick Config Control Toggle */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-b border-slate-100 pb-5">
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <h2 className="text-xl font-extrabold text-slate-800 flex items-center gap-2">
                <Users2 className="w-6 h-6 text-indigo-600" />
                سجل ودليل طلاب ({schoolName}) الشامل
              </h2>
              <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1">
                <span className="text-[10px] text-slate-400 font-bold">تعديل اسم المدرسة:</span>
                <input
                  type="text"
                  value={schoolName}
                  onChange={(e) => onUpdateSchoolName(e.target.value)}
                  className="bg-transparent text-xs font-bold text-indigo-600 border-none outline-hidden min-w-[160px] text-right focus:ring-0 focus:outline-hidden"
                  placeholder="اسم المدرسة..."
                />
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              مراجعة وتعديل بيانات الطلاب، التحقق من الواتساب، والتحكم بعمليات حذف السجلات
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowDeletionConsole(prev => !prev)}
              className={`px-4 py-2 rounded-xl text-xs font-black transition duration-150 cursor-pointer flex items-center gap-1.5 border ${
                showDeletionConsole 
                  ? 'bg-rose-50 text-rose-700 border-rose-200' 
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <Settings className="w-4 h-4" />
              بث عمليات الحذف والتهيئة
            </button>
            <span className="text-xs bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded-full font-bold font-mono">
              إجمالي الطلاب: {students.length}
            </span>
          </div>
        </div>

        {/* Toggleable BULK DELETION Console Box */}
        {showDeletionConsole && (
          <div className="bg-rose-50/45 border border-rose-100 rounded-2xl p-5 space-y-4 animate-fade-in" id="bulk-deletion-console">
            <div className="flex items-center gap-2 border-b border-rose-100/60 pb-2.5">
              <Trash2 className="w-5 h-5 text-rose-600" />
              <h3 className="font-black text-rose-900 text-sm">لوحة العمليات السائبة للتفريغ والحذف الجماعي للفئات</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
              
              {/* Option A: Delete selected section or selected grade */}
              <div className="md:col-span-8 grid grid-cols-1 sm:grid-cols-2 gap-3 bg-white p-4 rounded-xl border border-rose-100 shadow-3xs">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">اختر الصف الدراسي المراد تهيئته:</label>
                  <select
                    value={bulkGradeToDelete}
                    onChange={e => {
                      setBulkGradeToDelete(e.target.value);
                      setBulkSectionToDelete('');
                    }}
                    className="w-full p-2 bg-slate-50 border border-slate-250 focus:border-indigo-500 rounded-lg text-xs"
                  >
                    <option value="">-- حدد الصف الدراسي --</option>
                    {bulkGradesList.map(g => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-705 mb-1.5">اختر الشعبة لحذفها منفردة (اختياري):</label>
                  <select
                    value={bulkSectionToDelete}
                    onChange={e => setBulkSectionToDelete(e.target.value)}
                    disabled={!bulkGradeToDelete}
                    className="w-full p-2 bg-slate-50 border border-slate-250 focus:border-indigo-500 rounded-lg text-xs disabled:opacity-50"
                  >
                    <option value="">-- حذف كافة شعب الصف المختار --</option>
                    {bulkSectionsList.map(s => (
                      <option key={s} value={s}>شعبة ({s})</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Action dispatchers for option A */}
              <div className="md:col-span-4 flex flex-col gap-2">
                {bulkGradeToDelete && bulkSectionToDelete ? (
                  <button
                    onClick={handleDeleteSectionGroup}
                    className="w-full py-2.5 bg-rose-650 hover:bg-rose-700 text-white font-bold rounded-xl text-xs cursor-pointer text-center duration-150 transition shadow-xs"
                  >
                    حذف الشعبة ({bulkSectionToDelete}) بصف ({bulkGradeToDelete})
                  </button>
                ) : (
                  <button
                    onClick={handleDeleteGradeGroup}
                    disabled={!bulkGradeToDelete}
                    className="w-full py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-xs cursor-pointer text-center duration-150 transition disabled:opacity-40"
                  >
                    حذف الصف ({bulkGradeToDelete || 'المحدد'}) بالكامل
                  </button>
                )}

                <button
                  onClick={handleWipeEntireRegistry}
                  className="w-full py-2.5 bg-rose-900 hover:bg-black text-rose-100 font-extrabold rounded-xl text-xs cursor-pointer text-center duration-150 transition shadow-sm border border-rose-800"
                >
                  ⚠️ تصفير سجل المدرسة بالكامل (حذف الكل)
                </button>
              </div>

            </div>
          </div>
        )}

        {/* Interactive Filtering and Advanced Search Controls */}
        <div className="flex flex-col lg:flex-row items-stretch gap-3 bg-slate-50 p-4 rounded-2xl border border-slate-100" id="directory-filtering-dashboard">
          
          {/* Text Search field */}
          <div className="flex-1 relative">
            <Search className="w-4.5 h-4.5 text-slate-400 absolute right-3 mt-3" />
            <input
              type="text"
              placeholder="ابحث بالاسم، الإنجليزي، هاتف الأب، الهوية، الملاحظات..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pr-10 pl-3 py-2.5 bg-white border border-slate-200 focus:border-indigo-500 rounded-xl text-xs transition outline-hidden shadow-3xs"
            />
            {searchTerm && (
              <button 
                onClick={() => setSearchTerm('')} 
                className="absolute left-3 mt-3 text-slate-400 hover:text-slate-600 text-xs font-semibold"
              >
                مسح
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 shrink-0">
            
            {/* Grade Filter */}
            <div className="flex items-center bg-white border border-slate-200 rounded-xl px-2.5 shadow-3xs">
              <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-1.5" />
              <select
                value={selectedGradeFilter}
                onChange={e => {
                  setSelectedGradeFilter(e.target.value);
                  setSelectedSectionFilter('all'); // Clear sub filter
                }}
                className="bg-transparent border-0 py-2 w-full text-xs text-slate-700 outline-hidden focus:ring-0"
              >
                <option value="all">كل الصفوف الدراسية</option>
                {gradesList.map(g => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </div>

            {/* Section Filter */}
            <div className="flex items-center bg-white border border-slate-200 rounded-xl px-2.5 shadow-3xs">
              <Layers className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-1.5" />
              <select
                value={selectedSectionFilter}
                onChange={e => setSelectedSectionFilter(e.target.value)}
                className="bg-transparent border-0 py-2 w-full text-xs text-slate-700 outline-hidden focus:ring-0"
              >
                <option value="all">كل الشعب الملحقة</option>
                {sectionsListForSelectedGrade.map(s => (
                  <option key={s} value={s}>شعبة ({s})</option>
                ))}
              </select>
            </div>

            {/* Records limit trigger */}
            <div className="col-span-2 md:col-span-1 flex items-center bg-white border border-slate-200 rounded-xl px-2.5 shadow-3xs">
              <span className="text-[10px] text-slate-400 shrink-0 ml-1">عرض:</span>
              <select
                value={studentsLimit}
                onChange={e => setStudentsLimit(Number(e.target.value))}
                className="bg-transparent border-0 py-2 w-full text-[11px] text-slate-700 outline-hidden focus:ring-0"
              >
                <option value={25}>25 سجل</option>
                <option value={50}>50 سجل</option>
                <option value={100}>100 سجل</option>
                <option value={1000}>الكل</option>
              </select>
            </div>

          </div>
        </div>

        {/* Search Results Summary Banner */}
        <div className="flex items-center justify-between text-xs text-slate-500 font-sans px-1" id="search-results-stats-banner">
          <span>نتائج البحث والفلترة: العثور على <strong className="text-slate-700 font-mono font-bold">{filteredStudents.length} طلاب</strong></span>
          {students.length > 0 && filteredStudents.length === 0 && (
            <span className="text-rose-600 font-bold">لا توجد مطابقة لخياراتك الحالية. جرب تغيير مدخلات البحث.</span>
          )}
        </div>

        {/* Directory Student Table View */}
        <div className="overflow-x-auto rounded-2xl border border-slate-100 bg-slate-50/20" id="student-directory-table-container">
          {filteredStudents.length === 0 ? (
            <div className="p-12 text-center text-slate-400 flex flex-col items-center justify-center space-y-2">
              <AlertCircle className="w-8 h-8 text-slate-350" />
              <p className="font-bold text-sm">لم يتم العثور على أي طلاب بسجل ({schoolName})</p>
              <p className="text-xs">استورد كشف إكسل أو عدل فلاتر التصفية أعلاه لعرض البيانات.</p>
            </div>
          ) : (
            <table className="w-full text-right text-xs" id="directory-table">
              <thead>
                <tr className="bg-slate-50 text-slate-600 border-b border-slate-150 font-bold">
                  <th className="py-3 px-4">رقم التعريف/الأكاديمي</th>
                  <th className="py-3 px-4">اسم الطالب / الإنجليزي</th>
                  <th className="py-3 px-4">الصف والشعبة</th>
                  <th className="py-3 px-4">ولي الأمر</th>
                  <th className="py-3 px-4">جوال عائلي</th>
                  <th className="py-3 px-4">تليفون بديل</th>
                  <th className="py-3 px-4">حساب مودل</th>
                  <th className="py-3 px-4 text-center">خدمات سريعة واختبارات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredStudents.slice(0, studentsLimit).map((student) => {
                  return (
                    <tr key={student.id} className="hover:bg-slate-50/40 transition duration-100">
                      
                      {/* Stud ID */}
                      <td className="py-3 px-4 font-mono text-slate-600 font-semibold">
                        {student.idNumber || student.id}
                      </td>

                      {/* Name Arabic & English */}
                      <td className="py-3 px-4">
                        <div className="font-extrabold text-slate-800">{student.name}</div>
                        {student.nameEn && (
                          <div className="text-[10px] text-slate-405 font-mono leading-none mt-0.5">{student.nameEn}</div>
                        )}
                      </td>

                      {/* Class Grade and Section */}
                      <td className="py-3 px-4">
                        <span className="bg-indigo-50 text-indigo-700 font-semibold px-2 py-0.5 rounded-md text-[10px] inline-block font-sans">
                          {student.grade} - الشعبة ({student.section})
                        </span>
                      </td>

                      {/* Parent name */}
                      <td className="py-3 px-4 text-slate-700">
                        {student.parentName}
                      </td>

                      {/* Primary mobile */}
                      <td className="py-3 px-4 font-mono text-slate-800 font-bold">
                        {student.phone}
                        {!isSendablePhone(student.phone) && (
                          <span
                            className="block text-[10px] font-sans font-bold text-amber-700"
                            title="سيتم استبعاد هذا الطالب من الإرسال حتى تصحيح الرقم"
                          >
                            ⚠️ {PHONE_PROBLEM_LABELS[checkPhone(student.phone).problem || 'invalid']}
                          </span>
                        )}
                      </td>

                      {/* Backup Phone */}
                      <td className="py-3 px-4 font-mono text-slate-600">
                        {student.phone2 || (
                          <span className="text-slate-300">غير معرّف</span>
                        )}
                      </td>

                      {/* Moodle default credentials (password masked, shown on demand) */}
                      <td className="py-3 px-4 text-[11px]">
                        {student.moodleUsername || student.moodlePassword ? (
                          <div className="space-y-0.5">
                            <div className="font-mono text-slate-700" dir="ltr">{student.moodleUsername || '—'}</div>
                            <SecretText value={student.moodlePassword} />
                          </div>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>

                      {/* Call/Whatsapp actions button shortcuts */}
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-center gap-2.5">
                          
                          {/* 📞 Call Student Button */}
                          <button
                            onClick={() => setActiveCallStudent(student)}
                            title="اتصال هاتفي سريع"
                            className="p-1.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition cursor-pointer flex items-center justify-center shadow-3xs"
                          >
                            <Phone className="w-3.5 h-3.5" />
                          </button>

                          {/* 💬 Whatsapp Lookup check */}
                          <button
                            onClick={() => setActiveWhatsAppStudent(student)}
                            title="فحص حساب الواتساب ببادئات فلسطين"
                            className="p-1.5 rounded-lg bg-teal-50 text-teal-700 hover:bg-teal-100 transition cursor-pointer flex items-center justify-center shadow-3xs"
                          >
                            <MessageSquareText className="w-3.5 h-3.5 text-emerald-600" />
                          </button>

                          {/* 👁️ Inspectors Complete Student card */}
                          <button
                            onClick={() => setActiveDetailsStudent(student)}
                            title="عرض قائمة البيانات الـ 30 كاملة"
                            className="p-1.5 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-105 transition cursor-pointer flex items-center justify-center shadow-3xs"
                          >
                            <Eye className="w-3.5 h-3.5 text-indigo-600" />
                          </button>

                          {/* 🗑️ Single student deletion */}
                          <button
                            onClick={() => handleDeleteSingleStudent(student)}
                            title="حذف الطالب من السجلات"
                            className="p-1.5 rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100 transition cursor-pointer flex items-center justify-center shadow-3xs"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>

                        </div>
                      </td>

                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Directory Table Footer display limits */}
        {filteredStudents.length > studentsLimit && (
          <div className="text-center py-2 border-t border-slate-50">
            <button
              onClick={() => setStudentsLimit(prev => prev + 25)}
              className="text-indigo-600 hover:text-indigo-800 font-bold text-xs"
            >
              عرض المزيد من الطلاب (+25 طالبًا)
            </button>
          </div>
        )}

      </div>

      {/* ==================== MODAL A: 🔍 TOTAL 30-FIELDS STUDENT INSPECTOR ==================== */}
      {activeDetailsStudent && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 overflow-y-auto" id="inspected-student-modal">
          <div className="bg-white rounded-3xl w-full max-w-4xl p-6 sm:p-8 space-y-6 shadow-2xl relative max-h-[90vh] overflow-y-auto border border-slate-100 text-right animate-fade-in">
            
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
                  <User className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-extrabold text-slate-800">بيانات بطاقة الطالب الكاملة (30 حقل معتمد)</h3>
                  <p className="text-xs text-slate-400">ملف الطالب الأكاديمي والاجتماعي الموثق بالوزارة</p>
                </div>
              </div>
              <button
                onClick={() => setActiveDetailsStudent(null)}
                className="p-1.5 hover:bg-slate-100 rounded-full cursor-pointer transition text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 30 fields broken down by logical themed compartments */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 font-sans">
              
              {/* Category 1: البيانات الدراسية والتسجيلية */}
              <div className="bg-slate-50/50 rounded-2xl border border-slate-100 p-4 space-y-3.5">
                <h4 className="font-black text-xs text-indigo-800 border-b border-indigo-100 pb-1.5 flex items-center gap-1">
                  <GraduationCap className="w-4 h-4 shrink-0" />
                  البيانات الدراسية والتسجيلية
                </h4>
                <div className="space-y-2.5">
                  <div>
                    <label className="text-[10px] text-slate-400 block font-semibold">المنطقة</label>
                    <span className="text-xs font-bold text-slate-750">{activeDetailsStudent.district || 'غير مسجل'}</span>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block font-semibold">المدرسة</label>
                    <span className="text-xs font-bold text-slate-750">{activeDetailsStudent.school || 'غير مسجل'}</span>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block font-semibold">الصف</label>
                    <span className="text-xs font-bold text-slate-750">{activeDetailsStudent.grade || 'غير مسجل'}</span>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block font-semibold">الشعبة</label>
                    <span className="text-xs font-bold text-slate-750">{activeDetailsStudent.section || 'غير مسجل'}</span>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block font-semibold">نوع بطاقة التعريف</label>
                    <span className="text-xs font-bold text-slate-750">{activeDetailsStudent.idType || 'غير مسجل'}</span>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block font-semibold">رقم بطاقة التعريف</label>
                    <span className="text-xs font-mono font-bold text-slate-750">{activeDetailsStudent.idNumber || activeDetailsStudent.id || 'غير مسجل'}</span>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block font-semibold">رقم تسجيل الفرد</label>
                    <span className="text-xs font-mono font-bold text-slate-750">{activeDetailsStudent.individualRegNum || 'غير مسجل'}</span>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block font-semibold">رقم تسجيل العائلة</label>
                    <span className="text-xs font-mono font-bold text-slate-750">{activeDetailsStudent.familyRegNum || 'غير مسجل'}</span>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block font-semibold">معدل الطالب العام السابق</label>
                    <span className="text-xs font-mono font-black text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-sm inline-block">
                      {activeDetailsStudent.previousYearGPA || 'غير محدد'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Category 2: الهوية والبيانات الشخصية */}
              <div className="bg-slate-50/50 rounded-2xl border border-slate-100 p-4 space-y-3.5">
                <h4 className="font-black text-xs text-teal-800 border-b border-teal-105 pb-1.5 flex items-center gap-1">
                  <User className="w-4 h-4 shrink-0 text-teal-600" />
                  الهوية والبيانات الشخصية
                </h4>
                <div className="space-y-2.5">
                  <div>
                    <label className="text-[10px] text-slate-400 block font-semibold">اسم الطالب</label>
                    <span className="text-xs font-black text-slate-800">{activeDetailsStudent.name || 'غير مسجل'}</span>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block font-semibold">اسم الطالب انجليزي</label>
                    <span className="text-xs font-mono font-semibold text-slate-700 block" dir="ltr">{activeDetailsStudent.nameEn || 'غير مسجل'}</span>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block font-semibold">الجنس</label>
                    <span className="text-xs font-bold text-slate-750">{activeDetailsStudent.gender || 'غير مسجل'}</span>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block font-semibold">تاريخ الميلاد</label>
                    <span className="text-xs font-bold font-mono text-slate-750">{activeDetailsStudent.birthDate || 'غير مسجل'}</span>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block font-semibold">مكان الميلاد</label>
                    <span className="text-xs font-bold text-slate-755">{activeDetailsStudent.birthPlace || 'غير مسجل'}</span>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block font-semibold">الجنسية</label>
                    <span className="text-xs font-bold text-slate-750">{activeDetailsStudent.nationality || 'غير مسجل'}</span>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block font-semibold">الديانة</label>
                    <span className="text-xs font-bold text-slate-750">{activeDetailsStudent.religion || 'غير مسجل'}</span>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block font-semibold">حالة اللجوء</label>
                    <span className="text-xs font-bold text-slate-750">{activeDetailsStudent.refugeeStatus || 'غير مسجل'}</span>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block font-semibold">يسكن في المخيم</label>
                    <span className="text-xs font-bold text-slate-750">{activeDetailsStudent.livesInCamp || 'لا'}</span>
                  </div>
                </div>
              </div>

              {/* Category 3: بيانات العائلة وحسابات الاتصال */}
              <div className="bg-slate-50/50 rounded-2xl border border-slate-100 p-4 space-y-3.5">
                <h4 className="font-black text-xs text-amber-800 border-b border-amber-100 pb-1.5 flex items-center gap-1">
                  <Smartphone className="w-4 h-4 shrink-0 text-amber-600" />
                  بيانات العائلة والاتصال السلوكي
                </h4>
                <div className="space-y-2.5">
                  <div>
                    <label className="text-[10px] text-slate-400 block font-semibold">اسم ولي امر الطالب</label>
                    <span className="text-xs font-bold text-slate-800 block">{activeDetailsStudent.parentName || 'غير مسجل'}</span>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block font-semibold">مهنة ولي الأمر</label>
                    <span className="text-xs font-bold text-slate-700 block">{activeDetailsStudent.parentJob || 'غير مسجل'}</span>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block font-semibold">اسم الأم</label>
                    <span className="text-xs font-bold text-slate-750 block">{activeDetailsStudent.motherName || 'غير مسجل'}</span>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block font-semibold">مهنة الأم</label>
                    <span className="text-xs font-bold text-slate-700 block">{activeDetailsStudent.motherJob || 'غير مسجل'}</span>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block font-semibold">العنوان</label>
                    <span className="text-xs font-bold text-slate-750 block">{activeDetailsStudent.address || 'غير مسجل'}</span>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block font-semibold">المدينة / المحافظة</label>
                    <span className="text-xs font-bold text-slate-750 block">{(activeDetailsStudent.city || '')} - {(activeDetailsStudent.governorate || '')}</span>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block font-semibold">البلدة الأصلية</label>
                    <span className="text-xs font-bold text-slate-750 block">{activeDetailsStudent.originalTown || 'غير مسجل'}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-2">
                    <div>
                      <label className="text-[9px] text-slate-400 block font-semibold">جوال العائلة (رئيسي)</label>
                      <span className="text-[11px] font-bold font-mono text-emerald-700">{activeDetailsStudent.phone}</span>
                    </div>
                    <div>
                      <label className="text-[9px] text-slate-400 block font-semibold">تليفون العائلة (بديل)</label>
                      <span className="text-[11px] font-bold font-mono text-slate-700">{activeDetailsStudent.phone2 || 'غير مسجل'}</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block font-semibold">شبكة الأمان الاجتماعي</label>
                    <span className="text-xs font-bold text-slate-750 block">{activeDetailsStudent.socialSecurity || 'غير محدد'}</span>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block font-semibold">هل لديه مرض مزمن</label>
                    <span className="text-xs font-bold text-slate-750 block">{activeDetailsStudent.hasChronicDisease || 'لا يوجد'}</span>
                  </div>
                </div>
              </div>

            </div>

            {/* Custom Notes Section Footer */}
            {activeDetailsStudent.notes && (
              <div className="bg-amber-50/50 border border-amber-100 rounded-xl p-3.5 mt-4">
                <h5 className="text-xs font-bold text-amber-800 mb-1">📝 ملاحظات مالية ومستحقات مخصصة مرافقة:</h5>
                <p className="text-xs text-slate-700 select-all font-sans leading-relaxed">{activeDetailsStudent.notes}</p>
              </div>
            )}

            {/* Close footer buttons */}
            <div className="flex justify-end pt-4 border-t border-slate-100">
              <button
                onClick={() => setActiveDetailsStudent(null)}
                className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs cursor-pointer"
              >
                حفظ وإغلاق نافذة العرض
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ==================== MODAL B: 💬 ADVANCED WHATSAPP VERIFICATION (PREF +972 / +970) ==================== */}
      {activeWhatsAppStudent && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 text-right" id="whatsapp-lookup-modal">
          <div className="bg-white rounded-3xl w-full max-w-md p-6 shadow-2xl relative border border-slate-100 space-y-5 animate-fade-in">
            
            <div className="flex items-center justify-between border-b border-slate-150 pb-3">
              <div className="flex items-center gap-1.5">
                <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
                <h3 className="font-extrabold text-sm text-slate-800">البحث والتحقق عن هاتف الطالب في الواتساب</h3>
              </div>
              <button
                onClick={() => setActiveWhatsAppStudent(null)}
                className="p-1 cursor-pointer hover:bg-slate-100 rounded-full transition text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500 leading-relaxed">
              قم بفحص المراسلة السريعة لولي أمر الطالب <strong>({activeWhatsAppStudent.name})</strong> للوصول المباشر وتأكيد الاستلام فوراً:
            </p>

            <div className="space-y-4 font-sans text-right">
              
              {/* PRIMARY PHONE */}
              <div className="bg-slate-50 rounded-2xl p-4 border border-slate-150 relative space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-sm">جوال العائلة (الرئيسي)</span>
                  <span className="text-xs font-mono font-bold text-slate-800">{activeWhatsAppStudent.phone}</span>
                </div>
                
                {activeWhatsAppStudent.phone ? (
                  <div className="flex flex-col gap-1.5 font-sans">
                    <a
                      href={`https://wa.me/972${getCleanMobileForWhatsApp(activeWhatsAppStudent.phone)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full px-3 py-2 text-center text-white bg-emerald-600 hover:bg-emerald-700 font-extrabold rounded-lg text-[11px] flex items-center justify-center gap-1.5 transition shadow-xs"
                    >
                      🇵🇸 فلسطين رئيسي (+972)
                    </a>
                    <a
                      href={`https://wa.me/970${getCleanMobileForWhatsApp(activeWhatsAppStudent.phone)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full px-3 py-2 text-center text-white bg-teal-600 hover:bg-teal-700 font-extrabold rounded-lg text-[11px] flex items-center justify-center gap-1.5 transition shadow-xs"
                    >
                      🇵🇸 فلسطين بديل (+970)
                    </a>
                  </div>
                ) : (
                  <div className="text-xs text-rose-600 font-bold font-sans">لا يوجد رقم هاتف رئيسي معرّف</div>
                )}
              </div>

              {/* SECONDARY PHONE */}
              <div className="bg-slate-50 rounded-2xl p-4 border border-slate-150 relative space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] bg-slate-250 text-indigo-800 bg-indigo-100 font-bold px-2 py-0.5 rounded-sm">تليفون العائلة (البديل)</span>
                  <span className="text-xs font-mono font-bold text-slate-800">
                    {activeWhatsAppStudent.phone2 || 'غير متوفر'}
                  </span>
                </div>

                {activeWhatsAppStudent.phone2 ? (
                  <div className="flex flex-col gap-1.5 animate-fade-in font-sans">
                    <a
                      href={`https://wa.me/972${getCleanMobileForWhatsApp(activeWhatsAppStudent.phone2)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full px-3 py-2 text-center text-white bg-emerald-600 hover:bg-emerald-700 font-extrabold rounded-lg text-[11px] flex items-center justify-center gap-1.5 transition shadow-xs"
                    >
                      🇵🇸 فلسطين رئيسي (+972)
                    </a>
                    <a
                      href={`https://wa.me/970${getCleanMobileForWhatsApp(activeWhatsAppStudent.phone2)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full px-3 py-2 text-center text-white bg-teal-600 hover:bg-teal-700 font-extrabold rounded-lg text-[11px] flex items-center justify-center gap-1.5 transition shadow-xs"
                    >
                      🇵🇸 فلسطين بديل (+970)
                    </a>
                  </div>
                ) : (
                  <div className="text-[10px] text-slate-400 text-center leading-relaxed py-1">
                    * الطالب لا يملك تليفون بديل مسجل في لوحة الإكسل الحالية لتجربة إرسال رسائل مستقل من خلالها.
                  </div>
                )}
              </div>

            </div>

            <div className="pt-2 border-t border-slate-100 flex justify-end">
              <button
                onClick={() => setActiveWhatsAppStudent(null)}
                className="px-5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-lg cursor-pointer"
              >
                إغلاق
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ==================== MODAL C: 📞 DIRECT CALL OPTION DIALOGUE ==================== */}
      {activeCallStudent && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 text-right" id="call-student-modal">
          <div className="bg-white rounded-3xl w-full max-w-sm p-6 shadow-2xl relative border border-slate-100 space-y-4 animate-fade-in">
            
            <div className="flex items-center justify-between border-b border-slate-150 pb-2">
              <div className="flex items-center gap-1.5">
                <Phone className="w-5 h-5 text-emerald-600" />
                <h3 className="font-extrabold text-sm text-slate-800">الاتصال المباشر بولي الأمر</h3>
              </div>
              <button
                onClick={() => setActiveCallStudent(null)}
                className="p-1 cursor-pointer hover:bg-slate-100 rounded-full transition text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500 leading-relaxed">
              اختر الرقم المراد الاتصال به للتواصل الفوري مع عائلة الطالب <strong>({activeCallStudent.name})</strong>:
            </p>

            <div className="space-y-3">
              
              {/* Primary call dialer block */}
              {activeCallStudent.phone && (
                <a
                  href={`tel:${activeCallStudent.phone}`}
                  className="w-full p-4 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl flex items-center justify-between transition group cursor-pointer block text-right text-xs"
                >
                  <div>
                    <span className="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded-xs block w-max font-bold mb-1">جوال العائلة (الرئيسي)</span>
                    <span className="font-bold text-slate-800">{activeCallStudent.parentName}</span>
                  </div>
                  <div className="flex items-center gap-2 font-mono">
                    <span className="font-bold text-slate-700">{activeCallStudent.phone}</span>
                    <div className="p-2 bg-emerald-600 text-white rounded-full group-hover:scale-105 duration-100">
                      <Phone className="w-3.5 h-3.5" />
                    </div>
                  </div>
                </a>
              )}

              {/* Secondary call dialer block */}
              {activeCallStudent.phone2 ? (
                <a
                  href={`tel:${activeCallStudent.phone2}`}
                  className="w-full p-4 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-xl flex items-center justify-between transition group cursor-pointer block text-right text-xs"
                >
                  <div>
                    <span className="text-[10px] bg-indigo-150 text-indigo-800 px-1.5 py-0.5 rounded-xs block w-max font-bold mb-1">تليفون العائلة (البديل)</span>
                    <span className="font-bold text-slate-800">الرقم الاحتياطي</span>
                  </div>
                  <div className="flex items-center gap-2 font-mono">
                    <span className="font-bold text-slate-700">{activeCallStudent.phone2}</span>
                    <div className="p-2 bg-indigo-600 text-white rounded-full group-hover:scale-105 duration-100">
                      <Phone className="w-3.5 h-3.5" />
                    </div>
                  </div>
                </a>
              ) : (
                <div className="bg-slate-50 text-slate-400 rounded-xl p-3 text-center text-xs leading-normal">
                  * لا يوجد تليفون احتياطي مسجل في سجل هذا الطالب للاسترسال بالتبديل.
                </div>
              )}

            </div>

            <div className="pt-2 border-t border-slate-100 flex justify-end">
              <button
                onClick={() => setActiveCallStudent(null)}
                className="px-5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs rounded-lg cursor-pointer"
              >
                رجوع
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ==================== CUSTOM PORTAL MODAL B: React confirmation dialog ==================== */}
      {confirmationDialog.isOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-55 p-4 text-right animate-fade-in" id="custom-confirmation-modal">
          <div className="bg-white rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl border border-rose-100 flex flex-col justify-between">
            <div className="space-y-3">
              <h3 className="text-base font-extrabold text-slate-850 flex items-center gap-2">
                <AlertCircle className={`w-5 h-5 ${confirmationDialog.type === 'danger' ? 'text-rose-600' : 'text-amber-600'}`} />
                {confirmationDialog.title}
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed font-sans">
                {confirmationDialog.description}
              </p>
            </div>
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100 mt-4">
              <button
                onClick={() => setConfirmationDialog(prev => ({ ...prev, isOpen: false }))}
                className="px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl text-xs font-semibold cursor-pointer transition"
              >
                إلغاء الإجراء
              </button>
              <button
                onClick={() => {
                  try {
                    confirmationDialog.onConfirm();
                  } catch (e) {
                    console.error(e);
                  } finally {
                    setConfirmationDialog(prev => ({ ...prev, isOpen: false }));
                  }
                }}
                className={`px-4 py-2 text-white font-extrabold rounded-xl text-xs cursor-pointer transition ${
                  confirmationDialog.type === 'danger' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-amber-600 hover:bg-amber-700'
                }`}
              >
                تأكيد ومتابعة
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== CUSTOM PORTAL MODAL C: React notification alert dialog ==================== */}
      {alertDialog.isOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-55 p-4 text-right animate-fade-in" id="custom-alert-modal">
          <div className="bg-white rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl border border-slate-100 flex flex-col justify-between">
            <div className="space-y-3">
              <h3 className="text-base font-extrabold text-slate-850 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                {alertDialog.title}
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed font-sans">
                {alertDialog.description}
              </p>
            </div>
            <div className="flex items-center justify-end pt-4 border-t border-slate-100 mt-4">
              <button
                onClick={() => setAlertDialog(prev => ({ ...prev, isOpen: false }))}
                className="px-5 py-2 text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl text-xs font-bold cursor-pointer transition shadow-3xs"
              >
                حسناً، فهمت
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
