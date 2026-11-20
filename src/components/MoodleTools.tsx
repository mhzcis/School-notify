/**
 * Moodle CSV tools: last-access / grading / quiz targeting, section quiz windows,
 * WhatsApp blurbs, and a dedicated Moodle-credentials import (never the regular
 * student importer).
 */
import React, { useMemo, useState } from 'react';
import { BookOpen, ClipboardCopy, GraduationCap, Save, Upload } from 'lucide-react';
import type { Student } from '../types';
import type { MessageTemplate } from '../types';
import { parseMoodleFile, type MoodleExportKind, type ParsedMoodleFile } from '../lib/moodleCsv';
import { countBySection, matchMoodleRows, resolveAmbiguous, sectionLabel, type MoodleMatchResult, type SectionCounts } from '../lib/moodleMatch';
import {
  maskCredentialPassword,
  parseCredentialsFile,
  type CredentialsParseResult,
} from '../lib/moodleCredentials';
import { BUILTIN_MOODLE_TEMPLATES, NEVER_LOGGED_IN_TEMPLATE } from '../lib/moodleTemplates';
import { buildSectionEvent, buildQuizLauncherUrl, eventLabel, type SectionEvent } from '../lib/sectionEvents';
import { buildWhatsAppBlurb, DEFAULT_WA_SIGNATURE } from '../lib/whatsappBlurb';
import { newId } from '../lib/repo/mapping';
import SectionCalendar from './SectionCalendar';
import { repoErrorMessage } from '../lib/repo/types';

export interface MoodlePreparePayload {
  title: string;
  content: string;
  studentIds: string[];
}

interface MoodleToolsProps {
  students: Student[];
  sectionEvents: SectionEvent[];
  credentialsAvailable: boolean;
  credentialsCount: number;
  onPrepareCampaign: (payload: MoodlePreparePayload) => void;
  onSaveGroup: (title: string, ids: string[]) => Promise<void> | void;
  onAddTemplate?: (tmpl: Omit<MessageTemplate, 'id'>) => void;
  onSaveSectionEvent: (event: SectionEvent) => Promise<void> | void;
  onDeleteSectionEvent: (id: string) => Promise<void> | void;
  onImportCredentials: (rows: CredentialsParseResult['rows']) => Promise<number>;
}

type TargetKind = 'never' | 'notSince' | 'notSubmitted' | 'draft' | 'notAttempted';

const TARGET_LABEL: Record<TargetKind, string> = {
  never: 'لم يدخل مطلقًا',
  notSince: 'لم يدخل منذ عدة أيام',
  notSubmitted: 'لم يسلّم الواجب',
  draft: 'مسودة (لم يُضغط تسليم)',
  notAttempted: 'لم يحاول الاختبار',
};

const DASH_COLUMNS: TargetKind[] = ['never', 'notSince', 'notSubmitted', 'draft', 'notAttempted'];

function sectionList(c: SectionCounts, k: TargetKind): string[] {
  return k === 'never' ? c.neverLoggedIn
    : k === 'notSince' ? c.notSince
    : k === 'notSubmitted' ? c.notSubmitted
    : k === 'draft' ? c.draft
    : c.notAttempted;
}

function templateFor(k: TargetKind) {
  return k === 'never' || k === 'notSince'
    ? NEVER_LOGGED_IN_TEMPLATE
    : k === 'notAttempted' ? BUILTIN_MOODLE_TEMPLATES[1] : BUILTIN_MOODLE_TEMPLATES[2];
}

function readFile(file: File): Promise<{ text?: string; buffer?: ArrayBuffer; filename: string }> {
  const name = file.name || '';
  const isText = /\.(csv|txt)$/i.test(name) || file.type.includes('csv') || file.type.includes('text');
  if (isText) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ text: String(reader.result ?? ''), filename: name });
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ buffer: reader.result as ArrayBuffer, filename: name });
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

export default function MoodleTools(props: MoodleToolsProps) {
  const {
    students, sectionEvents, credentialsAvailable, credentialsCount,
    onPrepareCampaign, onSaveGroup, onAddTemplate,
    onSaveSectionEvent, onDeleteSectionEvent, onImportCredentials,
  } = props;

  const [kindOverride, setKindOverride] = useState<MoodleExportKind | 'auto'>('auto');
  const [parsed, setParsed] = useState<ParsedMoodleFile | null>(null);
  const [match, setMatch] = useState<MoodleMatchResult | null>(null);
  const [parseError, setParseError] = useState('');
  const [notSinceDays, setNotSinceDays] = useState(7);
  const [target, setTarget] = useState<TargetKind>('never');
  const [sectionFilter, setSectionFilter] = useState('');
  const [groupTitle, setGroupTitle] = useState('');
  const [notice, setNotice] = useState('');

  const [eventDraft, setEventDraft] = useState({
    grade: '', section: '', title: '', closeLabel: '', closeAt: '', url: '', duration: '', attempts: '',
  });
  const [waSection, setWaSection] = useState('');
  const [waSignature, setWaSignature] = useState(DEFAULT_WA_SIGNATURE);
  const [copied, setCopied] = useState(false);

  const [credPreview, setCredPreview] = useState<CredentialsParseResult | null>(null);
  const [credConfirm, setCredConfirm] = useState(false);
  const [credBusy, setCredBusy] = useState(false);
  const [credMsg, setCredMsg] = useState('');

  const studentById = useMemo(() => new Map(students.map(s => [s.id, s])), [students]);

  const onMoodleFile = async (file: File | undefined) => {
    if (!file) return;
    setParseError('');
    setNotice('');
    try {
      const input = await readFile(file);
      const now = new Date();
      const result = parseMoodleFile(input, {
        kind: kindOverride === 'auto' ? undefined : kindOverride,
        now,
      });
      setParsed(result);
      setMatch(matchMoodleRows(result.rows, students));
      if (result.kind === 'grading') setTarget('notSubmitted');
      else if (result.kind === 'quiz') setTarget('notAttempted');
      else setTarget('never');
    } catch {
      setParseError('تعذر قراءة الملف. تأكد أنه CSV أو Excel من تصدير مودل.');
      setParsed(null);
      setMatch(null);
    }
  };

  const counts = useMemo(() => {
    if (!match) return [];
    return countBySection(match.matched, students, { notSinceDays, now: new Date() });
  }, [match, students, notSinceDays]);

  const sectionOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of students) {
      const label = sectionLabel(s.grade, s.section);
      if (label) set.add(label);
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'ar'));
  }, [students]);

  const selectedIds = useMemo(() => {
    if (!counts.length) return [];
    const rows = sectionFilter ? counts.filter(c => c.label === sectionFilter) : counts;
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const c of rows) {
      const list =
        target === 'never' ? c.neverLoggedIn
        : target === 'notSince' ? c.notSince
        : target === 'notSubmitted' ? c.notSubmitted
        : target === 'draft' ? c.draft
        : c.notAttempted;
      for (const id of list) {
        if (seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
      }
    }
    return ids;
  }, [counts, sectionFilter, target]);

  const defaultTemplate = target === 'never' || target === 'notSince'
    ? NEVER_LOGGED_IN_TEMPLATE
    : target === 'notAttempted'
      ? BUILTIN_MOODLE_TEMPLATES[1]
      : BUILTIN_MOODLE_TEMPLATES[2];

  const handlePrepare = (content?: string) => {
    if (!selectedIds.length) {
      setNotice('لا يوجد طلاب في الفئة المحددة.');
      return;
    }
    const label = sectionFilter || 'كل الشعب';
    onPrepareCampaign({
      title: `${TARGET_LABEL[target]} — ${label}`,
      content: content ?? defaultTemplate.content,
      studentIds: selectedIds,
    });
  };

  const handleSaveGroup = async () => {
    if (!selectedIds.length) return;
    const title = groupTitle.trim() || `${TARGET_LABEL[target]}${sectionFilter ? ` — ${sectionFilter}` : ''}`;
    await onSaveGroup(title, selectedIds);
    setNotice(`تم حفظ المجموعة «${title}» (${selectedIds.length} طالب).`);
    setGroupTitle('');
  };

  const waEvent = sectionEvents.find(e => eventLabel(e) === waSection) || sectionEvents[0];
  const waText = waEvent ? buildWhatsAppBlurb(waEvent, waSignature) : '';

  return (
    <div className="space-y-5" id="moodle-tools-page" dir="rtl">
      <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-xs">
        <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
          <GraduationCap className="w-5 h-5 text-indigo-600" />
          أدوات مودل (من ملف CSV / Excel)
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          المطابقة تتم برقم الهوية أولاً، ثم برقم مستخدم مودل إن وُجد، والاسم فقط عند التطابق التام غير المكرر وبعد تأكيدك للصفوف الملتبسة.
          الدرجات وكلمات المرور لا تُحفظ في سجل الطالب.
        </p>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <label className="text-xs font-bold text-slate-600">
            نوع الملف
            <select
              id="moodle-kind-select"
              className="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
              value={kindOverride}
              onChange={e => setKindOverride(e.target.value as MoodleExportKind | 'auto')}
            >
              <option value="auto">تعرّف تلقائي</option>
              <option value="participants">قائمة المشاركين / آخر دخول</option>
              <option value="grading">ورقة تقييم الواجب</option>
              <option value="quiz">تقرير الاختبار</option>
            </select>
          </label>
          <label className="text-xs font-bold text-slate-600 md:col-span-2">
            رفع الملف
            <input
              id="moodle-file-input"
              type="file"
              accept=".csv,.xlsx,.xls,.txt,text/csv"
              className="mt-1 block w-full text-sm"
              onChange={e => void onMoodleFile(e.target.files?.[0])}
            />
          </label>
        </div>
        {parseError && <p className="text-xs text-rose-600 mt-2">{parseError}</p>}
        {parsed && (
          <p className="text-xs text-slate-500 mt-2" id="moodle-parse-summary">
            النوع: {parsed.kind === 'participants' ? 'آخر دخول' : parsed.kind === 'grading' ? 'تقييم واجب' : parsed.kind === 'quiz' ? 'تقرير اختبار' : 'غير محدد'} ({parsed.kindReason}) · {parsed.rows.length} صف
          </p>
        )}
      </div>

      {match && (
        <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-xs space-y-4" id="moodle-match-review">
          <div className="text-sm text-slate-700">
            مطابقون: <strong id="moodle-matched-count">{match.matchedIds.length}</strong>
            {' '}· ملتبسون: <strong>{match.ambiguous.length}</strong>
            {' '}· غير مطابقين: <strong id="moodle-unmatched-count">{match.unmatched.length}</strong>
          </div>

          {match.unmatched.length > 0 && (
            <div className="text-xs bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-900">
              <div className="font-bold mb-1">غير مطابقين (يُعرض رقم الهوية إن وُجد، بدون حفظ):</div>
              <ul className="list-disc pr-4 space-y-0.5 max-h-32 overflow-auto">
                {match.unmatched.slice(0, 30).map((r, i) => (
                  <li key={i}>{r.nationalId || r.moodleUserId || r.fullName || 'صف بدون معرف'}</li>
                ))}
              </ul>
              {match.unmatched.length > 30 && <div>… و({match.unmatched.length - 30}) غيرها</div>}
            </div>
          )}

          {match.ambiguous.map((a, i) => (
            <div key={i} className="text-xs border border-slate-200 rounded-lg p-3 flex flex-wrap items-center gap-2">
              <span>صف ملتبس: {a.row.nationalId || a.row.fullName}</span>
              <select
                className="border border-slate-200 rounded-md px-2 py-1"
                defaultValue=""
                onChange={e => {
                  const id = e.target.value;
                  if (!id) return;
                  setMatch(m => (m ? resolveAmbiguous(m, i, id) : m));
                }}
              >
                <option value="">اختر الطالب يدوياً</option>
                {a.candidateIds.map(id => (
                  <option key={id} value={id}>{studentById.get(id)?.name || id}</option>
                ))}
              </select>
            </div>
          ))}

          {counts.length > 0 && (
            <div className="overflow-x-auto" id="moodle-section-dashboard">
              <div className="text-xs font-bold text-slate-700 mb-1">لوحة الشعب (من الملف الحالي)</div>
              <table className="w-full text-xs text-right border border-slate-100">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="p-2">الشعبة</th>
                    {DASH_COLUMNS.map(c => <th key={c} className="p-2">{c === 'notSince' ? `لم يدخل منذ ${notSinceDays} يوم` : TARGET_LABEL[c]}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {counts.map(c => (
                    <tr key={c.label} className="border-t border-slate-100" data-section={c.label}>
                      <td className="p-2 font-bold">{c.label}</td>
                      {DASH_COLUMNS.map(k => {
                        const ids = sectionList(c, k);
                        return (
                          <td key={k} className="p-2">
                            {ids.length === 0 ? <span className="text-slate-300 font-mono">0</span> : (
                              <button
                                type="button"
                                className="px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold font-mono cursor-pointer"
                                title="جهّز حملة لهذه الشعبة وهذه الفئة"
                                data-prepare={`${c.label}|${k}`}
                                onClick={() => onPrepareCampaign({
                                  title: `${TARGET_LABEL[k]} — ${c.label}`,
                                  content: templateFor(k).content,
                                  studentIds: ids,
                                })}
                              >
                                {ids.length} · جهّز
                              </button>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-4">
            <label className="text-xs font-bold text-slate-600">
              الفئة
              <select id="moodle-target-select" className="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm" value={target} onChange={e => setTarget(e.target.value as TargetKind)}>
                <option value="never">لم يدخل مطلقًا</option>
                <option value="notSince">لم يدخل منذ X يوم (يشمل من لم يدخل مطلقًا)</option>
                <option value="notSubmitted">لم يسلّم</option>
                <option value="draft">مسودة</option>
                <option value="notAttempted">لم يحاول الاختبار</option>
              </select>
            </label>
            <label className="text-xs font-bold text-slate-600">
              عدد الأيام (X)
              <input id="moodle-days-input" type="number" min={1} className="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm font-mono" value={notSinceDays} onChange={e => setNotSinceDays(Math.max(1, Number(e.target.value) || 1))} />
            </label>
            <label className="text-xs font-bold text-slate-600">
              الشعبة
              <select id="moodle-section-filter" className="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm" value={sectionFilter} onChange={e => setSectionFilter(e.target.value)}>
                <option value="">كل الشعب</option>
                {counts.map(c => (
                  <option key={c.label} value={c.label}>{c.label} ({c.neverLoggedIn.length} لم يدخل / {c.notSubmitted.length} لم يسلّم / {c.notAttempted.length} لم يحاول)</option>
                ))}
              </select>
            </label>
            <div className="text-xs bg-indigo-50 border border-indigo-100 rounded-lg p-2.5">
              المحددون الآن: <strong id="moodle-selected-count" className="font-mono">{selectedIds.length}</strong>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" id="moodle-prepare-campaign" onClick={() => handlePrepare()} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold cursor-pointer">
              جهّز حملة بهذه الفئة
            </button>
            <button type="button" onClick={() => handlePrepare(NEVER_LOGGED_IN_TEMPLATE.content)} className="px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-800 text-xs font-bold cursor-pointer">
              جهّز حملة بقالب غير الداخلين
            </button>
            <input
              className="border border-slate-200 rounded-lg px-2 py-1 text-xs"
              placeholder="اسم المجموعة"
              value={groupTitle}
              onChange={e => setGroupTitle(e.target.value)}
            />
            <button type="button" onClick={() => void handleSaveGroup()} className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold cursor-pointer flex items-center gap-1">
              <Save className="w-3.5 h-3.5" /> احفظ مجموعة
            </button>
          </div>
          {notice && <p className="text-xs text-emerald-700">{notice}</p>}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-xs space-y-3">
        <h3 className="font-bold text-slate-800">قوالب مودل الجاهزة</h3>
        <p className="text-xs text-slate-500">يمكن إضافتها لمكتبة القوالب. قالب غير الداخلين يستخدم بيانات الدخول المخزّنة، ويتطلب تأكيداً إضافياً عند الإرسال.</p>
        <div className="flex flex-wrap gap-2">
          {BUILTIN_MOODLE_TEMPLATES.map(t => (
            <button
              key={t.title}
              type="button"
              onClick={() => onAddTemplate?.(t)}
              className="px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs font-bold cursor-pointer flex items-center gap-1"
            >
              <BookOpen className="w-3.5 h-3.5" /> إضافة «{t.title}»
            </button>
          ))}
        </div>
      </div>

      <SectionCalendar events={sectionEvents} students={students} onPrepareCampaign={onPrepareCampaign} />

      <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-xs space-y-3" id="section-events-editor">
        <h3 className="font-bold text-slate-800">مواعيد الاختبارات والواجبات لكل شعبة</h3>
        <p className="text-xs text-slate-500">
          تُستخدم لـ {'{{رابط_الاختبار}}'} و {'{{موعد_الإغلاق}}'}. الرابط لكل شعبة مستقل، والصيغة: {buildQuizLauncherUrl('123456').replace('123456', 'رقم_الاختبار')}.
        </p>
        {sectionEvents.length === 0 && <p className="text-xs text-slate-400">لا توجد مواعيد محفوظة بعد.</p>}
        <div className="space-y-2">
          {sectionEvents.map(e => (
            <div key={e.id} className="border border-slate-100 rounded-lg p-3 text-xs flex flex-wrap justify-between gap-2">
              <div>
                <div className="font-bold text-slate-800">{e.title || 'بدون عنوان'} — {eventLabel(e)}</div>
                <div className="text-slate-500">{e.closeLabel || e.closeAt} · {e.url}</div>
              </div>
              <button type="button" className="text-rose-600 font-bold cursor-pointer" onClick={() => void onDeleteSectionEvent(e.id)}>حذف</button>
            </div>
          ))}
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          <select className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs" value={eventDraft.section && eventDraft.grade ? `${eventDraft.grade}|||${eventDraft.section}` : ''} onChange={e => {
            const [grade, section] = e.target.value.split('|||');
            setEventDraft(d => ({ ...d, grade: grade || '', section: section || '' }));
          }}>
            <option value="">اختر الشعبة</option>
            {sectionOptions.map(label => {
              const s = students.find(x => sectionLabel(x.grade, x.section) === label);
              return <option key={label} value={s ? `${s.grade}|||${s.section}` : `|||${label}`}>{label}</option>;
            })}
          </select>
          <input className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs" placeholder="عنوان الاختبار" value={eventDraft.title} onChange={e => setEventDraft(d => ({ ...d, title: e.target.value }))} />
          <input className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs" placeholder="موعد الإغلاق (نص يظهر في الرسالة)" value={eventDraft.closeLabel} onChange={e => setEventDraft(d => ({ ...d, closeLabel: e.target.value }))} />
          <input className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-mono" placeholder="رقم الاختبار أو رابط الفتح" value={eventDraft.url} onChange={e => setEventDraft(d => ({ ...d, url: e.target.value }))} />
          <input className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs" placeholder="المدة" value={eventDraft.duration} onChange={e => setEventDraft(d => ({ ...d, duration: e.target.value }))} />
          <input className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs" placeholder="المحاولات" value={eventDraft.attempts} onChange={e => setEventDraft(d => ({ ...d, attempts: e.target.value }))} />
        </div>
        <button
          type="button"
          id="section-event-save"
          className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-bold cursor-pointer"
          onClick={() => void onSaveSectionEvent(buildSectionEvent({ ...eventDraft, id: newId() }))}
        >
          حفظ موعد الشعبة
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-xs space-y-3" id="whatsapp-blurb-box">
        <h3 className="font-bold text-slate-800">مولّد نص واتساب للشعبة</h3>
        <p className="text-xs text-slate-500">يُنسخ نص شعبة واحدة في كل مرة، ورابط تلك الشعبة فقط.</p>
        <select id="wa-section-select" className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm" value={waSection} onChange={e => setWaSection(e.target.value)}>
          <option value="">اختر الشعبة</option>
          {sectionEvents.map(e => <option key={e.id} value={eventLabel(e)}>{eventLabel(e)} — {e.title || 'بدون عنوان'}</option>)}
        </select>
        <input className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs" value={waSignature} onChange={e => setWaSignature(e.target.value)} />
        <pre id="wa-blurb-preview" className="whitespace-pre-wrap text-xs bg-slate-50 border border-slate-100 rounded-lg p-3 min-h-[5rem]">{waText || 'اختر شعبة لعرض النص.'}</pre>
        <button
          type="button"
          id="wa-copy-button"
          disabled={!waText}
          className="px-3 py-1.5 rounded-lg bg-emerald-600 disabled:opacity-50 text-white text-xs font-bold cursor-pointer flex items-center gap-1"
          onClick={async () => {
            if (!waText) return;
            try {
              await navigator.clipboard.writeText(waText);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch { /* ignore */ }
          }}
        >
          <ClipboardCopy className="w-3.5 h-3.5" /> {copied ? 'تم النسخ' : 'نسخ النص'}
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-amber-200 p-6 shadow-xs space-y-3" id="moodle-credentials-import">
        <h3 className="font-bold text-amber-900">استيراد بيانات دخول مودل (مسار مخصص)</h3>
        <p className="text-xs text-amber-800">
          هذا الاستيراد منفصل تماماً عن استيراد الطلاب. البيانات تُحفظ في جدول خاص بك وحدك، ولا تدخل في النسخ الاحتياطي العادي ولا التقارير ولا سجل الطالب.
          المطابقة برقم الهوية فقط. الإرسال الذي يستخدم {'{{كلمة_مرور_مودل}}'} يحتاج تأكيداً إضافياً.
        </p>
        {!credentialsAvailable && (
          <div className="text-xs bg-rose-50 border border-rose-200 text-rose-800 rounded-lg p-3" id="moodle-credentials-unavailable">
            جدول بيانات الدخول غير مفعّل بعد في السحابة. الاستيراد معطّل حتى تتم الموافقة على الترحيل وتطبيقه (مع نسخة احتياطية أولاً). لن تُحفظ كلمات المرور في هذا المتصفح.
          </div>
        )}
        {credentialsAvailable && (
          <p className="text-xs text-slate-600">عدد السجلات المخزّنة حالياً: <strong id="moodle-credentials-count">{credentialsCount}</strong></p>
        )}
        <label className={`text-xs font-bold text-slate-600 block ${credentialsAvailable ? '' : 'opacity-50'}`}>
          ملف بيانات الدخول (رقم الهوية، اسم المستخدم، كلمة المرور)
          <input
            id="moodle-credentials-file"
            type="file"
            accept=".csv,.xlsx,.xls,.txt,text/csv"
            disabled={!credentialsAvailable || credBusy}
            className="mt-1 block w-full text-sm"
            onChange={async e => {
              const file = e.target.files?.[0];
              setCredMsg('');
              setCredConfirm(false);
              if (!file) return;
              try {
                const input = await readFile(file);
                setCredPreview(parseCredentialsFile(input));
              } catch {
                setCredPreview(null);
                setCredMsg('تعذر قراءة ملف بيانات الدخول.');
              }
            }}
          />
        </label>
        {credPreview && (
          <div className="text-xs space-y-2" id="moodle-credentials-preview">
            <p>سيتم حفظ ({credPreview.rows.length}) سجل{credPreview.duplicateIds.length ? `، مع استبدال (${credPreview.duplicateIds.length}) رقم مكرر` : ''}{credPreview.skippedNoId ? `، وتجاهل (${credPreview.skippedNoId}) صف بلا رقم هوية` : ''}.</p>
            <ul className="bg-slate-50 border border-slate-100 rounded-lg p-2 max-h-32 overflow-auto font-mono">
              {credPreview.rows.slice(0, 8).map(r => (
                <li key={r.nationalId}>{r.nationalId} · {r.moodleUsername || '—'} · {maskCredentialPassword(r.moodlePassword)}</li>
              ))}
            </ul>
            <label className="flex items-center gap-2 font-bold cursor-pointer">
              <input id="moodle-credentials-confirm" type="checkbox" checked={credConfirm} onChange={e => setCredConfirm(e.target.checked)} />
              أؤكد استيراد بيانات الدخول إلى الجدول الخاص فقط، وليس إلى سجل الطلاب
            </label>
            <button
              type="button"
              id="moodle-credentials-save"
              disabled={!credentialsAvailable || !credConfirm || credBusy || !credPreview.rows.length}
              className="px-3 py-1.5 rounded-lg bg-amber-700 disabled:opacity-50 text-white text-xs font-bold cursor-pointer flex items-center gap-1"
              onClick={async () => {
                if (!credPreview || !credConfirm) return;
                setCredBusy(true);
                try {
                  const n = await onImportCredentials(credPreview.rows);
                  setCredMsg(`تم حفظ (${n}) سجل بيانات دخول.`);
                  setCredPreview(null);
                  setCredConfirm(false);
                } catch (err) {
                  setCredMsg(repoErrorMessage(err));
                } finally {
                  setCredBusy(false);
                }
              }}
            >
              <Upload className="w-3.5 h-3.5" /> حفظ في الجدول الخاص
            </button>
          </div>
        )}
        {credMsg && <p className="text-xs text-slate-700">{credMsg}</p>}
      </div>
    </div>
  );
}
