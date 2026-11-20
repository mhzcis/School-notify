/**
 * Weekly calendar of per-section close dates. «جهّز تذكيراً» only PREPARES a campaign in the
 * send screen (preview + confirm still required); nothing is ever sent from here.
 */
import React, { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import type { Student } from '../types';
import { eventLabel, formatCloseDate, type SectionEvent } from '../lib/sectionEvents';
import { eventsForDays, sectionStudentIds, undatedEvents, weekDays } from '../lib/sectionCalendar';
import { ASSIGNMENT_REMINDER_TEMPLATE, QUIZ_REMINDER_TEMPLATE } from '../lib/moodleTemplates';
import type { MoodlePreparePayload } from './MoodleTools';

const DAY_NAMES = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

interface Props {
  events: SectionEvent[];
  students: Student[];
  onPrepareCampaign: (p: MoodlePreparePayload) => void;
  now?: Date;
}

export default function SectionCalendar({ events, students, onPrepareCampaign, now }: Props) {
  const [offset, setOffset] = useState(0);
  const today = now ?? new Date();
  const days = useMemo(() => weekDays(today, offset), [today, offset]);
  const entries = useMemo(() => eventsForDays(events, days), [events, days]);
  const undated = useMemo(() => undatedEvents(events), [events]);
  const [notice, setNotice] = useState('');

  const prepare = (e: SectionEvent) => {
    const ids = sectionStudentIds(e, students);
    if (!ids.length) {
      setNotice(`لا يوجد طلاب في ${eventLabel(e)}.`);
      return;
    }
    const tmpl = e.type === 'assignment' ? ASSIGNMENT_REMINDER_TEMPLATE : QUIZ_REMINDER_TEMPLATE;
    onPrepareCampaign({ title: `تذكير: ${e.title || tmpl.title} — ${eventLabel(e)}`, content: tmpl.content, studentIds: ids });
  };

  const fmtDay = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-xs space-y-4" id="section-calendar">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-bold text-slate-800 flex items-center gap-2">
          <CalendarDays className="w-5 h-5 text-indigo-600" /> تقويم مواعيد الإغلاق الأسبوعي
        </h3>
        <div className="flex items-center gap-1 text-xs">
          <button type="button" onClick={() => setOffset(o => o - 1)} className="p-1.5 border border-slate-200 rounded-lg cursor-pointer" id="cal-prev" title="الأسبوع السابق"><ChevronRight className="w-4 h-4" /></button>
          <span className="font-mono px-2" id="cal-range" dir="ltr">{fmtDay(days[0])} – {fmtDay(days[6])}</span>
          <button type="button" onClick={() => setOffset(o => o + 1)} className="p-1.5 border border-slate-200 rounded-lg cursor-pointer" id="cal-next" title="الأسبوع التالي"><ChevronLeft className="w-4 h-4" /></button>
          {offset !== 0 && <button type="button" onClick={() => setOffset(0)} className="px-2 py-1 text-indigo-700 font-bold cursor-pointer">هذا الأسبوع</button>}
        </div>
      </div>
      <p className="text-xs text-slate-500">
        المواعيد من «مواعيد الاختبارات والواجبات لكل شعبة» أدناه. زر «جهّز تذكيراً» يفتح شاشة البث بطلاب الشعبة وقالب التذكير فقط؛ يمكنك جدولته لليوم السابق من هناك، ولا يُرسل شيء بدون تأكيدك.
      </p>
      <div className="grid gap-2 md:grid-cols-7">
        {days.map((d, i) => {
          const list = entries.filter(en => en.day === d);
          return (
            <div key={d} className="border border-slate-100 rounded-lg p-2 min-h-[5rem] text-xs" data-day={d}>
              <div className="font-bold text-slate-600 mb-1">{DAY_NAMES[i]} <span className="font-mono text-slate-400">{fmtDay(d)}</span></div>
              {list.length === 0 ? <div className="text-slate-300">—</div> : list.map(en => (
                <div key={en.event.id} className="mb-1 p-1.5 rounded bg-indigo-50 border border-indigo-100 space-y-1" data-event={en.event.id}>
                  <div className="font-bold text-indigo-900">{en.event.title || (en.event.type === 'assignment' ? 'واجب' : 'اختبار')}</div>
                  <div className="text-slate-600">{eventLabel(en.event)} · {formatCloseDate(en.event)}</div>
                  <div className="text-slate-500">التذكير المقترح: <span className="font-mono">{fmtDay(en.reminderDay)}</span></div>
                  <button type="button" onClick={() => prepare(en.event)} className="px-2 py-1 rounded bg-emerald-600 text-white font-bold cursor-pointer" data-prepare={en.event.id}>جهّز تذكيراً</button>
                </div>
              ))}
            </div>
          );
        })}
      </div>
      {undated.length > 0 && (
        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2" id="cal-undated">
          مواعيد بدون تاريخ قابل للقراءة (لا تظهر في التقويم): {undated.map(e => `${e.title || 'بدون عنوان'} (${eventLabel(e)})`).join('، ')}
        </div>
      )}
      {notice && <p className="text-xs text-rose-700">{notice}</p>}
    </div>
  );
}
