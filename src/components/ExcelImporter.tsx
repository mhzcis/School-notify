/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { Student } from '../types';
import { MappedField, mapRowToStudentFields, resolveHeaderMap } from '../lib/excelMapping';
import { checkPhone, isSendablePhone } from '../lib/phone';
import { matchNames } from '../lib/nameMatching';
import SecretText from './SecretText';
import { 
  FileUp, 
  Download, 
  CheckCircle2, 
  AlertCircle, 
  Trash2, 
  X, 
  CheckSquare, 
  Users, 
  FileText, 
  ExternalLink,
  AreaChart,
  RefreshCw
} from 'lucide-react';

interface ExcelImporterProps {
  students: Student[];
  onImportComplete: (students: Student[]) => void;
  currentStudentsCount: number;
  onSelectExcelBatch: (matchedIds: string[]) => void;
}

export default function ExcelImporter({ 
  students, 
  onImportComplete, 
  currentStudentsCount,
  onSelectExcelBatch 
}: ExcelImporterProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const matchFileInputRef = useRef<HTMLInputElement>(null);
  
  // Tabs: 'register' to register new students, 'match' to create a targeted broadcast list
  const [importMode, setImportMode] = useState<'register' | 'match'>('register');
  
  // Registration States
  const [error, setError] = useState<string | null>(null);
  const [successCount, setSuccessCount] = useState<number | null>(null);
  const [parsedData, setParsedData] = useState<Student[]>([]);
  const [dragActive, setDragActive] = useState<boolean>(false);

  // Matching Mode States
  const [matchError, setMatchError] = useState<string | null>(null);
  const [matchedIds, setMatchedIds] = useState<string[]>([]);
  const [excelReport, setExcelReport] = useState<{
    success: boolean;
    totalRows: number;
    matchedCount: number;
    matchedNames: string[];
    unmatchedNames: string[];
    suggestions?: Record<string, string[]>;
  } | null>(null);
  const [unmatchedExcelSearch, setUnmatchedExcelSearch] = useState<string>('');
  const [matchDragActive, setMatchDragActive] = useState<boolean>(false);

  // Download Sample Excel Template
  const handleDownloadTemplate = () => {
    const templateRows = [
      {
        "المنطقة": "منطقة الشمال",
        "المدرسة": "مدرسة الأمل الأساسية بنين",
        "الصف": "الصف العاشر",
        "الشعبة": "أ",
        "نوع بطاقة التعريف": "هوية فلسطينية",
        "رقم بطاقة التعريف": "402391029",
        "رقم تسجيل الفرد": "1009283",
        "رقم تسجيل العائلة": "8823901",
        "اسم الطالب": "أحمد محمد العتيبي",
        "اسم الطالب انجليزي": "Ahmed Mohamed Al-Otaibi",
        "حالة اللجوء": "لاجئ",
        "اسم ولي امر الطالب": "محمد العتيبي",
        "اسم الأم": "سلافة أحمد",
        "مهنة ولي الأمر": "مهندس مدني",
        "مهنة الأم": "ربة بيت",
        "الجنسية": "عربي",
        "الجنس": "ذكر",
        "تاريخ  الميلاد": "2010-05-15",
        "مكان الميلاد": "طولكرم",
        "المدينة": "طولكرم",
        "المحافظة": "طولكرم",
        "البلدة الأصلية": "يافا",
        "العنوان": "الحي الشرقي - شارع المعاهد",
        "جوال العائلة": "0599123456",
        "تليفون العائلة": "022394857",
        "الديانة": "الإسلام",
        "شبكة  الأمان الاجتماعي": "نعم تشمل العائلة",
        "هل لديه مرض مزمن": "لا يوجد",
        "يسكن في المخيم": "نعم",
        "معدل الطالب العام السابق": "92.4",
        "ملاحظات أو مستحقات": "الرسوم المتبقية: 500 ريال",
        "اسم المستخدم": "demo.student1",
        "كلمة المرور": "Demo-Pass-1"
      },
      {
        "المنطقة": "منطقة الوسطى",
        "المدرسة": "مدرسة اليرموك الإعدادية مختلطة",
        "الصف": "الصف العاشر",
        "الشعبة": "أ",
        "نوع بطاقة التعريف": "هوية فلسطينية",
        "رقم بطاقة التعريف": "993021983",
        "رقم تسجيل الفرد": "1009581",
        "رقم تسجيل العائلة": "7748123",
        "اسم الطالب": "سارة خالد عسيري",
        "اسم الطالب انجليزي": "Sara Khaled Assiri",
        "حالة اللجوء": "لاجئ",
        "اسم ولي امر الطالب": "خالد عسيري",
        "اسم الأم": "ليلى محمود",
        "مهنة ولي الأمر": "تاجر",
        "مهنة الأم": "معلمة",
        "الجنسية": "عربي",
        "الجنس": "أنثى",
        "تاريخ  الميلاد": "2010-11-20",
        "مكان الميلاد": "غزة",
        "المدينة": "غزة",
        "المحافظة": "غزة",
        "البلدة الأصلية": "بئر السبع",
        "العنوان": "حي الرمال - مقابل المسجد الكبير",
        "جوال العائلة": "0505234567",
        "تليفون العائلة": "082823456",
        "الديانة": "الإسلام",
        "شبكة  الأمان الاجتماعي": "لا تشمل",
        "هل لديه مرض مزمن": "لا يوجد",
        "يسكن في المخيم": "لا",
        "معدل الطالب العام السابق": "95.8",
        "ملاحظات أو مستحقات": "الرسوم المتبقية: لا يوجد",
        "اسم المستخدم": "demo.student2",
        "كلمة المرور": "Demo-Pass-2"
      }
    ];

    const worksheet = XLSX.utils.json_to_sheet(templateRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "نموذج الطلاب");
    worksheet["!cols"] = Object.keys(templateRows[0]).map(() => ({ wch: 24 }));

    XLSX.writeFile(workbook, "نموذج_استيراد_طلاب_المدرسه.xlsx");
  };

  // Helper to normalize Arabic strings
  const normalizeArabic = (str: string): string => {
    if (!str) return "";
    return str
      .replace(/["'”’«»`’']/g, "")
      .replace(/[\u0640]/g, "")
      .replace(/[\u064B-\u065F]/g, "")
      .replace(/[أإآٱ]/g, "ا")
      .replace(/[ة]/g, "ه")
      .replace(/[ى]/g, "ي")
      .replace(/[^a-zA-Z0-9\u0621-\u064A\u0660-\u0669]/g, "")
      .trim()
      .toLowerCase();
  };

  // ----------------- REGISTRATION UPLOADER LOGIC -----------------
  // Header -> field mapping is resolved once per sheet with exact/priority rules (see lib/excelMapping).
  const mapHeadersToStudentFields = (row: any, headerMap: Record<string, MappedField>): Partial<Student> | null => {
    if (Object.keys(row).length === 0) return null;
    const student: Partial<Student> = mapRowToStudentFields(row, headerMap);

    if (!student.name || !student.grade) {
      return null;
    }

    if (!student.id) {
      // Long random id: the old 4-digit id could collide and overwrite another student on merge.
      student.id = student.idNumber || 'ST' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }
    if (!student.parentName) {
      student.parentName = student.name.split(' ').slice(1).join(' ') || "ولي الأمر";
    }
    if (!student.section) {
      student.section = "أ";
    }
    // Never invent a phone number. Normalise valid mobiles (e.g. Excel dropped the leading 0);
    // keep invalid/missing values as-is so the student is flagged and excluded from sending.
    const primary = checkPhone(student.phone);
    if (primary.valid) {
      student.phone = primary.local;
    } else if (!student.phone && isSendablePhone(student.phone2)) {
      student.phone = checkPhone(student.phone2).local;
    } else if (!student.phone) {
      student.phone = '';
    }

    return student as Student;
  };

  const processFile = (file: File) => {
    setError(null);
    setSuccessCount(null);
    setParsedData([]);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        if (!data) throw new Error("لا يمكن قراءة بيانات الملف");

        const workbook = XLSX.read(data, { type: 'binary' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

        if (rawRows.length === 0) {
          setError("لم يتم العثور على أي معلومات في ورقة العمل الأولى بملف الإكسل.");
          return;
        }

        let headerRowIndex = 0;
        let bestHeaderMatchCount = 0;
        const targetIndicators = [
          "اسمالطالب", "المنطقه", "المدرسه", "الصف", "الشعبه", 
          "جوالالعائله", "رقمالهاتف", "الاسم", "جوال", "المحافظه"
        ];

        for (let r = 0; r < Math.min(20, rawRows.length); r++) {
          const rowCells = rawRows[r];
          if (!rowCells || !Array.isArray(rowCells)) continue;
          
          let matches = 0;
          rowCells.forEach(cell => {
            if (cell !== null && cell !== undefined) {
              const norm = normalizeArabic(String(cell));
              if (targetIndicators.some(ind => norm.includes(ind) || ind.includes(norm))) {
                matches++;
              }
            }
          });

          if (matches > bestHeaderMatchCount) {
            bestHeaderMatchCount = matches;
            headerRowIndex = r;
          }
        }

        let objectsToParse: any[] = [];
        let headers: string[] = [];

        if (bestHeaderMatchCount >= 1) {
          headers = rawRows[headerRowIndex].map(h => String(h || '').trim());
          for (let r = headerRowIndex + 1; r < rawRows.length; r++) {
            const rowCells = rawRows[r];
            if (!rowCells || rowCells.length === 0) continue;
            
            const obj: any = {};
            let hasAnyValue = false;
            headers.forEach((header, colIdx) => {
              if (header && colIdx < rowCells.length) {
                const cellVal = rowCells[colIdx];
                if (cellVal !== undefined && cellVal !== null) {
                  obj[header] = cellVal;
                  hasAnyValue = true;
                }
              }
            });
            if (hasAnyValue) {
              objectsToParse.push(obj);
            }
          }
        } else {
          objectsToParse = XLSX.utils.sheet_to_json(worksheet);
          if (objectsToParse.length > 0) {
            headers = Object.keys(objectsToParse[0]).map(h => String(h || '').trim());
          }
        }

        if (objectsToParse.length === 0) {
          setError("لم يتم مطابقة ملف الإكسل. يرجى مراجعة رؤوس الأعمدة ومطابقتها.");
          return;
        }

        const headerMap = resolveHeaderMap(headers);
        const validStudents: Student[] = [];
        let failedRows = 0;

        objectsToParse.forEach((row: any) => {
          const mapped = mapHeadersToStudentFields(row, headerMap);
          if (mapped) {
            validStudents.push(mapped as Student);
          } else {
            failedRows++;
          }
        });

        if (validStudents.length === 0) {
          const detectedSample = headers.filter(Boolean).slice(0, 12).join(" | ");
          setError(`فشل في استيراد الطلاب. يرجى مراجعة مسميات الأعمدة. الأعمدة المكتشفة بالملف الحالي هي: (${detectedSample} ...). يرجى التأكد من توفر عمود "اسم الطالب" وعمود "الصف" تحت هذه المسميات الصريحة.`);
          return;
        }

        setParsedData(validStudents);
        setSuccessCount(validStudents.length);
        const warnings: string[] = [];
        if (failedRows > 0) {
          warnings.push(`تم التعرف على بنية البيانات بنجاح، ولكن تم تخطي عدد (${failedRows}) أسطر لعدم اكتمال بياناتها الأساسية كالصف أو اسم الطالب.`);
        }
        const noPhone = validStudents.filter(s => !isSendablePhone(s.phone));
        if (noPhone.length > 0) {
          warnings.push(`تنبيه: (${noPhone.length}) طالب بدون رقم جوال صالح (${noPhone.slice(0, 5).map(s => s.name).join('، ')}${noPhone.length > 5 ? '، ...' : ''}). سيتم استيرادهم لكن سيُستبعدون من الإرسال حتى تصحيح الرقم.`);
        }
        const withMoodleUser = validStudents.filter(s => s.moodleUsername).length;
        const withMoodlePass = validStudents.filter(s => s.moodlePassword).length;
        if (withMoodleUser || withMoodlePass) {
          warnings.push(`ملاحظة: تم استيراد بيانات مودل (اسم مستخدم: ${withMoodleUser}، كلمة مرور: ${withMoodlePass}). كلمات المرور تُحفظ كنص عادي داخل هذا المتصفح فقط وتظهر مخفية في القوائم.`);
        }
        if (warnings.length) setError(warnings.join(' '));
      } catch (err: any) {
        setError(`حدث خطأ أثناء معالجة ملف الإكسل: ${err.message || err}`);
      }
    };

    reader.onerror = () => {
      setError("خطأ في قراءة الملف.");
    };

    reader.readAsBinaryString(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      processFile(files[0]);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const executeImport = () => {
    if (parsedData.length > 0) {
      onImportComplete(parsedData);
      setParsedData([]);
      setSuccessCount(null);
      setError(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const clearCurrentDraft = () => {
    setParsedData([]);
    setSuccessCount(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // ----------------- MATCHING MODE LOGIC -----------------
  const handleMatchFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      processMatchFile(files[0]);
    }
  };

  const handleMatchDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setMatchDragActive(true);
    } else if (e.type === "dragleave") {
      setMatchDragActive(false);
    }
  };

  const handleMatchDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMatchDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processMatchFile(e.dataTransfer.files[0]);
    }
  };

  const processMatchFile = (file: File) => {
    setMatchError(null);
    setExcelReport(null);

    const matchReader = new FileReader();
    matchReader.onload = (event) => {
      try {
        const ab = event.target?.result as ArrayBuffer;
        const u8 = new Uint8Array(ab);
        const workbook = XLSX.read(u8, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        
        const jsonData = XLSX.utils.sheet_to_json<any>(worksheet);
        if (jsonData.length === 0) {
          setMatchError('ملف الإكسل المرفوع فارغ أو يحتوي على بيانات غير مقروءة.');
          return;
        }

        const firstRowKeys = Object.keys(jsonData[0]);
        let studentNameKey = firstRowKeys.find(key => 
          key.includes('اسم الطالب') || 
          key.includes('الاسم') || 
          key.includes('الطالب') || 
          key.toLowerCase().includes('name') || 
          key.toLowerCase().includes('student')
        );

        if (!studentNameKey && firstRowKeys.length > 0) {
          studentNameKey = firstRowKeys[0];
        }

        if (!studentNameKey) {
          setMatchError('لم نتمكن من تحديد أي عمود يحتوي على أسماء الطلاب في الملف للقيام بمطابقتها.');
          return;
        }

        const parsedNames: string[] = jsonData
          .map(row => String(row[studentNameKey!]).trim())
          .filter(name => name && name !== 'undefined' && name !== 'null' && name.length > 1);

        if (parsedNames.length === 0) {
          setMatchError('لا توجد أسماء طلاب صالحة ومقروءة في العمود المكتشف بملف الإكسل.');
          return;
        }

        // Only exact normalised full-name matches are auto-selected; duplicates and partial
        // matches are listed with candidates for a manual choice (never auto-picked).
        const nameMatch = matchNames(parsedNames, students);
        const tempMatchedIds: string[] = nameMatch.matchedIds;
        const matchedNamesList: string[] = nameMatch.matched.map(m => {
          const st = students.find(s => s.id === m.studentId)!;
          return `${m.raw} ➔ (${st.name} - ${st.grade})`;
        });
        const suggestions: Record<string, string[]> = {};
        nameMatch.ambiguous.forEach(a => { suggestions[a.raw] = a.candidateIds; });
        const unmatchedNamesList: string[] = [
          ...nameMatch.ambiguous.map(a => a.raw),
          ...nameMatch.unmatched,
        ];

        setMatchedIds(tempMatchedIds);
        setExcelReport({
          success: true,
          totalRows: parsedNames.length,
          matchedCount: tempMatchedIds.length,
          matchedNames: matchedNamesList,
          unmatchedNames: unmatchedNamesList,
          suggestions
        });

      } catch (err: any) {
        console.error("Match error:", err);
        setMatchError(`فشل فحص ومطابقة كشف الطلاب: ${err.message || String(err)}`);
      }
    };

    matchReader.readAsArrayBuffer(file);
  };

  const handleManualMatch = (rawName: string, studentId: string) => {
    if (!excelReport) return;
    const student = students.find(s => s.id === studentId);
    if (!student) return;

    setMatchedIds(prev => {
      if (!prev.includes(studentId)) {
        return [...prev, studentId];
      }
      return prev;
    });

    setExcelReport(prev => {
      if (!prev) return null;
      const nextUnmatched = prev.unmatchedNames.filter(name => name !== rawName);
      const nextMatchedNames = [...prev.matchedNames, `${rawName} ➔ (ربط يدوي: ${student.name} - ${student.grade})`].filter(Boolean);
      return {
        ...prev,
        matchedCount: prev.matchedCount + 1,
        matchedNames: nextMatchedNames,
        unmatchedNames: nextUnmatched
      };
    });
  };

  const handleConfirmBatch = () => {
    if (matchedIds.length === 0) {
      alert("يرجى مطابقة وتحديد زبون أو طالب واحد على الأقل قبل تأكيد البث.");
      return;
    }
    onSelectExcelBatch(matchedIds);
    setExcelReport(null);
    setMatchedIds([]);
  };

  const handleCancelMatch = () => {
    setExcelReport(null);
    setMatchedIds([]);
    setMatchError(null);
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-xs" id="excel-importer-container">
      
      {/* Title block */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 pb-4 border-b border-slate-100">
        <div>
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <FileUp className="w-5 h-5 text-emerald-600" />
            منصة معالجة ملفات Excel لبيانات ومستلمي الرسائل 
          </h2>
          <p className="text-sm text-slate-500 mt-1">تفريغ السجلات وتوزيع المستهدفين وتوجيههم للبث الذكي فوراّ</p>
        </div>

        <button
          onClick={handleDownloadTemplate}
          className="flex items-center justify-center gap-2 px-4 py-2 border border-slate-200 hover:border-emerald-500 text-slate-700 hover:text-emerald-700 hover:bg-emerald-50/55 rounded-xl transition duration-200 text-sm font-bold shadow-3xs"
          id="btn-download-template"
        >
          <Download className="w-4 h-4 text-emerald-600" />
          تحميل كشف عينة Excel معتمد للطلاب
        </button>
      </div>

      {/* Segment switcher with 100% compliance only inside this tab */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-1.5 bg-slate-100 rounded-2xl mb-6 max-w-lg shadow-sm" id="excel-tabs">
        <button
          type="button"
          onClick={() => {
            setImportMode('register');
            handleCancelMatch();
          }}
          className={`py-2.5 px-4 text-xs font-black rounded-xl transition-all duration-200 cursor-pointer flex items-center justify-center gap-2 ${
            importMode === 'register'
              ? 'bg-white text-emerald-700 shadow-sm font-black'
              : 'text-slate-500 hover:text-slate-800 hover:bg-white/40'
          }`}
        >
          📂 تسجيل وحفظ طلاب جدد بسجل المدرسة
        </button>
        
        <button
          type="button"
          onClick={() => {
            setImportMode('match');
            clearCurrentDraft();
          }}
          className={`py-2.5 px-4 text-xs font-black rounded-xl transition-all duration-200 cursor-pointer flex items-center justify-center gap-2 ${
            importMode === 'match'
              ? 'bg-white text-indigo-700 shadow-sm font-black'
              : 'text-slate-500 hover:text-slate-800 hover:bg-white/40'
          }`}
        >
          🎯 مطابقة كشف خارجي وتوجيهه للبث المباشر
        </button>
      </div>

      {/* RENDER MODE 1: REGISTER NEW STUDENTS */}
      {importMode === 'register' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-fade-in" id="mode-register-students">
          <div className="lg:col-span-4 bg-slate-50 rounded-xl p-5 border border-slate-100/85">
            <h3 className="font-bold text-slate-800 text-sm mb-3 flex items-center gap-1.5">
              <span>💡</span> شروط البيانات للإرسال والمحاذاة الناجحة:
            </h3>
            
            <ul className="space-y-3.5 text-xs text-slate-600">
              <li className="flex gap-2">
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full mt-1.5 shrink-0" />
                <span>دعم صيغتي <strong>.xlsx</strong> و <strong>.csv</strong></span>
              </li>
              <li className="flex gap-2">
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full mt-1.5 shrink-0" />
                <span>يجب توفر الأعمدة الحيوية التالية:</span>
              </li>
              <li className="pr-4 border-r-2 border-emerald-350 space-y-1.5 font-sans">
                <div>• <strong>اسم الطالب</strong> (الكامل والرباعي لتجنب التشابه)</div>
                <div>• <strong>الصف</strong> (الصف مثل العاشر، السابع، إلخ)</div>
                <div>• <strong>جوال العائلة</strong> (رقم الهاتف مع الرمز لتفادي المفقودات)</div>
              </li>
              <li className="flex gap-2">
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full mt-1.5 shrink-0" />
                <span>البيانات كالأرقام الوطنية، الشعب الدراسية والمستحقات مواءمتها اختيارية.</span>
              </li>
            </ul>

            <div className="mt-8 pt-4 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500 font-sans font-bold">
              <span>إجمالي الطلاب المسجلين بالدليل:</span>
              <span className="font-mono bg-emerald-100 text-emerald-800 px-2.5 py-0.5 rounded-full">{currentStudentsCount} طالباً</span>
            </div>
          </div>

          <div className="lg:col-span-8 flex flex-col justify-between">
            <div
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`flex-1 border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-300 min-h-[220px] ${
                dragActive
                  ? 'border-emerald-500 bg-emerald-50/50'
                  : 'border-slate-200 hover:border-emerald-300 hover:bg-slate-50/20'
              }`}
              id="drag-drop-zone-register"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx, .xls, .csv"
                onChange={handleFileChange}
                className="hidden"
              />
              
              <div className="p-4 bg-emerald-50 text-emerald-600 rounded-full mb-3 shrink-0">
                <FileUp className="w-7 h-7 animate-pulse" />
              </div>

              <p className="font-bold text-slate-700 text-sm">اسحب ملف إكسل الكلي للمدرسة أو انقر هنا للرفع فوراّ</p>
              <p className="text-xs text-slate-400 mt-1.5">يدعم الامتدادات المعتمدة بحد بروتوكول 5 ميجابايت كروي</p>
            </div>

            {error && (
              <div className="mt-4 flex gap-3.5 bg-amber-50 border border-amber-200 text-amber-900 p-3.5 rounded-xl text-xs leading-relaxed" id="reg-error-msg">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                <div>{error}</div>
              </div>
            )}

            {successCount !== null && parsedData.length > 0 && (
              <div className="mt-4 bg-emerald-50/40 border border-emerald-150 p-4 rounded-xl" id="reg-success">
                <div className="flex items-center gap-2 text-emerald-850 font-bold text-sm">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  قراءة وتحليل كشف الطلاب ناجحة! وجدنا {successCount} سِجلاً مفرداً وجاهزاً للتأكيد.
                </div>

                <div className="mt-3 max-h-[160px] overflow-y-auto border border-emerald-100 rounded-lg bg-white">
                  <table className="w-full text-right text-xs text-slate-650 font-sans">
                    <thead className="bg-slate-50 text-slate-700 sticky top-0 border-b border-slate-100">
                      <tr>
                        <th className="p-2 py-1.5 text-right font-semibold">رقم الطالب</th>
                        <th className="p-2 py-1.5 text-right font-semibold">اسم الطالب</th>
                        <th className="p-2 py-1.5 text-right font-semibold">الصف / الشعبة</th>
                        <th className="p-2 py-1.5 text-right font-semibold">المحمول المالي</th>
                        <th className="p-2 py-1.5 text-right font-semibold">مودل</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {parsedData.slice(0, 5).map((st, idx) => (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="p-2 text-slate-500 font-mono text-[11px]">{st.id}</td>
                          <td className="p-2 font-bold text-slate-800">{st.name}</td>
                          <td className="p-2 text-slate-600">{st.grade} - {st.section}</td>
                          <td className="p-2 text-slate-500 font-mono text-[11px]">{st.phone}</td>
                          <td className="p-2 text-[11px]">
                            <span className="font-mono" dir="ltr">{st.moodleUsername || '—'}</span>
                            {st.moodlePassword ? <> / <SecretText value={st.moodlePassword} /></> : null}
                          </td>
                        </tr>
                      ))}
                      {parsedData.length > 5 && (
                        <tr>
                          <td colSpan={5} className="p-2 text-center text-slate-400 bg-slate-50/50 font-bold">
                            وعدد {parsedData.length - 5} سجلات طلاب إضافية...
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center justify-end gap-3 mt-4 border-t border-slate-100 pt-3">
                  <button
                    onClick={clearCurrentDraft}
                    className="flex items-center gap-1.5 px-3.5 py-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl text-xs font-bold transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    إلغاء السجل
                  </button>
                  <button
                    onClick={executeImport}
                    className="flex items-center gap-1.5 px-5 font-black py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs shadow-xs transition duration-150"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    تحديث وحفظ الطلاب بسجل المدرسة 💾
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* RENDER MODE 2: SMART ADHOC MATCHING REPORT FOR BROADCAST TARGETS */}
      {importMode === 'match' && (
        <div className="space-y-6 animate-fade-in" id="mode-matching-targets">
          
          {!excelReport ? (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              <div className="lg:col-span-4 bg-slate-50 rounded-xl p-5 border border-slate-100">
                <h3 className="font-bold text-slate-800 text-sm mb-3">🎯 آلية بث الدفعات الفورية عبر مطابقة الإكسل:</h3>
                
                <ul className="space-y-3.5 text-xs text-slate-600 font-medium">
                  <li className="flex gap-2">
                    <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full mt-1.5 shrink-0" />
                    <span>هذه الأداة مصممة لمطابقة كشوف لجان خارجية أو دفعات رسائل مالية تالفة مع طلابك المسجلين بالمدرسة فوراّ.</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full mt-1.5 shrink-0" />
                    <span>سيقوم النظام بمحاذاة تامة وفحص الأسماء المقروءة للتأكد من ربطها بالأرقام والهواتف المسجلة بذكاء.</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full mt-1.5 shrink-0" />
                    <span>في حال وجود فروقات طفيفة بالأسماء، يمنحك التقرير مربعاً فورياً للربط اليدوي والتعيين لحماية التواصل بدون فقدان.</span>
                  </li>
                </ul>
              </div>

              <div className="lg:col-span-8">
                <div
                  onDragEnter={handleMatchDrag}
                  onDragOver={handleMatchDrag}
                  onDragLeave={handleMatchDrag}
                  onDrop={handleMatchDrop}
                  onClick={() => matchFileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-300 min-h-[220px] ${
                    matchDragActive
                      ? 'border-indigo-500 bg-indigo-50/50'
                      : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50/20'
                  }`}
                  id="drag-drop-zone-match"
                >
                  <input
                    ref={matchFileInputRef}
                    type="file"
                    accept=".xlsx, .xls, .csv"
                    onChange={handleMatchFileChange}
                    className="hidden"
                  />
                  
                  <div className="p-4 bg-indigo-50 text-indigo-600 rounded-full mb-3 shrink-0">
                    <AreaChart className="w-7 h-7" />
                  </div>

                  <p className="font-bold text-slate-700 text-sm">ارفع ملف إرسال الدفعة الجانبية للمطابقة والتحقق</p>
                  <p className="text-xs text-slate-400 mt-1.5">يقوم بالاستيراد والمطابقة مع ملفات .xlsx / .csv</p>
                </div>

                {matchError && (
                  <div className="mt-4 flex gap-3.5 bg-rose-50 border border-rose-200 text-rose-900 p-3.5 rounded-xl text-xs leading-relaxed">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
                    <div>{matchError}</div>
                  </div>
                )}
              </div>

            </div>
          ) : (
            
            // INDEPENDENT AND BEAUTIFULLY DETAILED EXCEL MATCHING REPORT DISPLAY WITH BUGFIXES FOR UNMATCHED LIST
            <div className="space-y-6" id="matching-results-panel">
              
              <div className="p-4 rounded-xl border border-indigo-150 bg-indigo-50/20 space-y-4 animate-fade-in text-right">
                <div className="font-bold text-indigo-900 flex items-center justify-between border-b border-indigo-100 pb-2">
                  <span className="flex items-center gap-1.5 font-bold text-sm font-sans">
                    <CheckSquare className="w-5 h-5 text-emerald-600 animate-bounce" />
                    <span>تقرير نجاح ومطابقة ملف الإكسل المرفوع للبث المروي:</span>
                  </span>
                  <span className="font-mono text-xs bg-indigo-100 text-indigo-800 px-3 py-1 rounded-lg font-black shadow-3xs">
                    نسبة المطابقة الناجحة: {Math.round((excelReport.matchedCount / excelReport.totalRows) * 100) || 0}%
                  </span>
                </div>

                {/* Bento metrics counters cards */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center text-xs">
                  <div className="bg-white border border-slate-200 rounded-xl p-3 font-bold shadow-3xs">
                    <div className="text-slate-400 text-[10px] font-bold">إجمالي الكشف المرفوع</div>
                    <div className="text-lg font-black text-slate-700 font-mono mt-0.5">{excelReport.totalRows} مستلم</div>
                  </div>
                  
                  <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 font-bold shadow-3xs">
                    <div className="text-emerald-700 text-[10px] font-bold">مطابق ومستهدف</div>
                    <div className="text-lg font-black text-emerald-600 font-mono mt-0.5">{excelReport.matchedCount} طالب</div>
                  </div>
                  
                  <div className="bg-rose-50 border border-rose-100 rounded-xl p-3 font-bold shadow-3xs">
                    <div className="text-rose-700 text-[10px] font-bold">مستثنى وغير مطابق ⚠️</div>
                    <div className="text-lg font-black text-rose-600 font-mono mt-0.5">{excelReport.unmatchedNames.length} أسماء</div>
                  </div>
                </div>

                <p className="text-slate-600 text-xs leading-relaxed font-semibold">
                  تحليل البيانات المرفوعة ناجح كلياّ! تم فحص <span className="font-bold text-slate-850">{excelReport.totalRows}</span> اسماً. نجح النظام في مطابقة <span className="font-bold text-emerald-700">{excelReport.matchedCount}</span> طالباً بالدليل، وهم جاهزون فوراّ للبث لإرسال الرسائل لآبائهم.
                </p>

                {/* THE HIGHER QUALITY COMPACT MATCHED NAMES LIST PREVIEW */}
                <div className="bg-white p-3.5 rounded-xl border border-indigo-100 space-y-2">
                  <div className="text-[11px] font-bold text-indigo-950">قائمة المستلمين الذين تم ربطهم وتأكيدهم ({excelReport.matchedNames.length}):</div>
                  <div className="max-h-[140px] overflow-y-auto border border-indigo-50 rounded-lg p-2 bg-slate-50/30 font-mono text-[10px] text-emerald-800 leading-relaxed text-right font-sans">
                    {excelReport.matchedNames.map((line, k) => (
                      <div key={k} className="p-1 px-1.5 border-b border-indigo-100/30 flex items-center gap-1">
                        <span className="text-emerald-500 font-bold">✓</span>
                        <span>{line}</span>
                      </div>
                    ))}
                    {excelReport.matchedNames.length === 0 && (
                      <div className="text-slate-400 p-2 text-center">لا توجد أسماء مطابقة بالكامل حالياً</div>
                    )}
                  </div>
                </div>

                {/* BUGFIX EXTREME HIGH INTEGRITY DISPLAY FOR THE FAILED/UNMATCHED LIST */}
                {excelReport.unmatchedNames.length > 0 && (
                  <div className="p-4 bg-white border border-rose-150 rounded-xl space-y-3 shadow-sm">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-rose-50">
                      <span className="font-bold text-rose-800 flex items-center gap-1.5 text-xs">
                        <AlertCircle className="w-5 h-5 text-rose-600 animate-pulse" />
                        السجلات المرفوعة التي لم تنجح في المطابقة التلقائية ({excelReport.unmatchedNames.length}):
                      </span>

                      <button
                        type="button"
                        onClick={() => {
                          const unmatchedListText = excelReport.unmatchedNames.join('\n');
                          navigator.clipboard.writeText(unmatchedListText);
                          alert('✓ تم نسخ الأسماء غير المطابقة الباقية لحافظة جهازك لمراجعتها لاحقاً بملف الإكسل.');
                        }}
                        className="text-[10px] bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 px-3.5 py-1 rounded-lg font-bold transition flex items-center gap-1 cursor-pointer font-sans"
                      >
                        نسخ قائمة غير المطابقة 📋
                      </button>
                    </div>

                    <p className="text-[10.5px] text-rose-950 font-semibold leading-normal bg-rose-50/50 p-3 rounded-xl border border-rose-100">
                      💡 هذه الأسماء لم نصل لمطابقتها في قاعدة المدرسة الحالية لعدم مطابقتها الحرفية. 
                      <strong> يمكنك تعيين وربط كل اسم يدوياً من القائمة المنسدلة المجاورة</strong> لربطه بالسجل الهاتفي فوراّ وبث الرسالة له!
                    </p>

                    {/* Local filtering input within unmatched block */}
                    <div className="max-w-md">
                      <input
                        type="text"
                        placeholder="البحث والتصفية بالأسماء غير المطابقة الحالية..."
                        value={unmatchedExcelSearch}
                        onChange={(e) => setUnmatchedExcelSearch(e.target.value)}
                        className="w-full text-xs px-3 py-2 bg-slate-50 focus:bg-white text-slate-800 border border-slate-200 focus:border-rose-300 rounded-xl outline-hidden shadow-2xs font-semibold"
                      />
                    </div>

                    <div className="max-h-[220px] overflow-y-auto border border-rose-100 rounded-xl divide-y divide-slate-100 bg-rose-50/15 p-2 space-y-1.5" id="unmatched-names-scrollable-log">
                      {excelReport.unmatchedNames
                        .filter(name => name.toLowerCase().includes(unmatchedExcelSearch.toLowerCase()))
                        .map((rawName, index) => (
                          <div key={index} className="p-2.5 text-xs font-mono text-rose-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-rose-50/50 rounded-lg border border-transparent hover:border-rose-100 transition duration-150">
                            
                            <div className="flex items-center gap-2 select-none">
                              <span className="text-rose-500 font-extrabold font-mono text-xs">#{index + 1}</span>
                              <span className="text-slate-800 font-sans font-bold text-xs">{rawName}</span>
                              {(excelReport.suggestions?.[rawName] || []).length > 0 && (
                                <span className="text-amber-700 font-sans text-[10px] font-bold">⚠️ تطابق غير مؤكد ({excelReport.suggestions![rawName].length} مرشح) — اختر يدوياً</span>
                              )}
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <select
                                onChange={(e) => {
                                  if (e.target.value) {
                                    handleManualMatch(rawName, e.target.value);
                                    e.target.value = ''; // reset selection trigger
                                  }
                                }}
                                className="px-3 py-1.5 bg-white border border-rose-200 focus:border-indigo-500 hover:border-slate-300 rounded-xl text-[10.5px] text-slate-700 outline-hidden shadow-3xs font-semibold cursor-pointer max-w-[210px]"
                              >
                                  <option value="">🔧 ربط يدوي وتعيين للطالب...</option>
                                  {(excelReport.suggestions?.[rawName] || []).length > 0 && (
                                    <optgroup label="مرشحون محتملون (اختر الصحيح)">
                                      {(excelReport.suggestions?.[rawName] || []).map(cid => {
                                        const c = students.find(s => s.id === cid);
                                        return c ? <option key={'c-' + cid} value={cid}>{c.name} ({c.grade} {c.section})</option> : null;
                                      })}
                                    </optgroup>
                                  )}
                                {students
                                  .slice()
                                  .sort((a, b) => a.name.localeCompare(b.name, 'ar'))
                                  .map(st => (
                                    <option key={st.id} value={st.id}>
                                      {st.name} ({st.grade})
                                    </option>
                                  ))
                                }
                              </select>
                            </div>

                          </div>
                        ))
                      }
                      {excelReport.unmatchedNames.filter(name => name.toLowerCase().includes(unmatchedExcelSearch.toLowerCase())).length === 0 && (
                        <div className="p-6 text-center text-xs text-slate-400 font-bold bg-white/50 rounded-xl">لا توجد أسماء مفقودة غير مطابقة تفي بهذا البحث حالياً!</div>
                      )}
                    </div>

                  </div>
                )}

                {/* Final action dispatches */}
                <div className="flex items-center justify-end gap-3 mt-4 border-t border-slate-100 pt-4">
                  <button
                    onClick={handleCancelMatch}
                    className="flex items-center gap-1.5 px-4 py-2 text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-xl text-xs font-bold transition duration-150"
                  >
                    <X className="w-4 h-4" />
                    إلغاء وضع المطابقة
                  </button>

                  <button
                    onClick={handleConfirmBatch}
                    className="flex items-center gap-1.5 px-6 font-black py-2.5 bg-indigo-650 hover:bg-indigo-700 text-white rounded-xl text-xs shadow-md hover:shadow-lg transition duration-200"
                    id="btn-match-confirm-batch"
                  >
                    <CheckSquare className="w-4 h-4 animate-pulse" />
                    تأكيد الدفعة وتوصيلها للبث الفوري الموحد ⚡
                  </button>
                </div>

              </div>

            </div>
          )}

        </div>
      )}

    </div>
  );
}
