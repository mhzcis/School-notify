/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ScheduledMessage } from '../types';
import { CalendarClock, Check, Play, Ban, Trash2, Tag, ArrowLeftRight } from 'lucide-react';

interface SchedulerProps {
  scheduledMessages: ScheduledMessage[];
  onCancelSchedule: (id: string) => void;
  onDispatchImmediately: (id: string) => void;
}

export default function Scheduler({
  scheduledMessages,
  onCancelSchedule,
  onDispatchImmediately
}: SchedulerProps) {

  const getStatusBadge = (status: ScheduledMessage['status']) => {
    switch (status) {
      case 'pending':
        return 'bg-amber-50 text-amber-700 border-amber-100';
      case 'sending':
        return 'bg-blue-50 text-blue-700 border-blue-100 animate-pulse';
      case 'completed':
        return 'bg-emerald-50 text-emerald-700 border-emerald-100';
      case 'cancelled':
        return 'bg-slate-50 text-slate-500 border-slate-200';
    }
  };

  const getStatusLabel = (status: ScheduledMessage['status']) => {
    switch (status) {
      case 'pending': return 'قيد الانتظار — لم يُرسل تلقائياً';
      case 'sending': return 'جاري الإرسال الآن';
      case 'completed': return 'أُرسلت يدوياً';
      case 'cancelled': return 'ملغاة';
    }
  };

  const formatDateTime = (dateTimeStr: string) => {
    try {
      const dt = new Date(dateTimeStr);
      return dt.toLocaleString('ar-EG', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateTimeStr;
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-xs" id="scheduler-component-container">
      <div className="mb-6 pb-4 border-b border-slate-100">
        <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
          <CalendarClock className="w-5 h-5 text-indigo-600" />
          جدولة وحملات الإرسال المؤجلة
        </h2>
        <p className="text-sm text-slate-500 mt-1">تتبع، عدّل أو نفِّذ فورياً حملات الإرسال التي تمت جدولتها مسبقاً</p>
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2" id="scheduler-not-auto-notice">
          تنبيه: التطبيق يعمل داخل المتصفح فقط ولا يرسل الحملات المجدولة تلقائياً في موعدها. عند حلول الموعد افتح الحملة واضغط «مراجعة وإرسال الآن».
        </p>
      </div>

      {scheduledMessages.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 text-center text-slate-400">
          <CalendarClock className="w-10 h-10 text-slate-200 mb-2" />
          <p className="text-xs font-semibold">لا توجد حملات مجدولة حالياً.</p>
          <p className="text-[11px] text-slate-400 mt-1">قم بجدولة رسالة جديدة من نافذة صياغة الرسائل أعلاه.</p>
        </div>
      ) : (
        <div className="space-y-4" id="scheduled-campaigns-list">
          {scheduledMessages.map(item => (
            <div
              key={item.id}
              className={`border rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all duration-200 ${
                item.status === 'cancelled' ? 'opacity-65 bg-slate-50/50' : 'bg-white hover:border-slate-200 shadow-3xs'
              }`}
            >
              {/* Campaign description */}
              <div className="space-y-2 flex-1 text-right">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`px-2.5 py-0.5 text-[10px] font-bold rounded-full border ${getStatusBadge(item.status)}`}>
                    {getStatusLabel(item.status)}
                  </span>
                  
                  <span className="bg-indigo-50 text-indigo-700 border border-indigo-100 px-2 py-0.5 rounded-md text-[10px] font-semibold flex items-center gap-1">
                    <Tag className="w-3 h-3" />
                    استهداف: {item.targetType === 'all' && 'جميع الطلاب'}
                    {item.targetType === 'grade' && `الصف ${item.targetGrade}`}
                    {item.targetType === 'section' && `الصف ${item.targetGrade} / الشعبة ${item.targetSection}`}
                    {item.targetType === 'custom' && 'طلاب مخصصين'}
                  </span>

                  <span className="text-[11px] text-slate-400 font-mono">
                    الرمز الرقمي: #{item.id}
                  </span>
                </div>

                <h4 className="font-bold text-slate-800 text-sm">{item.title}</h4>
                <p className="text-xs text-slate-500 line-clamp-1 max-w-2xl bg-slate-50 px-2.5 py-1 rounded border border-slate-100">
                  قالب الرسالة: {item.contentTemplate}
                </p>
              </div>

              {/* Timestamp & actions */}
              <div className="flex flex-col sm:flex-row md:flex-col items-start sm:items-center md:items-end justify-between md:justify-center gap-3 shrink-0 border-t md:border-t-0 pt-3 md:pt-0 border-slate-100">
                <div className="text-right">
                  <div className="text-[10px] text-slate-400">توقيت الإرسال المجدول:</div>
                  <div className="text-xs font-bold font-mono text-indigo-700 mt-0.5">{formatDateTime(item.scheduledTime)}</div>
                </div>

                <div className="flex items-center gap-2 mt-1">
                  {item.status === 'pending' && (
                    <>
                      <button
                        onClick={() => onCancelSchedule(item.id)}
                        className="px-2.5 py-1 text-xs border border-slate-200 text-slate-600 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 rounded-lg transition font-semibold flex items-center gap-1 cursor-pointer"
                        title="إلغاء الجدولة وتجميد الحملة"
                      >
                        <Ban className="w-3.5 h-3.5" />
                        إلغاء
                      </button>

                      <button
                        onClick={() => onDispatchImmediately(item.id)}
                        className="px-3 py-1 text-xs bg-emerald-600 text-white hover:bg-emerald-700 font-bold rounded-lg transition flex items-center gap-1 cursor-pointer shadow-2xs hover:shadow-xs"
                        title="تحميل الحملة في شاشة الإرسال لمراجعتها وتأكيد إرسالها"
                      >
                        <Play className="w-3.5 h-3.5" />
                        مراجعة وإرسال الآن
                      </button>
                    </>
                  )}

                  {item.status === 'cancelled' && (
                    <span className="text-[11px] text-slate-400 font-medium">حملة ملغاة ومؤرشفة</span>
                  )}

                  {item.status === 'completed' && (
                    <span className="text-[11px] text-emerald-600 font-bold flex items-center gap-1">
                      <Check className="w-4 h-4" />
                      أُرسلت يدوياً (راجع التقارير للنتيجة الفعلية)
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
