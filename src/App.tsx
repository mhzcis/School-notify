/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Student, MessageTemplate, ScheduledMessage, MessageLog, SchoolStats } from './types';
import { 
  DEFAULT_TEMPLATES, 
} from './data/mockStudents';

// Component imports
import DashboardOverview from './components/DashboardOverview';
import ExcelImporter from './components/ExcelImporter';
import MessageComposer, { ComposerPrefill } from './components/MessageComposer';
import { summarizeLogs } from './lib/logStatus';
import TemplatesManager from './components/TemplatesManager';
import Scheduler from './components/Scheduler';
import ReportsPanel from './components/ReportsPanel';
import SmsGatewaySettings from './components/SmsGatewaySettings';
import BackupPanel from './components/BackupPanel';
import { readArray, readJSON, writeJSON, getQuarantinedKeys } from './lib/storage';

// Icons
import { 
  LayoutDashboard, 
  MessageSquarePlus, 
  FileSpreadsheet, 
  Sparkles, 
  BookOpen, 
  Clock, 
  AreaChart, 
  Menu, 
  X, 
  CheckCircle, 
  Bell, 
  AlertCircle,
  SlidersHorizontal,
  DatabaseBackup
} from 'lucide-react';

export default function App() {
  // Navigation / UI States
  const [composerPrefill, setComposerPrefill] = useState<ComposerPrefill | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'compose' | 'importer' | 'templates' | 'scheduler' | 'reports' | 'sms-config' | 'backup'>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'info' | 'error' } | null>(null);

  // School Name state
  const [schoolName, setSchoolName] = useState<string>(() => {
    return localStorage.getItem('resal_school_name') || 'مدرسة المنارة الثانوية الشاملة';
  });
  const [isEditingSchool, setIsEditingSchool] = useState(false);
  const [tempSchoolName, setTempSchoolName] = useState(schoolName);

  const [excelImportedIds, setExcelImportedIds] = useState<string[] | null>(() => {
    const saved = readJSON<unknown>('resal_temp_excel_match_ids', null);
    return Array.isArray(saved) ? saved : null;
  });

  const handleUpdateSchoolName = (newName: string) => {
    setSchoolName(newName);
    localStorage.setItem('resal_school_name', newName);
  };

  const handleSelectExcelBatch = (matchedIds: string[]) => {
    setExcelImportedIds(matchedIds);
    localStorage.setItem('resal_temp_excel_match_ids', JSON.stringify(matchedIds));
    triggerNotification(`نجحت المطابقة! تم تفعيل استهداف (${matchedIds.length}) طالباً. تفضل بكتابة رسالتك الآن بنجاح.`);
    setActiveTab('compose');
  };

  // Persistence state hydration. A fresh install starts EMPTY (no demo students/logs/campaigns);
  // corrupt values are quarantined (resal_corrupt_*) instead of crashing or being silently lost.
  const [students, setStudents] = useState<Student[]>(() => readArray<Student>('resal_students', []));

  const [templates, setTemplates] = useState<MessageTemplate[]>(() =>
    readArray<MessageTemplate>('resal_templates', DEFAULT_TEMPLATES)
  );

  const [scheduledMessages, setScheduledMessages] = useState<ScheduledMessage[]>(() =>
    readArray<ScheduledMessage>('resal_scheduled', [])
  );

  const [logs, setLogs] = useState<MessageLog[]>(() => readArray<MessageLog>('resal_logs', []));

  const [quarantineNotice, setQuarantineNotice] = useState<string[]>(() => getQuarantinedKeys());

  // Sync state mutations to LocalStorage dynamically
  useEffect(() => {
    if (!writeJSON('resal_students', students)) {
      triggerNotification('تعذّر حفظ البيانات في المتصفح (قد تكون المساحة ممتلئة). خذ نسخة احتياطية الآن.', 'error');
    }
  }, [students]);

  useEffect(() => {
    if (!writeJSON('resal_templates', templates)) {
      triggerNotification('تعذّر حفظ البيانات في المتصفح (قد تكون المساحة ممتلئة). خذ نسخة احتياطية الآن.', 'error');
    }
  }, [templates]);

  useEffect(() => {
    if (!writeJSON('resal_scheduled', scheduledMessages)) {
      triggerNotification('تعذّر حفظ البيانات في المتصفح (قد تكون المساحة ممتلئة). خذ نسخة احتياطية الآن.', 'error');
    }
  }, [scheduledMessages]);

  useEffect(() => {
    if (!writeJSON('resal_logs', logs)) {
      triggerNotification('تعذّر حفظ البيانات في المتصفح (قد تكون المساحة ممتلئة). خذ نسخة احتياطية الآن.', 'error');
    }
  }, [logs]);

  // Timed dismiss triggers for notifications
  const triggerNotification = (message: string, type: 'success' | 'info' | 'error' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => {
      setNotification(null);
    }, 4500);
  };

  // 1. Excel Students Import Trigger
  const handleImportComplete = (imported: Student[]) => {
    // Merge by student ID to prevent duplicate primary keys
    setStudents(prev => {
      const mergedMap = new Map();
      prev.forEach(s => mergedMap.set(s.id, s));
      imported.forEach(s => mergedMap.set(s.id, s));
      return Array.from(mergedMap.values());
    });
    
    triggerNotification(`تم استيراد عدد (${imported.length}) سجلات طلاب بنجاح وتصنيف شعبهم الفئوية.`);
    setActiveTab('overview');
  };

  // 2. Add Saved Template Trigger
  const handleAddTemplate = (newTmpl: Omit<MessageTemplate, 'id'>) => {
    const nextId = 'TMP' + Math.floor(100 + Math.random() * 900);
    const templateWithId: MessageTemplate = {
      ...newTmpl,
      id: nextId
    };

    setTemplates(prev => [templateWithId, ...prev]);
    triggerNotification(`تم حفظ قالب الرسالة الجديد "${newTmpl.title}" في بنك النصوص التلقائية.`);
  };

  // 3. Edit/Modify existing template
  const handleUpdateTemplate = (updated: MessageTemplate) => {
    setTemplates(prev => prev.map(t => t.id === updated.id ? updated : t));
    triggerNotification(`تم تحديث صياغة القالب "${updated.title}" بنجاح.`);
  };

  // 4. Delete existing template
  const handleDeleteTemplate = (id: string) => {
    const target = templates.find(t => t.id === id);
    setTemplates(prev => prev.filter(t => t.id !== id));
    triggerNotification(`تم حذف القالب "${target?.title || id}" من القائمة.`, 'info');
  };

  // 5. Send Immediate Message Trigger (Evaluated and sent directly)
  const handleSendImmediate = (generatedLogs: MessageLog[]) => {
    setLogs(prev => [...generatedLogs, ...prev]);
    const summary = summarizeLogs(generatedLogs);
    // A scheduled campaign is completed only when real messages for it were actually handed over
    const campaignIds = new Set(
      generatedLogs.filter(l => l.campaignId && (l.status === 'sent' || l.status === 'delivered')).map(l => l.campaignId as string)
    );
    if (campaignIds.size > 0) {
      setScheduledMessages(prev =>
        prev.map(item => campaignIds.has(item.id) && item.status === 'pending' ? { ...item, status: 'completed' as const } : item)
      );
    }
    triggerNotification(
      `تم تسليم (${summary.successful}) رسالة للإرسال${summary.failed ? ` وفشلت (${summary.failed})` : ''}. ملاحظة: «أُرسلت» لا تعني تأكيد الاستلام على هاتف ولي الأمر.`,
      summary.failed ? 'info' : 'success'
    );
    setActiveTab('reports');
  };

  // 6. Schedule Campaign for date/time
  const handleScheduleMessage = (newSchedule: Omit<ScheduledMessage, 'id' | 'createdAt' | 'status'>) => {
    const nextId = 'SCH' + Math.floor(100 + Math.random() * 900);
    const scheduledWithId: ScheduledMessage = {
      ...newSchedule,
      id: nextId,
      createdAt: new Date().toISOString(),
      status: 'pending'
    };

    setScheduledMessages(prev => [scheduledWithId, ...prev]);
    triggerNotification(`تمت جدولة حملة "${newSchedule.title}" بنجاح ليوم ${newSchedule.scheduledTime.split('T')[0]}.`);
    setActiveTab('scheduler');
  };

  // 7. Cancel Scheduled Message
  const handleCancelSchedule = (id: string) => {
    setScheduledMessages(prev => 
      prev.map(item => item.id === id ? { ...item, status: 'cancelled' as const } : item)
    );
    triggerNotification(`تم إلغاء جدولة الحملة ونقلها للأرشيف غير النشط.`, 'info');
  };

  // 8. Bypass scheduler and dispatch immediately
  const handleDispatchImmediately = (id: string) => {
    const targetSchedule = scheduledMessages.find(item => item.id === id);
    if (!targetSchedule) return;

    // Determine targeted students
    let targets = [...students];
    if (targetSchedule.targetType === 'grade') {
      targets = targets.filter(s => s.grade === targetSchedule.targetGrade);
    } else if (targetSchedule.targetType === 'section') {
      targets = targets.filter(s => s.grade === targetSchedule.targetGrade && s.section === targetSchedule.targetSection);
    } else if (targetSchedule.targetType === 'custom' && targetSchedule.targetStudentIds) {
      targets = targets.filter(s => targetSchedule.targetStudentIds?.includes(s.id));
    }

    // Scheduled campaigns are never sent automatically and never faked: load the campaign into the
    // composer so the user reviews and confirms a real send. The campaign is marked completed only
    // when real logs carrying its campaignId come back (see handleSendImmediate).
    setComposerPrefill({
      campaignId: id,
      title: targetSchedule.title,
      content: targetSchedule.contentTemplate,
      studentIds: targets.map(s => s.id),
      phoneTarget: targetSchedule.phoneTarget || 'primary',
    });
    setActiveTab('compose');
    triggerNotification(`تم تحميل الحملة في شاشة الإرسال (${targets.length} طالب). راجعها ثم أكّد الإرسال.`, 'info');
  };

  const handleClearLogs = () => {
    setLogs([]);
    triggerNotification(`تم مسح تقارير الإرسال والاتصال تماماً.`, 'info');
  };

  // Compute school stats
  const distinctGrades = Array.from(new Set(students.map(s => s.grade)));
  const distinctSections = Array.from(new Set(students.map(s => s.section)));
  
  const stats: SchoolStats = {
    totalStudents: students.length,
    totalGrades: distinctGrades.length,
    totalSections: distinctSections.length,
    activeTemplates: templates.length,
    scheduledCampaigns: scheduledMessages.filter(m => m.status === 'pending').length,
    deliveredCount: logs.filter(l => l.status === 'delivered').length,
    sentCount: logs.filter(l => l.status === 'sent').length,
    failedCount: logs.filter(l => l.status === 'failed').length,
    pendingCount: logs.filter(l => l.status === 'pending').length
  };

  // Left sidebar navigation menus configuration
  const sidebarMenus = [
    { id: 'overview', label: 'الرئيسية والإحصاءات', icon: LayoutDashboard },
    { id: 'compose', label: 'شاشة بث الرسائل والموجه', icon: MessageSquarePlus },
    { id: 'importer', label: 'استيراد كشف إكسل (Excel)', icon: FileSpreadsheet },
    { id: 'templates', label: 'قوالب ونصوص التنبيهات', icon: BookOpen },
    { id: 'scheduler', label: 'الحملات والمواعيد مجدولة', icon: Clock },
    { id: 'reports', label: 'تقارير التسليم الفورية', icon: AreaChart },
    { id: 'sms-config', label: 'تهيئة بث رسائل SMS', icon: SlidersHorizontal },
    { id: 'backup', label: 'النسخ الاحتياطي والاستعادة', icon: DatabaseBackup }
  ] as const;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row text-right" dir="rtl" id="resal-app-root">
      
      {quarantineNotice.length > 0 && (
        <div id="storage-quarantine-notice" className="fixed top-3 left-1/2 -translate-x-1/2 z-50 max-w-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs rounded-xl p-3 shadow-lg">
          <p className="font-bold">تم العثور على بيانات تالفة في المتصفح ولم يتم حذفها.</p>
          <p className="mt-1">حُفظت نسخة من القيمة الأصلية باسم: <span dir="ltr" className="font-mono">{quarantineNotice.join(', ')}</span> — وتم تحميل قائمة فارغة بدلاً منها. خذ نسخة احتياطية قبل أي تعديل.</p>
          <button type="button" className="mt-2 underline" onClick={() => setQuarantineNotice([])}>إخفاء</button>
        </div>
      )}

      {/* Toast Notification Banner popup */}
      {notification && (
        <div 
          className={`fixed bottom-6 left-6 z-50 flex items-center gap-3 p-4 rounded-2xl shadow-xl border transition-all duration-300 max-w-md animate-bounce ${
            notification.type === 'success' 
              ? 'bg-emerald-900 text-emerald-50 border-emerald-800' 
              : notification.type === 'info'
              ? 'bg-indigo-900 text-indigo-50 border-indigo-800'
              : 'bg-rose-900 text-rose-50 border-rose-800'
          }`}
          id="toast-notification"
        >
          {notification.type === 'success' ? (
            <CheckCircle className="w-5 h-5 shrink-0 text-emerald-400" />
          ) : (
            <AlertCircle className="w-5 h-5 shrink-0 text-indigo-300" />
          )}
          <span className="text-xs font-bold font-sans leading-relaxed">{notification.message}</span>
          <button 
            onClick={() => setNotification(null)}
            className="text-white/60 hover:text-white cursor-pointer mr-auto text-sm shrink-0 font-sans"
          >
            ✕
          </button>
        </div>
      )}

      {/* Navigation Topbar for Mobile */}
      <header className="md:hidden bg-slate-900 text-white px-5 py-4 flex items-center justify-between sticky top-0 z-40 shadow-md">
        <div className="flex items-center gap-2">
          <div className="p-1 px-2.5 bg-emerald-600 rounded-lg text-white font-black text-xs">
            رـسـاـل
          </div>
          <span className="font-sans font-black text-xs">إدارة الاتصال والجدولة</span>
        </div>

        <button 
          onClick={() => setMobileMenuOpen(prev => !prev)}
          className="p-1.5 hover:bg-slate-800 text-slate-300 rounded-lg cursor-pointer transition"
          id="mobile-drawer-toggle"
        >
          {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </header>

      {/* Persistence Sidebar panel: Desktop / Mobile overlay */}
      <aside 
        className={`bg-slate-900 text-slate-200 w-64 shrink-0 p-5 flex flex-col justify-between fixed md:sticky top-0 h-screen z-40 transition-transform duration-300 ${
          mobileMenuOpen ? 'translate-x-0' : 'translate-x-full md:translate-x-0'
        }`}
        id="app-drawer-sidebar"
      >
        <div className="space-y-6">
          {/* Logo brand */}
          <div className="flex items-center gap-2 h-12 pb-4 border-b border-slate-800">
            <div className="p-1.5 px-3 bg-emerald-600 rounded-xl text-white font-bold text-sm tracking-wider shadow-inner">
              رـسـاـل
            </div>
            <div>
              <span className="font-extrabold text-sm block tracking-wide text-white">نظام ريسال المدرسي</span>
              <span className="text-[10px] text-slate-400 block mt-0.5">حلول الرسائل والجدولة الذكية</span>
            </div>
          </div>

          {/* Menus list */}
          <nav className="space-y-1.5" id="sidebar-drawer-menu">
            {sidebarMenus.map(menu => {
              const Icon = menu.icon;
              const isActive = activeTab === menu.id;
              
              return (
                <button
                  key={menu.id}
                  onClick={() => {
                    setActiveTab(menu.id);
                    setMobileMenuOpen(false); // Close mobile drawer
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-bold transition-all duration-150 cursor-pointer ${
                    isActive
                      ? 'bg-emerald-600 text-white shadow-md'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-500'}`} />
                  <span>{menu.label}</span>
                  {menu.id === 'scheduler' && stats.scheduledCampaigns > 0 && (
                    <span className="mr-auto font-mono bg-amber-500 text-slate-950 font-black text-[9px] px-2 py-0.5 rounded-full">
                      {stats.scheduledCampaigns}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* School name credit block */}
        <div className="pt-4 border-t border-slate-800 text-[10.5px] text-slate-500 space-y-1.5 leading-relaxed text-right">
          {isEditingSchool ? (
            <div className="flex items-center gap-1.5 animate-fade-in">
              <input
                type="text"
                value={tempSchoolName}
                onChange={(e) => setTempSchoolName(e.target.value)}
                onBlur={() => {
                  if (tempSchoolName.trim()) {
                    handleUpdateSchoolName(tempSchoolName.trim());
                  }
                  setIsEditingSchool(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (tempSchoolName.trim()) {
                      handleUpdateSchoolName(tempSchoolName.trim());
                    }
                    setIsEditingSchool(false);
                  } else if (e.key === 'Escape') {
                    setTempSchoolName(schoolName);
                    setIsEditingSchool(false);
                  }
                }}
                className="w-full text-[10.5px] px-2 py-1 bg-slate-850 text-white border border-slate-700 rounded-md outline-hidden focus:border-emerald-500 font-sans"
                autoFocus
              />
            </div>
          ) : (
            <div className="flex items-center justify-between gap-1 group">
              <div className="font-bold text-slate-300 font-sans truncate pr-1" title={schoolName}>{schoolName}</div>
              <button
                type="button"
                onClick={() => {
                  setTempSchoolName(schoolName);
                  setIsEditingSchool(true);
                }}
                className="text-[9.5px] text-slate-500 hover:text-emerald-400 font-bold flex items-center gap-0.5 whitespace-nowrap cursor-pointer transition py-0.5 px-1.5 rounded-md hover:bg-slate-800/40"
              >
                تعديل 📝
              </button>
            </div>
          )}
          <div className="text-[10px] text-slate-400 font-mono">تحديث البيانات: 2026-05-29</div>
          <div className="text-emerald-500 font-sans text-[10px] flex items-center gap-1.5 font-bold">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping" />
            <span>الجهاز متصل بالبوابة</span>
          </div>
        </div>
      </aside>

      {/* Screen Backdrop for mobile menu */}
      {mobileMenuOpen && (
        <div 
          onClick={() => setMobileMenuOpen(false)}
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          id="mobile-drawer-backdrop"
        />
      )}

      {/* Primary Dashboard Content Area */}
      <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full space-y-6 overflow-x-hidden">
        
        {/* Dynamic rendered Tab Screens */}
        <div className="animate-fade-in transition duration-300">
          {activeTab === 'overview' && (
            <DashboardOverview 
              stats={stats} 
              onNavigateToTab={(tab) => setActiveTab(tab)} 
              students={students}
              onUpdateStudents={setStudents}
              schoolName={schoolName}
              onUpdateSchoolName={handleUpdateSchoolName}
            />
          )}

          {activeTab === 'compose' && (
            <MessageComposer
              students={students}
              templates={templates}
              onSendImmediate={handleSendImmediate}
              prefill={composerPrefill}
              onPrefillConsumed={() => setComposerPrefill(null)}
              onScheduleMessage={handleScheduleMessage}
              schoolName={schoolName}
              onUpdateSchoolName={handleUpdateSchoolName}
              excelImportedIds={excelImportedIds}
              onClearImportedIds={() => {
                setExcelImportedIds(null);
                localStorage.removeItem('resal_temp_excel_match_ids');
              }}
              onAddTemplate={handleAddTemplate}
            />
          )}

          {activeTab === 'sms-config' && (
            <SmsGatewaySettings schoolName={schoolName} />
          )}

          {activeTab === 'importer' && (
            <ExcelImporter
              students={students}
              onImportComplete={handleImportComplete}
              currentStudentsCount={students.length}
              onSelectExcelBatch={handleSelectExcelBatch}
            />
          )}

          {activeTab === 'templates' && (
            <TemplatesManager
              templates={templates}
              onAddTemplate={handleAddTemplate}
              onUpdateTemplate={handleUpdateTemplate}
              onDeleteTemplate={handleDeleteTemplate}
            />
          )}

          {activeTab === 'scheduler' && (
            <Scheduler
              scheduledMessages={scheduledMessages}
              onCancelSchedule={handleCancelSchedule}
              onDispatchImmediately={handleDispatchImmediately}
            />
          )}

          {activeTab === 'backup' && (
            <BackupPanel />
          )}

          {activeTab === 'reports' && (
            <ReportsPanel
              logs={logs}
              onClearLogs={handleClearLogs}
            />
          )}
        </div>

      </main>

    </div>
  );
}
