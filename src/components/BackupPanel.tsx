/**
 * Backup export / restore screen (cloud data).
 * Restore flow: choose file -> validate -> show summary + typed confirmation ->
 * automatically download a safety backup of the CURRENT cloud data -> merge-upsert -> reload data.
 */
import React, { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { Download, Upload, ShieldAlert, CheckCircle2, AlertCircle, DatabaseBackup, FileSpreadsheet } from 'lucide-react';
import {
  applyBackup, backupFilename, createBackup, downloadJson, studentsWorkbook, validateBackup, BackupFile, BackupSummary
} from '../lib/backup';
import { AppData, SchoolRepository, repoErrorMessage } from '../lib/repo/types';

interface BackupPanelProps {
  data: AppData;
  repo: SchoolRepository;
  onRestored: () => void | Promise<void>;
}

export default function BackupPanel({ data, repo, onRestored }: BackupPanelProps) {
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, setPending] = useState<{ backup: BackupFile; summary: BackupSummary; fileName: string } | null>(null);
  const [confirmText, setConfirmText] = useState('');

  const handleExport = () => {
    const backup = createBackup(data, { includeSecrets });
    downloadJson(backup, backupFilename());
    setMessage(`تم تنزيل النسخة الاحتياطية (${data.students.length} طالب، ${data.templates.length} قالب، ${data.campaigns.length} حملة، ${data.logs.length} سجل).`);
  };

  const handleExportExcel = () => {
    const wb = studentsWorkbook(data.students, includeSecrets);
    XLSX.writeFile(wb, backupFilename(new Date(), 'students', 'xlsx'));
    setMessage(`تم تنزيل كشف الطلاب (${data.students.length}) بصيغة Excel.`);
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrors([]);
    setMessage(null);
    setPending(null);
    setConfirmText('');
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = validateBackup(String(reader.result ?? ''));
      if ('errors' in result) {
        setErrors(result.errors);
      } else {
        setPending({ backup: result.backup, summary: result.summary, fileName: file.name });
      }
      if (fileRef.current) fileRef.current.value = '';
    };
    reader.onerror = () => setErrors(['تعذر قراءة الملف.']);
    reader.readAsText(file);
  };

  const handleConfirmRestore = async () => {
    if (!pending || busy) return;
    setBusy(true);
    setErrors([]);
    try {
      // 1) Safety copy of the CURRENT cloud data (complete, including secrets so nothing is lost).
      const safety = createBackup(data, { includeSecrets: true });
      downloadJson(safety, backupFilename(new Date(), 'pre-restore'));
      // 2) Merge the backup into the cloud.
      await applyBackup(pending.backup, repo, data.students);
      setPending(null);
      setConfirmText('');
      setMessage('تمت الاستعادة إلى السحابة بنجاح.');
      await onRestored();
    } catch (err) {
      setErrors([`فشلت الاستعادة: ${repoErrorMessage(err)}`]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-xs space-y-6" id="backup-panel">
      <div className="pb-4 border-b border-slate-100">
        <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
          <DatabaseBackup className="w-5 h-5 text-emerald-600" />
          النسخ الاحتياطي والاستعادة
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          البيانات محفوظة في السحابة ضمن حسابك المحمي. يمكنك تنزيل نسخة احتياطية في ملف على جهازك واستعادتها لاحقاً.
        </p>
      </div>

      {/* Export */}
      <section className="space-y-3">
        <h3 className="font-bold text-slate-700 text-sm">تصدير نسخة احتياطية</h3>
        <label className="flex items-start gap-2 text-xs text-slate-600 cursor-pointer">
          <input type="checkbox" checked={includeSecrets} onChange={e => setIncludeSecrets(e.target.checked)} className="mt-0.5" />
          <span>
            تضمين البيانات الحساسة (كلمات مرور Moodle للطلاب)
          </span>
        </label>
        {includeSecrets && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>تحذير: الملف سيحتوي كلمات مرور كنص واضح. لا ترسله لأحد واحفظه في مكان آمن.</span>
          </div>
        )}
        <button
          onClick={handleExport}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg flex items-center gap-2 cursor-pointer"
          id="btn-export-backup"
        >
          <Download className="w-4 h-4" />
          تنزيل نسخة احتياطية (JSON)
        </button>
        <button
          onClick={handleExportExcel}
          className="px-4 py-2 bg-white border border-emerald-600 text-emerald-700 hover:bg-emerald-50 text-xs font-bold rounded-lg flex items-center gap-2 cursor-pointer"
          id="btn-export-excel"
        >
          <FileSpreadsheet className="w-4 h-4" />
          تنزيل كشف الطلاب (Excel)
        </button>
      </section>

      {/* Restore */}
      <section className="space-y-3 pt-4 border-t border-slate-100">
        <h3 className="font-bold text-slate-700 text-sm">استعادة من نسخة احتياطية</h3>
        <p className="text-xs text-slate-500">
          قبل الاستعادة سيتم تنزيل نسخة أمان تلقائية من بياناتك الحالية، ثم تُدمج بيانات الملف في السحابة (تُحدَّث السجلات المطابقة ولا يُحذف أي سجل موجود).
        </p>
        <input ref={fileRef} type="file" accept="application/json,.json" onChange={handleFile} className="text-xs" id="input-restore-backup" />

        {pending && (
          <div className="p-4 rounded-xl border border-rose-200 bg-rose-50 space-y-2 text-xs text-slate-700" id="restore-confirm-box">
            <div className="font-bold text-rose-700 flex items-center gap-1">
              <AlertCircle className="w-4 h-4" /> تأكيد الاستعادة من الملف: {pending.fileName}
            </div>
            <ul className="list-disc pr-5 space-y-0.5">
              <li>تاريخ التصدير: <span dir="ltr">{pending.summary.exportedAt || 'غير معروف'}</span></li>
              <li>الطلاب: {pending.summary.students} • القوالب: {pending.summary.templates} • الحملات: {pending.summary.campaigns} • السجلات: {pending.summary.logs}</li>
              {!pending.summary.secretsIncluded && (
                <li className="text-amber-700">هذه النسخة لا تحتوي كلمات مرور Moodle؛ تبقى كلمات المرور المحفوظة حالياً كما هي.</li>
              )}
            </ul>
            <p>للتأكيد اكتب كلمة <strong>استعادة</strong>:</p>
            <input
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              className="border border-slate-300 rounded px-2 py-1 text-xs"
              id="input-restore-confirm"
            />
            <div className="flex gap-2 pt-1">
              <button
                disabled={busy || confirmText.trim() !== 'استعادة'}
                onClick={() => void handleConfirmRestore()}
                className="px-3 py-1.5 bg-rose-600 disabled:opacity-40 text-white font-bold rounded-lg flex items-center gap-1 cursor-pointer disabled:cursor-not-allowed"
                id="btn-confirm-restore"
              >
                <Upload className="w-4 h-4" /> {busy ? 'جاري الاستعادة...' : 'تنزيل نسخة أمان ثم الاستعادة'}
              </button>
              <button onClick={() => setPending(null)} className="px-3 py-1.5 border border-slate-300 rounded-lg cursor-pointer">
                إلغاء
              </button>
            </div>
          </div>
        )}
      </section>

      {message && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 text-emerald-700 text-xs">
          <CheckCircle2 className="w-4 h-4" /> {message}
        </div>
      )}
      {errors.length > 0 && (
        <div className="p-3 rounded-lg bg-rose-50 text-rose-700 text-xs space-y-1">
          {errors.map((er, i) => <div key={i}>• {er}</div>)}
        </div>
      )}
    </div>
  );
}
