/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Student, MessageTemplate, ScheduledMessage, MessageLog, SchoolStats } from './types';
import { DEFAULT_TEMPLATES } from './data/mockStudents';

// Component imports
import DashboardOverview from './components/DashboardOverview';
import ExcelImporter from './components/ExcelImporter';
import MessageComposer, { ComposerPrefill } from './components/MessageComposer';
import { summarizeLogs } from './lib/logStatus';
import TemplatesManager from './components/TemplatesManager';
import Scheduler from './components/Scheduler';
import ReportsPanel from './components/ReportsPanel';
import SmsGatewaySettings, { GatewayStatus } from './components/SmsGatewaySettings';
import BackupPanel from './components/BackupPanel';
import { RepoError, SchoolRepository, repoErrorMessage } from './lib/repo/types';
import { newId } from './lib/repo/mapping';
import { fetchStatusesOnce, FINAL_GATEWAY_STATES, GATEWAY_STATE_LABELS } from './lib/smsProxy';
import type { ProxyInvoker, ProxyResponse, GatewayStatus as SmsGatewayState, GatewayState } from './lib/smsProxy';
import { invokeSmsFunction } from './lib/supabase';
import { logStatusForState, mergeState } from '../supabase/functions/school-notify-sms-webhook/webhook';
import type { GatewayLogUpdate } from './lib/repo/types';
import type { AuthUser } from './auth/authService';
import { UI_PREF_KEYS } from './lib/smsPrefs';

// Icons
import { 
  LayoutDashboard, 
  MessageSquarePlus, 
  FileSpreadsheet, 
  BookOpen, 
  Clock, 
  AreaChart, 
  Menu, 
  X, 
  CheckCircle, 
  AlertCircle,
  SlidersHorizontal,
  DatabaseBackup,
  LogOut,
  Loader2,
  RefreshCw
} from 'lucide-react';

export interface AppProps {
  repo: SchoolRepository;
  user: AuthUser;
  onSignOut: () => void | Promise<void>;
  /** Called when a cloud request fails because the session expired / was revoked. */
  onAuthFailure?: () => void;
  /** Gateway status probe (defaults to the Edge Function in production wiring). */
  checkGateway?: () => Promise<ProxyResponse>;
  /** Edge Function invoker used for "تحديث الحالة" (defaults to the real one). */
  invokeSms?: ProxyInvoker;
}

const SEEDED_KEY = (uid: string) => `sn_default_templates_seeded:${uid}`;

export default function App({ repo, user, onSignOut, onAuthFailure, checkGateway, invokeSms = invokeSmsFunction }: AppProps) {
  // Navigation / UI States
  const [composerPrefill, setComposerPrefill] = useState<ComposerPrefill | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'compose' | 'importer' | 'templates' | 'scheduler' | 'reports' | 'sms-config' | 'backup'>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'info' | 'error' } | null>(null);

  // School name is a non-sensitive UI preference (localStorage).
  const [schoolName, setSchoolName] = useState<string>(() => {
    return localStorage.getItem(UI_PREF_KEYS.schoolName) || 'مدرسة المنارة الثانوية الشاملة';
  });
  const [isEditingSchool, setIsEditingSchool] = useState(false);
  const [tempSchoolName, setTempSchoolName] = useState(schoolName);

  // Excel-matched targets are kept in memory only (they are student identifiers).
  const [excelImportedIds, setExcelImportedIds] = useState<string[] | null>(null);

  const handleUpdateSchoolName = (newName: string) => {
    setSchoolName(newName);
    localStorage.setItem(UI_PREF_KEYS.schoolName, newName);
  };

  const handleSelectExcelBatch = (matchedIds: string[]) => {
    setExcelImportedIds(matchedIds);
    triggerNotification(`نجحت المطابقة! تم تفعيل استهداف (${matchedIds.length}) طالباً. تفضل بكتابة رسالتك الآن بنجاح.`);
    setActiveTab('compose');
  };

  // All school data lives in the cloud (school_notify schema). Nothing is read from the old resal_* keys.
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string>('');
  const [students, setStudents] = useState<Student[]>([]);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [scheduledMessages, setScheduledMessages] = useState<ScheduledMessage[]>([]);
  const [logs, setLogs] = useState<MessageLog[]>([]);
  const logsRef = useRef<MessageLog[]>([]);
  logsRef.current = logs;
  const [isRefreshingStatuses, setIsRefreshingStatuses] = useState(false);
  const studentsRef = useRef<Student[]>([]);
  studentsRef.current = students;

  // Connection / gateway status for the sidebar
  const [online, setOnline] = useState<boolean>(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  const [gatewayStatus, setGatewayStatus] = useState<GatewayStatus>('unknown');

  // Timed dismiss triggers for notifications
  const triggerNotification = (message: string, type: 'success' | 'info' | 'error' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => {
      setNotification(null);
    }, 4500);
  };

  const reportError = (err: unknown) => {
    triggerNotification(repoErrorMessage(err), 'error');
    if (err instanceof RepoError && err.kind === 'auth') onAuthFailure?.();
  };

  const loadAll = useCallback(async () => {
    setLoadState('loading');
    try {
      const data = await repo.loadAll();
      let tmpl = data.templates;
      // First sign-in on this account: seed the generic default templates once (no student data).
      if (tmpl.length === 0 && !localStorage.getItem(SEEDED_KEY(user.id))) {
        const seeded = DEFAULT_TEMPLATES.map(t => ({ ...t, id: newId() }));
        try {
          await repo.upsertTemplates(seeded);
          tmpl = seeded;
          localStorage.setItem(SEEDED_KEY(user.id), '1');
        } catch {
          /* non-fatal */
        }
      }
      setStudents(data.students);
      setTemplates(tmpl);
      setScheduledMessages(data.campaigns.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
      setLogs(data.logs);
      setLoadState('ready');
    } catch (err) {
      setLoadError(repoErrorMessage(err));
      setLoadState('error');
      if (err instanceof RepoError && err.kind === 'auth') onAuthFailure?.();
    }
  }, [repo, user.id, onAuthFailure]);

  const refreshGatewayStatus = useCallback(async () => {
    if (!checkGateway) return;
    setGatewayStatus('checking');
    try {
      const res = await checkGateway();
      if ('error' in res) setGatewayStatus(res.error === 'offline' ? 'offline' : res.error === 'sms_gateway_not_configured' ? 'not_configured' : 'error');
      else setGatewayStatus(res.configured ? 'configured' : 'not_configured');
    } catch {
      setGatewayStatus('error');
    }
  }, [checkGateway]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    void refreshGatewayStatus();
  }, [refreshGatewayStatus]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // 1. Excel Students Import Trigger (upsert by national id, chunks of 500)
  const handleImportComplete = async (imported: Student[]) => {
    try {
      const written = await repo.upsertStudents(imported);
      setStudents(prev => {
        const mergedMap = new Map<string, Student>();
        prev.forEach(s => mergedMap.set(s.id, s));
        imported.forEach(s => mergedMap.set(String(s.id).trim(), { ...s, id: String(s.id).trim() }));
        return Array.from(mergedMap.values());
      });
      triggerNotification(`تم حفظ (${written}) سجل طالب في السحابة بنجاح.`);
      setActiveTab('overview');
    } catch (err) {
      reportError(err);
    }
  };

  // Student edits/deletes coming from the dashboard (computes the diff and persists it).
  const handleUpdateStudents = (action: React.SetStateAction<Student[]>) => {
    const current = studentsRef.current;
    const next = typeof action === 'function' ? (action as (p: Student[]) => Student[])(current) : action;
    const nextIds = new Set(next.map(s => s.id));
    const removed = current.filter(s => !nextIds.has(s.id)).map(s => s.id);
    const currentById = new Map(current.map(s => [s.id, s]));
    const changed = next.filter(s => {
      const old = currentById.get(s.id);
      return !old || JSON.stringify(old) !== JSON.stringify(s);
    });
    (async () => {
      try {
        if (next.length === 0 && current.length > 0) await repo.deleteAllStudents();
        else if (removed.length) await repo.deleteStudents(removed);
        if (changed.length) await repo.upsertStudents(changed);
        setStudents(next);
      } catch (err) {
        reportError(err);
      }
    })();
  };

  // 2. Add Saved Template Trigger
  const handleAddTemplate = async (newTmpl: Omit<MessageTemplate, 'id'>) => {
    const templateWithId: MessageTemplate = { ...newTmpl, id: newId() };
    try {
      await repo.upsertTemplates([templateWithId]);
      setTemplates(prev => [templateWithId, ...prev]);
      triggerNotification(`تم حفظ قالب الرسالة الجديد "${newTmpl.title}" في بنك النصوص التلقائية.`);
    } catch (err) {
      reportError(err);
    }
  };

  // 3. Edit/Modify existing template
  const handleUpdateTemplate = async (updated: MessageTemplate) => {
    try {
      await repo.upsertTemplates([updated]);
      setTemplates(prev => prev.map(t => t.id === updated.id ? updated : t));
      triggerNotification(`تم تحديث صياغة القالب "${updated.title}" بنجاح.`);
    } catch (err) {
      reportError(err);
    }
  };

  // 4. Delete existing template
  const handleDeleteTemplate = async (id: string) => {
    const target = templates.find(t => t.id === id);
    try {
      await repo.deleteTemplate(id);
      setTemplates(prev => prev.filter(t => t.id !== id));
      triggerNotification(`تم حذف القالب "${target?.title || ''}" من القائمة.`, 'info');
    } catch (err) {
      reportError(err);
    }
  };

  // 5. Send Immediate Message Trigger (Evaluated and sent directly)
  const handleSendImmediate = async (generatedLogs: MessageLog[], opts?: { stayOnTab?: boolean }) => {
    const summary = summarizeLogs(generatedLogs);
    // A scheduled campaign is completed only when real messages for it were actually handed over
    const campaignIds = new Set(
      generatedLogs.filter(l => l.campaignId && (l.status === 'sent' || l.status === 'delivered')).map(l => l.campaignId as string)
    );
    let stored = generatedLogs;
    try {
      stored = await repo.addLogs(generatedLogs);
      const toComplete = scheduledMessages
        .filter(item => campaignIds.has(item.id) && item.status === 'pending')
        .map(item => ({ ...item, status: 'completed' as const }));
      if (toComplete.length) await repo.upsertCampaigns(toComplete);
      triggerNotification(
        summary.pending
          ? `قبلت البوابة (${summary.pending}) رسالة وحُفظت في السجل بانتظار الإرسال${summary.failed ? `، وفشلت (${summary.failed})` : ''}. ستتحدث الحالة تلقائياً.`
          : `تم تسليم (${summary.successful}) رسالة للإرسال${summary.failed ? ` وفشلت (${summary.failed})` : ''}. ملاحظة: «أُرسلت» لا تعني تأكيد الاستلام على هاتف ولي الأمر.`,
        summary.failed ? 'info' : 'success'
      );
    } catch (err) {
      // Messages may already be sent: keep them visible in this session and tell the user saving failed.
      triggerNotification('تمت معالجة الإرسال لكن تعذر حفظ سجل الرسائل في السحابة.', 'error');
      if (err instanceof RepoError && err.kind === 'auth') onAuthFailure?.();
    }
    setLogs(prev => [...stored, ...prev]);
    if (campaignIds.size > 0) {
      setScheduledMessages(prev =>
        prev.map(item => campaignIds.has(item.id) && item.status === 'pending' ? { ...item, status: 'completed' as const } : item)
      );
    }
    if (!opts?.stayOnTab) setActiveTab('reports');
  };

  // 5b. Apply gateway states (by SMSGate message id) to history — no downgrade, persisted.
  const handleGatewayStatuses = async (statuses: Map<string, SmsGatewayState>) => {
    const updates: GatewayLogUpdate[] = [];
    for (const l of logsRef.current) {
      const st = l.gatewayMessageId ? statuses.get(l.gatewayMessageId) : undefined;
      if (!st) continue;
      const next = mergeState(l.gatewayState, st.state);
      if (!next) continue;
      updates.push({
        logId: l.id,
        gatewayState: next,
        status: logStatusForState(next),
        failureReason: next === 'Failed' || next === 'Cancelled' ? `${GATEWAY_STATE_LABELS[next]}${st.error ? `: ${st.error}` : ''}` : undefined,
      });
    }
    if (!updates.length) return 0;
    const byId = new Map(updates.map(u => [u.logId, u]));
    setLogs(prev => prev.map(l => {
      const u = byId.get(l.id);
      return u ? { ...l, gatewayState: u.gatewayState, status: u.status, ...(u.failureReason ? { failureReason: u.failureReason } : {}) } : l;
    }));
    try {
      await repo.updateGatewayStates(updates);
    } catch (err) {
      if (err instanceof RepoError && err.kind === 'auth') onAuthFailure?.();
    }
    return updates.length;
  };

  // 5c. "تحديث الحالة" in reports: re-query SMSGate for every non-final message with a stored gateway id.
  const handleRefreshStatuses = async () => {
    const open = new Map<string, GatewayState>();
    for (const l of logsRef.current) {
      if (l.gatewayMessageId && !FINAL_GATEWAY_STATES.includes((l.gatewayState ?? 'Pending') as GatewayState)) {
        open.set(l.gatewayMessageId, (l.gatewayState ?? 'Pending') as GatewayState);
      }
    }
    if (!open.size) {
      triggerNotification('لا توجد رسائل بانتظار تحديث الحالة.', 'info');
      return;
    }
    setIsRefreshingStatuses(true);
    try {
      const n = await handleGatewayStatuses(await fetchStatusesOnce(invokeSms, open));
      triggerNotification(n ? `تم تحديث حالة (${n}) رسالة.` : 'لا تغيير في الحالة بعد.', 'info');
    } catch {
      triggerNotification('تعذر تحديث الحالة الآن. حاول لاحقاً.', 'error');
    } finally {
      setIsRefreshingStatuses(false);
    }
  };

  // 6. Schedule Campaign for date/time
  const handleScheduleMessage = async (newSchedule: Omit<ScheduledMessage, 'id' | 'createdAt' | 'status'>) => {
    const scheduledWithId: ScheduledMessage = {
      ...newSchedule,
      id: newId(),
      createdAt: new Date().toISOString(),
      status: 'pending'
    };
    try {
      await repo.upsertCampaigns([scheduledWithId]);
      setScheduledMessages(prev => [scheduledWithId, ...prev]);
      triggerNotification(`تمت جدولة حملة "${newSchedule.title}" بنجاح ليوم ${newSchedule.scheduledTime.split('T')[0]}.`);
      setActiveTab('scheduler');
    } catch (err) {
      reportError(err);
    }
  };

  // 7. Cancel Scheduled Message
  const handleCancelSchedule = async (id: string) => {
    const target = scheduledMessages.find(item => item.id === id);
    if (!target) return;
    try {
      await repo.upsertCampaigns([{ ...target, status: 'cancelled' }]);
      setScheduledMessages(prev => 
        prev.map(item => item.id === id ? { ...item, status: 'cancelled' as const } : item)
      );
      triggerNotification(`تم إلغاء جدولة الحملة ونقلها للأرشيف غير النشط.`, 'info');
    } catch (err) {
      reportError(err);
    }
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

  const handleClearLogs = async () => {
    try {
      await repo.clearLogs();
      setLogs([]);
      triggerNotification(`تم مسح تقارير الإرسال والاتصال تماماً.`, 'info');
    } catch (err) {
      reportError(err);
    }
  };

  if (loadState !== 'ready') {
    return (
      <div dir="rtl" className="min-h-screen flex items-center justify-center bg-slate-50 p-6" id="app-loading">
        {loadState === 'loading' ? (
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
            جاري تحميل البيانات من السحابة...
          </div>
        ) : (
          <div className="max-w-md text-center space-y-3 bg-white border border-rose-200 rounded-2xl p-6" id="app-load-error">
            <AlertCircle className="w-8 h-8 mx-auto text-rose-600" />
            <p className="text-sm text-slate-700">{loadError}</p>
            <div className="flex justify-center gap-2">
              <button type="button" onClick={() => void loadAll()} className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold flex items-center gap-1">
                <RefreshCw className="w-4 h-4" /> إعادة المحاولة
              </button>
              <button type="button" onClick={() => void onSignOut()} className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold" id="logout-button-error">
                تسجيل الخروج
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

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
          <div className="space-y-1" id="sidebar-connection-status">
            <div className={`font-sans text-[10px] flex items-center gap-1.5 font-bold ${online ? 'text-emerald-500' : 'text-rose-400'}`} data-status={online ? 'online' : 'offline'} id="sidebar-cloud-status">
              <span className={`w-1.5 h-1.5 rounded-full ${online ? 'bg-emerald-500' : 'bg-rose-500'}`} />
              <span>{online ? 'متصل بالسحابة (تم تسجيل الدخول)' : 'غير متصل بالإنترنت — لن تُحفظ التغييرات'}</span>
            </div>
            <div className={`font-sans text-[10px] flex items-center gap-1.5 font-bold ${
              gatewayStatus === 'configured' ? 'text-emerald-500' : gatewayStatus === 'not_configured' ? 'text-amber-400' : gatewayStatus === 'checking' || gatewayStatus === 'unknown' ? 'text-slate-400' : 'text-rose-400'
            }`} data-status={gatewayStatus} id="sidebar-gateway-status">
              <span className={`w-1.5 h-1.5 rounded-full ${
                gatewayStatus === 'configured' ? 'bg-emerald-500' : gatewayStatus === 'not_configured' ? 'bg-amber-400' : gatewayStatus === 'checking' || gatewayStatus === 'unknown' ? 'bg-slate-500' : 'bg-rose-500'
              }`} />
              <span>{GATEWAY_STATUS_LABELS[gatewayStatus]}</span>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 pt-2">
            <span className="text-[10px] text-slate-400 truncate" dir="ltr" title={user.email || ''}>{user.email}</span>
            <button
              type="button"
              onClick={() => void onSignOut()}
              className="flex items-center gap-1 text-[10px] font-bold text-slate-300 hover:text-white bg-slate-800 hover:bg-rose-700 px-2 py-1 rounded-md cursor-pointer transition"
              id="logout-button"
            >
              <LogOut className="w-3 h-3" />
              تسجيل الخروج
            </button>
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
              onUpdateStudents={handleUpdateStudents}
              schoolName={schoolName}
              onUpdateSchoolName={handleUpdateSchoolName}
            />
          )}

          {activeTab === 'compose' && (
            <MessageComposer
              students={students}
              templates={templates}
              onSendImmediate={handleSendImmediate}
              onGatewayStatuses={m => { void handleGatewayStatuses(m); }}
              prefill={composerPrefill}
              onPrefillConsumed={() => setComposerPrefill(null)}
              onScheduleMessage={handleScheduleMessage}
              schoolName={schoolName}
              onUpdateSchoolName={handleUpdateSchoolName}
              excelImportedIds={excelImportedIds}
              onClearImportedIds={() => setExcelImportedIds(null)}
              onAddTemplate={handleAddTemplate}
            />
          )}

          {activeTab === 'sms-config' && (
            <SmsGatewaySettings schoolName={schoolName} gatewayStatus={gatewayStatus} onRefreshStatus={refreshGatewayStatus} />
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
            <BackupPanel
              data={{ students, templates, campaigns: scheduledMessages, logs }}
              repo={repo}
              onRestored={loadAll}
            />
          )}

          {activeTab === 'reports' && (
            <ReportsPanel
              logs={logs}
              onClearLogs={handleClearLogs}
              onRefreshStatuses={handleRefreshStatuses}
              isRefreshingStatuses={isRefreshingStatuses}
            />
          )}
        </div>

      </main>

    </div>
  );
}

const GATEWAY_STATUS_LABELS: Record<GatewayStatus, string> = {
  unknown: 'جاري فحص بوابة SMS...',
  checking: 'جاري فحص بوابة SMS...',
  configured: 'خادم الإرسال جاهز (SMSGate مهيأة)',
  not_configured: 'بوابة SMS غير مهيأة بعد',
  offline: 'تعذر الوصول إلى خادم الإرسال',
  error: 'تعذر فحص بوابة SMS',
};
