/**
 * Backup export / restore screen (cloud data).
 * Restore flow: choose file -> validate -> show summary + typed confirmation ->
 * automatically download a safety backup of the CURRENT cloud data (without secrets) ->
 * merge-upsert -> restore non-secret prefs -> reload data.
 */
import React, { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { Download, Upload, CheckCircle2, AlertCircle, DatabaseBackup, FileSpreadsheet, Lock } from 'lucide-react';
import {
  applyBackup, backupFilename, downloadDataBackup, downloadEncryptedBackup, studentsWorkbook, validateBackup, BackupFile, BackupSummary
} from '../lib/backup';
import { decryptBackupText, isEncryptedBackup, MIN_BACKUP_PASSWORD_LEN, type EncryptedBackupFile } from '../lib/backupCrypto';
import { collectBackupPrefs } from '../lib/smsPrefs';
import { AppData, SchoolRepository, repoErrorMessage } from '../lib/repo/types';

interface BackupPanelProps {
  data: AppData;
  repo: SchoolRepository;
  onRestored: () => void | Promise<void>;
}

export default function BackupPanel({ data, repo, onRestored }: BackupPanelProps) {
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, setPending] = useState<{ backup: BackupFile; summary: BackupSummary; fileName: string } | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [encrypt, setEncrypt] = useState(false);
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [locked, setLocked] = useState<{ file: EncryptedBackupFile; fileName: string } | null>(null);
  const [unlockPw, setUnlockPw] = useState('');

  const snapshot = (): AppData => ({
    ...data,
    groups: data.groups ?? [],
  });

  const handleExport = async () => {
    setErrors([]);
    if (encrypt) {
      if (pw1.length < MIN_BACKUP_PASSWORD_LEN) {
        setErrors([`كلمة مرور النسخة يجب أن تكون ${MIN_BACKUP_PASSWORD_LEN} أحرف على الأقل.`]);
        return;
      }
      if (pw1 !== pw2) {
        setErrors(['كلمتا المرور غير متطابقتين.']);
        return;
      }
      setBusy(true);
      try {
        const backup = await downloadEncryptedBackup(snapshot(), pw1, { prefs: collectBackupPrefs() });
        setPw1('');
        setPw2('');
        setMessage(`تم تنزيل نسخة احتياطية مشفّرة بكلمة مرور (${backup.data.students.length} طالب). احفظ كلمة المرور في مكان آمن: بدونها لا يمكن فتح النسخة.`);
      } catch {
        setErrors(['تعذر تشفير النسخة الاحتياطية في هذا المتصفح.']);
      } finally {
        setBusy(false);
      }
      return;
    }
    const backup = downloadDataBackup(snapshot(), { prefs: collectBackupPrefs() });
    setMessage(`تم تنزيل النسخة الاحتياطية (${backup.data.students.length} طالب، ${backup.data.templates.length} قالب، ${backup.data.campaigns.length} حملة، ${backup.data.logs.length} سجل، ${(backup.data.groups ?? []).length} مجموعة). لا تتضمن الملف بيانات دخول مودل ولا أسرار بوابة SMS.`);
  };

  const handleExportExcel = () => {
    const wb = studentsWorkbook(data.students);
    XLSX.writeFile(wb, backupFilename(new Date(), 'students', 'xlsx'));
    setMessage(`تم تنزيل كشف الطلاب (${data.students.length}) بصيغة Excel بدون الملاحظات أو بيانات الدخول.`);
  };

  const showValidated = (text: string, fileName: string) => {
    const result = validateBackup(text);
    if ('errors' in result) {
      setErrors(result.errors);
    } else {
      setPending({ backup: result.backup, summary: result.summary, fileName });
    }
  };

  const handleUnlock = async () => {
    if (!locked || busy) return;
    setBusy(true);
    setErrors([]);
    try {
      const text = await decryptBackupText(locked.file, unlockPw);
      setUnlockPw('');
      const name = locked.fileName;
      setLocked(null);
      showValidated(text, name);
    } catch {
      setErrors(['كلمة مرور النسخة غير صحيحة أو الملف تالف.']);
    } finally {
      setBusy(false);
    }
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrors([]);
    setLocked(null);
    setUnlockPw('');
    setMessage(null);
    setPending(null);
    setConfirmText('');
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      let parsed: unknown = null;
      try { parsed = JSON.parse(text); } catch { /* validateBackup reports it */ }
      if (isEncryptedBackup(parsed)) {
        setLocked({ file: parsed, fileName: file.name });
      } else {
        showValidated(text, file.name);
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
      downloadDataBackup(snapshot(), { label: 'pre-restore', prefs: collectBackupPrefs() });
      await applyBackup(pending.backup, repo, data.students);
      setPending(null);
      setConfirmText('');
      setMessage('تمت الاستعادة إلى السحابة بنجاح. لم يُحذف أي طالب موجود، وأُعيدت الإعدادات غير السرية.');
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
          النسخة تشمل اسم المدرسة والإعدادات غير السرية والمجموعات المحفوظة، ولا تشمل بيانات دخول مودل ولا أسرار بوابة SMS.
        </p>
      </div>

      <section className="space-y-3">
        <h3 className="font-bold text-slate-700 text-sm">تصدير نسخة احتياطية</h3>
        <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
          <input type="checkbox" checked={encrypt} onChange={e => setEncrypt(e.target.checked)} id="chk-encrypt-backup" />
          <Lock className="w-4 h-4 text-indigo-600" /> حماية النسخة بكلمة مرور (تشفير داخل المتصفح)
        </label>
        {encrypt && (
          <div className="flex flex-wrap gap-2" id="encrypt-fields">
            <input type="password" value={pw1} onChange={e => setPw1(e.target.value)} placeholder={`كلمة المرور (${MIN_BACKUP_PASSWORD_LEN} أحرف على الأقل)`} autoComplete="new-password" className="border border-slate-300 rounded-lg px-3 py-2 text-xs w-56" id="input-backup-pw" />
            <input type="password" value={pw2} onChange={e => setPw2(e.target.value)} placeholder="تأكيد كلمة المرور" autoComplete="new-password" className="border border-slate-300 rounded-lg px-3 py-2 text-xs w-56" id="input-backup-pw2" />
            <p className="w-full text-[11px] text-amber-700">لا تُحفظ كلمة المرور في أي مكان. إذا نسيتها لا يمكن فتح النسخة.</p>
          </div>
        )}
        <button
          onClick={() => void handleExport()}
          disabled={busy}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-bold rounded-lg flex items-center gap-2 cursor-pointer"
          id="btn-export-backup"
        >
          <Download className="w-4 h-4" />
          {encrypt ? 'تنزيل نسخة احتياطية مشفّرة (JSON)' : 'تنزيل نسخة احتياطية (JSON)'}
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

      <section className="space-y-3 pt-4 border-t border-slate-100">
        <h3 className="font-bold text-slate-700 text-sm">استعادة من نسخة احتياطية</h3>
        <p className="text-xs text-slate-500">
          قبل الاستعادة سيتم تنزيل نسخة أمان تلقائية من بياناتك الحالية، ثم تُدمج بيانات الملف في السحابة (تُحدَّث السجلات المطابقة ولا يُحذف أي سجل موجود).
        </p>
        <input ref={fileRef} type="file" accept="application/json,.json" onChange={handleFile} className="text-xs" id="input-restore-backup" />

        {locked && (
          <div className="p-4 rounded-xl border border-indigo-200 bg-indigo-50 space-y-2 text-xs" id="unlock-backup-box">
            <div className="font-bold text-indigo-800 flex items-center gap-1"><Lock className="w-4 h-4" /> الملف {locked.fileName} محمي بكلمة مرور</div>
            <div className="flex flex-wrap gap-2">
              <input type="password" value={unlockPw} onChange={e => setUnlockPw(e.target.value)} placeholder="كلمة مرور النسخة" autoComplete="off" className="border border-slate-300 rounded-lg px-3 py-2 text-xs w-56" id="input-unlock-pw" />
              <button onClick={() => void handleUnlock()} disabled={busy || !unlockPw} className="px-3 py-1.5 bg-indigo-600 disabled:opacity-40 text-white font-bold rounded-lg cursor-pointer" id="btn-unlock-backup">
                {busy ? 'جاري الفتح...' : 'فتح النسخة'}
              </button>
              <button onClick={() => { setLocked(null); setUnlockPw(''); }} className="px-3 py-1.5 border border-slate-300 rounded-lg cursor-pointer">إلغاء</button>
            </div>
          </div>
        )}

        {pending && (
          <div className="p-4 rounded-xl border border-rose-200 bg-rose-50 space-y-2 text-xs text-slate-700" id="restore-confirm-box">
            <div className="font-bold text-rose-700 flex items-center gap-1">
              <AlertCircle className="w-4 h-4" /> تأكيد الاستعادة من الملف: {pending.fileName}
            </div>
            <ul className="list-disc pr-5 space-y-0.5">
              <li>تاريخ التصدير: <span dir="ltr">{pending.summary.exportedAt || 'غير معروف'}</span></li>
              <li>
                الطلاب: {pending.summary.students} • القوالب: {pending.summary.templates} • الحملات: {pending.summary.campaigns} • السجلات: {pending.summary.logs}
                {' '}• المجموعات: {pending.summary.groups}
                {' '}• قائمة عدم الإرسال: {pending.summary.suppressed}
              </li>
              {pending.summary.hasPrefs && <li>تتضمن هذه النسخة اسم المدرسة والإعدادات غير السرية.</li>}
              <li className="text-amber-700">لن تُستورد كلمات مرور مودل أو الملاحظات إن وُجدت في ملف قديم. تبقى أي بيانات محفوظة حالياً كما هي.</li>
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
