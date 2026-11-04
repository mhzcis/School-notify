/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { readPref, UI_PREF_KEYS } from '../lib/smsPrefs';
import React, { useState } from 'react';
import { CHANNEL_LABELS, STATUS_LABELS, summarizeLogs } from '../lib/logStatus';
import { MessageLog } from '../types';
import { AreaChart, Search, CheckCircle2, AlertCircle, Eye, Phone, Trash2, SlidersHorizontal, ArrowLeft, Send, Sparkles, MessageSquare, Smartphone, ExternalLink } from 'lucide-react';
import { SECRET_MASK } from '../lib/template';

interface ReportsPanelProps {
  logs: MessageLog[];
  onClearLogs: () => void;
}

const STATUS_BADGE_CLASS: Record<string, string> = {
  sent: 'bg-sky-50 text-sky-700 border-sky-100',
  delivered: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  failed: 'bg-rose-50 text-rose-700 border-rose-100',
  pending: 'bg-slate-50 text-slate-600 border-slate-200',
};

function log_status_text(status: string): string {
  return status === 'failed' ? 'text-rose-400' : status === 'delivered' ? 'text-emerald-400' : 'text-sky-300';
}

export default function ReportsPanel({ logs, onClearLogs }: ReportsPanelProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<'all' | 'sent' | 'delivered' | 'failed'>('all');
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);

  // Compute metrics
  const totalCount = logs.length;
  // Honest metrics: 'sent' = handed to the gateway/app (no delivery receipt), never counted as failed
  const summary = summarizeLogs(logs);
  const sentCount = summary.successful;
  const deliveredCount = summary.delivered;
  const failedCount = summary.failed;
  const deliveryRate = summary.successRate ?? 0;

  // Filter logs for display
  const dispLogs = logs.filter(log => {
    const matchSearch = 
      log.studentName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.parentName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.phone.includes(searchTerm) ||
      log.grade.includes(searchTerm);

    const matchStatus = 
      selectedStatus === 'all' || 
      log.status === selectedStatus;

    return matchSearch && matchStatus;
  });

  const selectedLog = logs.find(l => l.id === selectedLogId);

  const formatRawTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ' + 
             date.toLocaleDateString('ar-EG', { month: 'short', day: 'numeric' });
    } catch {
      return isoString;
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-xs" id="reports-panel">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 pb-4 border-b border-slate-100">
        <div>
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <AreaChart className="w-5 h-5 text-indigo-600" />
            تقارير وصول الرسائل وحالة التسليم الفورية
          </h2>
          <p className="text-sm text-slate-500 mt-1">تتبع نسبة وصول الإشعارات لأولياء الأمور ومعدل الاستلام الفعلي في الوقت الحقيقي</p>
        </div>

        {logs.length > 0 && (
          <button
            onClick={onClearLogs}
            className="text-xs font-bold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100/75 px-3 py-1.5 rounded-lg transition shrink-0 self-start md:self-center"
            id="btn-clear-logs"
          >
            مسح جميع تقارير الإرسال
          </button>
        )}
      </div>

      {/* KPI stats bar with Custom SVG Ring widgets */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        
        {/* Card 1: Sent */}
        <div className="bg-slate-50 border border-slate-100 p-4 rounded-xl flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs text-slate-500">إجمالي الرسائل المرسلة</div>
            <div className="text-2xl font-bold font-mono text-slate-800">{totalCount}</div>
            <div className="text-[10px] text-slate-400">منذ بدء الجلسة الحالية</div>
          </div>
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
            <Send className="w-5 h-5" />
          </div>
        </div>

        {/* Card 2: Success Rate Custom Design Ring */}
        <div className="bg-slate-50 border border-slate-100 p-4 rounded-xl flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs text-slate-500">نسبة نجاح الإرسال</div>
            <div className="text-2xl font-bold font-mono text-emerald-600">{summary.successRate === null ? '—' : `${deliveryRate}%`}</div>
            <div className="text-[10px] text-slate-500 font-medium">مُسلّمة للبوابة ÷ المحاولات (ليست تأكيد استلام)</div>
          </div>
          {/* Custom SVG Gauging donut ring */}
          <div className="relative w-12 h-12 shrink-0">
            <svg className="w-full h-full transform -rotate-90">
              <circle cx="24" cy="24" r="18" stroke="#e2e8f0" strokeWidth="4.5" fill="transparent" />
              <circle
                cx="24"
                cy="24"
                r="18"
                stroke="#10b981"
                strokeWidth="4.5"
                fill="transparent"
                strokeDasharray={2 * Math.PI * 18}
                strokeDashoffset={2 * Math.PI * 18 * (1 - deliveryRate / 100)}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-emerald-600">✓</div>
          </div>
        </div>

        {/* Card 3: Delivered counts */}
        <div className="bg-slate-50 border border-slate-100 p-4 rounded-xl flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs text-slate-500 font-medium">أُرسلت</div>
            <div className="text-2xl font-bold font-mono text-emerald-600">{sentCount}</div>
            <div className="text-[10px] text-slate-400">منها مؤكدة الاستلام: {deliveredCount}</div>
          </div>
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>

        {/* Card 4: Failed counts */}
        <div className="bg-slate-50 border border-slate-100 p-4 rounded-xl flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs text-slate-500 font-medium">فشل الإرسال</div>
            <div className="text-2xl font-bold font-mono text-rose-500">{failedCount}</div>
            <div className="text-[10px] text-rose-600">رفضتها البوابة أو تعذر الاتصال</div>
          </div>
          <div className="p-3 bg-rose-50 text-rose-500 rounded-xl">
            <AlertCircle className="w-5 h-5" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Logs query segment filters & list table (Left panel) */}
        <div className={`${selectedLog ? 'lg:col-span-7' : 'lg:col-span-12'} transition-all duration-300 space-y-4`}>
          
          {/* Row search + query segment switcher */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 p-3 rounded-xl border border-slate-100">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
              <input
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="ابحث بالاسم، الصف، أو هاتف المستلم..."
                className="w-full pr-9 pl-3 py-1.5 bg-white border border-slate-200 focus:border-indigo-500 rounded-lg text-xs outline-hidden"
              />
            </div>

            <div className="flex items-center gap-1.5 p-1 bg-slate-200/50 rounded-lg" id="logs-status-filter">
              {(['all', 'sent', 'delivered', 'failed'] as const).map(status => {
                const labels = { all: 'الكل', sent: 'أُرسلت', delivered: 'مؤكدة الاستلام', failed: 'الفاشلة' };
                return (
                  <button
                    key={status}
                    onClick={() => {
                      setSelectedStatus(status);
                      setSelectedLogId(null);
                    }}
                    className={`px-3 py-1 text-xs font-semibold rounded-md transition ${
                      selectedStatus === status
                        ? 'bg-white text-indigo-700 shadow-2xs'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    {labels[status]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Logs table representation */}
          <div className="overflow-x-auto border border-slate-100 rounded-xl">
            <table className="w-full text-right text-xs text-slate-600">
              <thead className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-100">
                <tr>
                  <th className="p-3">اسم المستهدف</th>
                  <th className="p-3">الصف والمجموعة</th>
                  <th className="p-3">رقم الجوال</th>
                  <th className="p-3">حالة إرسال التنبيه اللاسلكي</th>
                  <th className="p-3">التوقيت الفعلي</th>
                  <th className="p-3 text-center">أفعال</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {dispLogs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-12 text-center text-slate-400">
                      <AlertCircle className="w-8 h-8 mx-auto text-slate-200 mb-2" />
                      لا يوجد أي سجلات مطابقة لشروط البحث الحالية.
                    </td>
                  </tr>
                ) : (
                  dispLogs.map(log => {
                    const isSelected = selectedLogId === log.id;
                    return (
                      <tr
                        key={log.id}
                        onClick={() => setSelectedLogId(isSelected ? null : log.id)}
                        className={`hover:bg-indigo-50/20 cursor-pointer transition ${
                          isSelected ? 'bg-indigo-50/40 text-slate-900 border-r-4 border-indigo-600' : ''
                        }`}
                      >
                        <td className="p-3">
                          <div className="font-bold text-slate-800">{log.studentName}</div>
                          <div className="text-[10px] text-slate-400 font-normal">ولي الأمر: {log.parentName}</div>
                        </td>
                        <td className="p-3 text-slate-600 font-medium">
                          {log.grade} - {log.section}
                        </td>
                        <td className="p-3 text-slate-500 font-mono text-[11px]">{log.phone}</td>
                        <td className="p-3">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${STATUS_BADGE_CLASS[log.status] || STATUS_BADGE_CLASS.pending}`}
                            title={log.failureReason || (log.channel ? CHANNEL_LABELS[log.channel] : undefined)}
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-current" />
                            {STATUS_LABELS[log.status] || log.status}
                          </span>
                        </td>
                        <td className="p-3 text-slate-450 font-mono text-[10px]" dir="ltr">
                          {formatRawTime(log.sentTime)}
                        </td>
                        <td className="p-3 text-center">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedLogId(isSelected ? null : log.id);
                            }}
                            className="p-1 px-2.5 text-[10.5px] border border-slate-200 hover:border-indigo-500 hover:bg-indigo-50 text-slate-600 hover:text-indigo-700 rounded-md transition font-semibold"
                          >
                            معاينة
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Dynamic Sandbox Phone Mockup Detail Overlay (Right panel) */}
        {selectedLog && (
          <div className="lg:col-span-5 bg-slate-50 border border-slate-200 rounded-2xl p-5 flex flex-col justify-between relative shadow-xs" id="sandbox-phone-preview-panel">
            <button
              onClick={() => setSelectedLogId(null)}
              className="absolute left-4 top-4 p-1.5 hover:bg-slate-200 text-slate-500 hover:text-slate-800 rounded-full cursor-pointer transition"
              title="إغلاق المعاينة"
            >
              <ArrowLeft className="w-4.5 h-4.5" />
            </button>

            <div>
              <div className="flex items-center gap-1.5 text-xs text-indigo-700 font-bold mb-4">
                <Sparkles className="w-4 h-4" />
                <span>محاكي استلام ولي الأمر على الهاتف الجوال</span>
              </div>

              {/* Physical/Visual Mockup of an SMS smartphone frame */}
              <div className="mx-auto max-w-[280px] border-12 border-slate-900 rounded-[35px] bg-slate-950 px-4 py-8 shadow-xl relative">
                
                {/* Speaker indicator/Notch */}
                <div className="absolute top-2 left-1/2 transform -translate-x-1/2 w-20 h-4 bg-slate-900 rounded-full flex items-center justify-center">
                  <div className="w-1 h-1 bg-slate-700 rounded-full" />
                </div>

                {/* Sub-header inside phone screen */}
                <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-3 text-[10px] text-white/50 font-mono">
                  <span>RESAL SMS</span>
                  <span>9:41 ص</span>
                  <span>LTE 🔋</span>
                </div>

                <div className="text-center mb-4">
                  <div className="w-9 h-9 bg-slate-800 text-slate-300 mx-auto rounded-full flex items-center justify-center font-bold font-sans text-xs border border-white/10 shadow-inner">
                    مدرستنا
                  </div>
                  <div className="text-[10px] text-white/75 mt-1 font-bold">إدارة المدرسة والاتصال</div>
                  <div className="text-[8px] text-white/40 mt-0.5">القناة الرسمية الموثقة</div>
                </div>

                {/* Bubble Container */}
                <div className="space-y-4 overflow-y-auto max-h-[220px] p-1">
                  
                  {/* Delivered/Evaluated Bubble text */}
                  <div className="bg-white/10 border border-white/5 text-white p-3 rounded-2xl rounded-tr-none text-right text-[10.5px] leading-relaxed relative shadow-md">
                    <p className="whitespace-pre-wrap">{selectedLog.messageContent}</p>
                    <div className="text-[8px] text-white/40 text-left mt-2" dir="ltr">
                      resal.edu.sa • 9:41 AM
                    </div>
                  </div>

                  <div className={`text-left text-[9px] font-bold font-sans flex items-center gap-1 justify-end pl-1 ${log_status_text(selectedLog.status)}`}>
                    <span>{STATUS_LABELS[selectedLog.status] || selectedLog.status}{selectedLog.failureReason ? ` — ${selectedLog.failureReason}` : ''}</span>
                  </div>

                </div>
              </div>
            </div>

            {/* Recipient detailed metadata inside drawer panel */}
            <div className="mt-5 pt-4 border-t border-slate-200 space-y-2">
              <h4 className="font-bold text-xs text-slate-700">بيانات الاتصال الإضافية والمسار:</h4>
              <div className="grid grid-cols-2 gap-3 text-xs text-slate-600 bg-white p-3 rounded-xl border border-slate-100">
                <div>
                  <div className="text-[10px] text-slate-400">اسم الطالب:</div>
                  <div className="font-bold text-slate-800 truncate">{selectedLog.studentName}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">ولي الأمر المكلف:</div>
                  <div className="font-bold text-slate-800 truncate">{selectedLog.parentName}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">الصف والمجموعة:</div>
                  <div className="font-bold text-slate-700">{selectedLog.grade} - {selectedLog.section}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">رقم الهاتف المستهدف:</div>
                  <div className="font-bold font-mono text-slate-700">{selectedLog.phone}</div>
                </div>
              </div>
              
              <div className="pt-2.5 border-t border-slate-150 space-y-1.5">
                <span className="text-[10px] font-bold text-slate-500">خيار البث اليدوي المباشر السريع (مجاني بالكامل):</span>
                {selectedLog.messageContent.includes(SECRET_MASK) && (
                  <div className="text-[10px] font-bold text-amber-700" id="log-masked-secret-note">
                    ⚠️ كلمة المرور مخفية في السجل ولا تُحفظ فيه؛ إعادة الإرسال من هنا سترسل الرمز المخفي. أعد الإرسال من شاشة إنشاء الرسالة بدلاً من ذلك.
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const prefix = readPref(UI_PREF_KEYS.phonePrefix, 'none');
                      let cleaned = selectedLog.phone.trim().replace(/\D/g, '');
                      if (prefix !== 'none') {
                        if (prefix === '966' && cleaned.startsWith('05')) {
                          cleaned = '966' + cleaned.substring(1);
                        } else if (prefix === '970' && cleaned.startsWith('05')) {
                          cleaned = '970' + cleaned.substring(1);
                        } else if (prefix === '962' && cleaned.startsWith('07')) {
                          cleaned = '962' + cleaned.substring(1);
                        } else if (prefix === '20' && cleaned.startsWith('01')) {
                          cleaned = '20' + cleaned.substring(1);
                        }
                      }
                      const wUrl = `https://api.whatsapp.com/send?phone=${cleaned}&text=${encodeURIComponent(selectedLog.messageContent)}`;
                      window.open(wUrl, '_blank');
                    }}
                    className="flex items-center justify-center gap-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 py-1.5 px-3 rounded-lg text-xs font-bold transition cursor-pointer"
                  >
                    <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
                    بث عبر WhatsApp
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const prefix = readPref(UI_PREF_KEYS.phonePrefix, 'none');
                      let cleaned = selectedLog.phone.trim().replace(/\D/g, '');
                      if (prefix !== 'none') {
                        if (prefix === '966' && cleaned.startsWith('05')) {
                          cleaned = '966' + cleaned.substring(1);
                        } else if (prefix === '970' && cleaned.startsWith('05')) {
                          cleaned = '970' + cleaned.substring(1);
                        } else if (prefix === '962' && cleaned.startsWith('07')) {
                          cleaned = '962' + cleaned.substring(1);
                        } else if (prefix === '20' && cleaned.startsWith('01')) {
                          cleaned = '20' + cleaned.substring(1);
                        }
                      }
                      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
                      const separator = isIOS ? '&' : '?';
                      const sUrl = `sms:${cleaned}${separator}body=${encodeURIComponent(selectedLog.messageContent)}`;
                      window.location.href = sUrl;
                    }}
                    className="flex items-center justify-center gap-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 py-1.5 px-3 rounded-lg text-xs font-bold transition cursor-pointer"
                  >
                    <Smartphone className="w-3.5 h-3.5 text-indigo-600" />
                    بث SMS من الجوال
                  </button>
                </div>
              </div>
              
              <div className="flex items-center justify-between text-[11px] text-slate-400 pt-2 font-mono border-t border-slate-150" dir="ltr">
                <span>ID: {selectedLog.id}</span>
                <span>STATUS: {selectedLog.status.toUpperCase()}{selectedLog.channel ? ` (${selectedLog.channel})` : ''}</span>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
