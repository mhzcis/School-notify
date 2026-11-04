/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { renderTemplate, PLACEHOLDERS, missingMoodleFields } from '../lib/template';
import SecretText from './SecretText';
import { buildDispatchItems } from '../lib/recipients';
import { matchNames } from '../lib/nameMatching';
import { segmentInfo } from '../lib/sms';
import ConfirmSendDialog from './ConfirmSendDialog';
import { statusAfterGatewayCall } from '../lib/logStatus';
import { PHONE_PROBLEM_LABELS } from '../lib/phone';
import { Student, MessageTemplate, ScheduledMessage, MessageLog } from '../types';
import { readUseCloudGateway } from '../lib/smsPrefs';
import { invokeSmsFunction } from '../lib/supabase';
import { proxyErrorMessage, sendViaProxy, ProxyItemResult } from '../lib/smsProxy';
import { newId as newLogId } from '../lib/repo/mapping';
import { 
  Send, 
  Calendar, 
  CheckSquare, 
  Users, 
  AlertCircle, 
  FileText, 
  Smartphone, 
  Search, 
  RefreshCw, 
  Layers,
  Loader2,
  MessageCircle,
  ExternalLink,
  ShieldCheck,
  Check,
  X,
  Play,
  Pause,
  Square,
  SkipForward,
  ChevronDown,
  SlidersHorizontal
} from 'lucide-react';

// Helper to discard non-student metadata/headers rows in Excel sheets
function isNoiseRow(name: string): boolean {
  if (!name) return true;
  const clean = name.trim();
  if (clean.length < 3) return true;
  
  // If it's a number, it's noise
  if (/^\d+$/.test(clean.replace(/[\s-+()]/g, ''))) return true;
  
  const noiseKeywords = [
    'مربي', 'مربّي', 'الشعبة', 'الشعبه', 'الصف', 'شعبة', 'شعبه', 'مدرسة', 'المدرسة',
    'التقرير', 'تقرير', 'كشف', 'أسماء', 'اسم المربي', 'اسم المربّي', 'اسم المعلم',
    'المدير', 'مدير', 'المعلم', 'معلم', 'الأستاذ', 'أستاذ', 'الاستاذ', 'استاذ',
    'العام الدراسي', 'الفصل', 'فصل', 'ملاحظات', 'تاريخ', 'رقم', 'هاتف', 'جوال', 'تلفون',
    'الاسم', 'اسم الطالب', 'اسم الطالب ثلاثي', 'اسم الطالب رباعي', 'اسم الطالب ثنائي',
    'student name', 'name', 'student', 'class teacher', 'teacher', 'tutor', 'principal',
    'شيت', 'ورقة', 'مجموع', 'النتيجة', 'المعدل', 'معدل', 'المجموع', 'ناجح', 'راسب', 'توقيع'
  ];

  const lower = clean.toLowerCase();
  
  // If the string contains colon, equals sign, or other typical key-value separators (e.g., "مربي الشعبة: محمد")
  if (clean.includes(':') || clean.includes('=') || clean.includes('التطابق') || clean.includes('النتيجه') || clean.includes('/') || clean.includes('\\')) {
    return true;
  }
  
  return noiseKeywords.some(keyword => lower.includes(keyword));
}

interface MessageComposerProps {
  students: Student[];
  templates: MessageTemplate[];
  onSendImmediate: (logs: MessageLog[]) => void;
  onScheduleMessage: (scheduled: Omit<ScheduledMessage, 'id' | 'createdAt' | 'status'>) => void;
  schoolName: string;
  onUpdateSchoolName: (name: string) => void;
  excelImportedIds?: string[] | null;
  onClearImportedIds?: () => void;
  onAddTemplate?: (tmpl: Omit<MessageTemplate, 'id'>) => void;
  /** A scheduled campaign loaded for a manual, user-confirmed send (scheduled campaigns are never auto-sent). */
  prefill?: ComposerPrefill | null;
  onPrefillConsumed?: () => void;
}

export interface ComposerPrefill {
  campaignId: string;
  title: string;
  content: string;
  studentIds: string[];
  phoneTarget: 'primary' | 'secondary' | 'both';
}

export default function MessageComposer({
  students,
  templates,
  onSendImmediate,
  onScheduleMessage,
  schoolName,
  onUpdateSchoolName,
  excelImportedIds,
  onClearImportedIds,
  onAddTemplate,
  prefill,
  onPrefillConsumed
}: MessageComposerProps) {
  // Campaign id of a scheduled campaign loaded via "send now"; attached to the resulting logs
  const activeCampaignIdRef = useRef<string | undefined>(undefined);
  const [activePrefillTitle, setActivePrefillTitle] = useState<string | null>(null);
  const emitLogs = (logs: MessageLog[]) => {
    onSendImmediate(logs);
    activeCampaignIdRef.current = undefined;
    setActivePrefillTitle(null);
  };
  // Target filtering states
  const [targetType, setTargetType] = useState<'all' | 'grade' | 'section' | 'custom'>('all');
  const [selectedGrade, setSelectedGrade] = useState<string>('');
  const [selectedSection, setSelectedSection] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);

  // Composer states
  const [campaignTitle, setCampaignTitle] = useState<string>('حملة تواصل مدرسية');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [messageContent, setMessageContent] = useState<string>('');
  const [showSetupSteps, setShowSetupSteps] = useState<boolean>(false);
  const [isSaveModalOpen, setIsSaveModalOpen] = useState<boolean>(false);
  const [newTemplateTitle, setNewTemplateTitle] = useState<string>('');
  const [saveSuccessNotification, setSaveSuccessNotification] = useState<string | null>(null);

  // Excel matching states for "custom" (مخصص) targeting
  const [excelReport, setExcelReport] = useState<{
    success: boolean;
    totalRows: number;
    matchedCount: number;
    matchedNames: string[];
    unmatchedNames: string[];
    matchedIds: string[];
    suggestions?: Record<string, string[]>;
  } | null>(null);
  const [unmatchedExcelSearch, setUnmatchedExcelSearch] = useState<string>('');

  // 2. EXCEL TARGETS SELECTOR LOGIC FOR CUSTOM TAB
  const handleExcelImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const ab = event.target?.result as ArrayBuffer;
        const data = new Uint8Array(ab);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        
        let parsedNames: string[] = [];

        // 1. Attempt precise cell-by-cell coordinate scanning to satisfy:
        // "يبحث في ملف الاكسل عن العمود الذي يسمى اسم الطالب وياخذ الاسماء الموجوده اسفلها حتى يريد خليه فارغه فيتوقف"
        const rangeStr = worksheet['!ref'];
        if (rangeStr) {
          const range = XLSX.utils.decode_range(rangeStr);
          let foundCol = -1;
          let foundRow = -1;

          // Scan row by row from top to bottom
          for (let r = range.s.r; r <= range.e.r; r++) {
            // Scan columns in this row
            for (let c = range.s.c; c <= range.e.c; c++) {
              const cellAddress = XLSX.utils.encode_cell({ r, c });
              const cellValue = worksheet[cellAddress]?.v;
              if (cellValue) {
                const cellStr = String(cellValue).trim();
                // Match exactly "اسم الطالب" or contains "اسم الطالب"
                if (cellStr === 'اسم الطالب' || cellStr.includes('اسم الطالب')) {
                  foundCol = c;
                  foundRow = r;
                  break;
                }
              }
            }
            if (foundCol !== -1) {
              break;
            }
          }

          // If not found with "اسم الطالب", scan again for general "الاسم" or "الطالب" etc.
          if (foundCol === -1) {
            for (let r = range.s.r; r <= range.e.r; r++) {
              for (let c = range.s.c; c <= range.e.c; c++) {
                const cellAddress = XLSX.utils.encode_cell({ r, c });
                const cellValue = worksheet[cellAddress]?.v;
                if (cellValue) {
                  const cellStr = String(cellValue).trim();
                  const lowerVal = cellStr.toLowerCase();
                  if (
                    (cellStr.includes('الاسم') || cellStr.includes('الطالب') || lowerVal.includes('student name') || lowerVal.includes('student')) &&
                    !lowerVal.includes('مربي') && !lowerVal.includes('مربّي') && !lowerVal.includes('معلم') && !lowerVal.includes('شعبة') && !lowerVal.includes('شعبه')
                  ) {
                    foundCol = c;
                    foundRow = r;
                    break;
                  }
                }
              }
              if (foundCol !== -1) {
                break;
              }
            }
          }

          // If foundCol is found, we extract cells below it in that column, stopping at first empty cell!
          if (foundCol !== -1 && foundRow !== -1) {
            for (let r = foundRow + 1; r <= range.e.r; r++) {
              const cellAddress = XLSX.utils.encode_cell({ r, c: foundCol });
              const cellValue = worksheet[cellAddress]?.v;
              if (cellValue === undefined || cellValue === null) {
                break; // Stop at empty cell!
              }
              const valStr = String(cellValue).trim();
              if (valStr === '' || valStr === 'undefined' || valStr === 'null') {
                break; // Stop at empty cell!
              }
              const cleaned = valStr.replace(/^[-*_.\s]+|[-*_.\s]+$/g, '').trim();
              if (cleaned.length > 1 && !isNoiseRow(cleaned)) {
                parsedNames.push(cleaned);
              }
            }
          }
        }

        // 2. Ultimate Fallback: if the cell-by-cell scanner did not find any names, fall back to the robust json-to-sheet structure
        if (parsedNames.length === 0) {
          const jsonData = XLSX.utils.sheet_to_json<any>(worksheet);
          if (jsonData.length > 0) {
            const firstRowKeys = Object.keys(jsonData[0]);
            let studentNameKey = firstRowKeys.find(key => {
              const cleanKey = key.trim();
              return cleanKey === 'اسم الطالب' || cleanKey.includes('اسم الطالب');
            });

            if (!studentNameKey) {
              studentNameKey = firstRowKeys.find(key => {
                const lowerKey = key.toLowerCase();
                if (lowerKey.includes('مربي') || lowerKey.includes('مربّي') || lowerKey.includes('معلم') || lowerKey.includes('شعبة') || lowerKey.includes('شعبه') || lowerKey.includes('هاتف') || lowerKey.includes('جوال') || lowerKey.includes('صف') || lowerKey.includes('class')) {
                  return false;
                }
                return key.includes('الاسم') || key.includes('الطالب') || lowerKey.includes('student name') || lowerKey.includes('student_name') || lowerKey.includes('student');
              });
            }

            if (!studentNameKey) {
              studentNameKey = firstRowKeys.find(key => {
                const lowerKey = key.toLowerCase();
                if (lowerKey.includes('مربي') || lowerKey.includes('مربّي') || lowerKey.includes('معلم') || lowerKey.includes('شعبة') || lowerKey.includes('شعبه')) {
                  return false;
                }
                return key.includes('الاسم') || lowerKey.includes('name');
              });
            }

            if (!studentNameKey && firstRowKeys.length > 0) {
              studentNameKey = firstRowKeys[0];
            }

            if (studentNameKey) {
              parsedNames = jsonData
                .map(row => {
                  const val = String(row[studentNameKey!]).trim();
                  return val.replace(/^[-*_.\s]+|[-*_.\s]+$/g, '').trim();
                })
                .filter(name => name && name !== 'undefined' && name !== 'null' && name.length > 1)
                .filter(name => !isNoiseRow(name));
            }
          }
        }

        if (parsedNames.length === 0) {
          alert('لا توجد أسماء طلاب صالحة ومقروءة في العمود المكتشف.');
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

        // Set targeting to custom, populate with selected student IDs
        setTargetType('custom');
        setSelectedStudentIds(tempMatchedIds);
        
        setExcelReport({
          success: true,
          totalRows: parsedNames.length,
          matchedCount: tempMatchedIds.length,
          matchedNames: matchedNamesList,
          unmatchedNames: unmatchedNamesList,
          matchedIds: tempMatchedIds,
          suggestions
        });

      } catch (err: any) {
        console.error("Failure while importing Excel sheet:", err);
        alert(`عذراً، فشل استيراد وفحص ملف الإكسل: ${err.message || String(err)}`);
      }
    };

    reader.readAsArrayBuffer(file);
    e.target.value = ''; // empty native cash
  };

  // Manual student-to-excel-name association mapping resolver
  const handleManualMatch = (rawName: string, studentId: string) => {
    if (!excelReport) return;
    const student = students.find(s => s.id === studentId);
    if (!student) return;

    setSelectedStudentIds(prev => {
      if (!prev.includes(studentId)) {
        return [...prev, studentId];
      }
      return prev;
    });

    setExcelReport(prev => {
      if (!prev) return null;
      const nextUnmatched = prev.unmatchedNames.filter(name => name !== rawName);
      const nextMatchedNames = [...prev.matchedNames, `${rawName} ➔ (ربط يدوي: ${student.name} - ${student.grade})`].filter(Boolean);
      const nextMatchedIds = [...prev.matchedIds, studentId];
      return {
        ...prev,
        matchedCount: prev.matchedCount + 1,
        matchedNames: nextMatchedNames,
        unmatchedNames: nextUnmatched,
        matchedIds: nextMatchedIds
      };
    });
  };
  
  // Dynamic load targets matching from Excel tab
  useEffect(() => {
    if (excelImportedIds && excelImportedIds.length > 0) {
      setTargetType('custom');
      setSelectedStudentIds(excelImportedIds);
      if (onClearImportedIds) {
        onClearImportedIds();
      }
    }
  }, [excelImportedIds, onClearImportedIds]);
  
  // Delivery modes: immediate vs scheduled
  const [deliveryMode, setDeliveryMode] = useState<'now' | 'schedule'>('now');
  const [scheduleDate, setScheduleDate] = useState<string>('');
  const [scheduleTime, setScheduleTime] = useState<string>('');

  const [sendMode, setSendMode] = useState<'manual_sequential'>('manual_sequential');
  const whatsappWindowRef = useRef<Window | null>(null);

  // Cloud SMS gateway (Supabase Edge Function). Only the on/off choice is a local UI preference;
  // the SMSGate credentials exist only as server secrets.
  const [useSilentGateway] = useState<boolean>(() => readUseCloudGateway());

  // Automated silent background progress overlay monitor
  const [isSilentBroadcastActive, setIsSilentBroadcastActive] = useState<boolean>(false);
  const [silentProgress, setSilentProgress] = useState<{
    current: number;
    total: number;
    studentName: string;
    stage: 'sending' | 'finished';
    successCount: number;
    failedCount: number;
    statusText: string;
    results: Array<{
      name: string;
      phone: string;
      status: 'success' | 'failed';
      message: string;
      content: string;
    }>;
  }>( {
    current: 0,
    total: 0,
    studentName: '',
    stage: 'sending',
    successCount: 0,
    failedCount: 0,
    statusText: '',
    results: []
  });

  // Manual sequential browser communication broadcast state controllers
  const [isManualSequentialActive, setIsManualSequentialActive] = useState<boolean>(false);
  const [sequentialQueue, setSequentialQueue] = useState<Array<{
    studentId: string;
    studentName: string;
    parentName: string;
    phone: string;
    grade: string;
    section: string;
    content: string;
    status: 'pending' | 'opened' | 'skipped';
  }>>([]);
  const [currentQueueIndex, setCurrentQueueIndex] = useState<number>(0);
  const [broadcastChannel, setBroadcastChannel] = useState<'whatsapp' | 'sms'>('whatsapp');
  const [isAutoPlayPulse, setIsAutoPlayPulse] = useState<boolean>(false);
  const [autoPlayTimerSec, setAutoPlayTimerSec] = useState<number>(4); // default 4 seconds
  const [countdownRemaining, setCountdownRemaining] = useState<number>(4);
  const [accumulatedManualLogs, setAccumulatedManualLogs] = useState<MessageLog[]>([]);

  const handleSaveAsTemplate = () => {
    if (!messageContent.trim()) return;
    setNewTemplateTitle('');
    setIsSaveModalOpen(true);
  };

  const handleConfirmSaveTemplate = () => {
    if (!newTemplateTitle.trim() || !messageContent.trim()) return;
    
    if (onAddTemplate) {
      onAddTemplate({
        title: newTemplateTitle.trim(),
        content: messageContent,
        category: 'general'
      });
    }

    setIsSaveModalOpen(false);
    // Show beautiful success notification
    setSaveSuccessNotification(`تم حفظ قالب الرسالة الجديد "${newTemplateTitle.trim()}" بنجاح!`);
    setTimeout(() => {
      setSaveSuccessNotification(null);
    }, 1500); // Auto dismiss after 1.5 seconds
  };

  // Local helper states
  const [filteredRecipients, setFilteredRecipients] = useState<Student[]>([]);
  const [activeTab, setActiveTab] = useState<'all' | 'grade' | 'section' | 'custom'>('all');

  // Core advanced states
  const [baseMatchingPool, setBaseMatchingPool] = useState<Student[]>([]);
  const [visiblePool, setVisiblePool] = useState<Student[]>([]);
  const [phoneTarget, setPhoneTarget] = useState<'primary' | 'secondary' | 'both'>('primary');
  const formatPhoneForDispatch = (rawPhone: string) => {
    return rawPhone.trim().replace(/\D/g, "");
  };

  // Load template contents when chosen
  useEffect(() => {
    if (selectedTemplateId) {
      const template = templates.find(t => t.id === selectedTemplateId);
      if (template) {
        setMessageContent(template.content);
        setCampaignTitle(`حملة: ${template.title}`);
      }
    }
  }, [selectedTemplateId, templates]);

  // Sync tab with targetType
  const handleTargetTypeChange = (type: 'all' | 'grade' | 'section' | 'custom') => {
    setTargetType(type);
    setSearchTerm('');
    if (type === 'custom') {
      if (excelReport && excelReport.matchedIds) {
        setSelectedStudentIds(excelReport.matchedIds);
      } else {
        setSelectedStudentIds([]);
      }
    }
  };

  // Get distinct Grades and Sections in database
  const distinctGrades = Array.from(new Set(students.map(s => s.grade))).sort();
  const distinctSections = Array.from(new Set(students.map(s => s.section))).sort();

  // Set default grade/section if empty
  useEffect(() => {
    if (distinctGrades.length > 0 && !selectedGrade) {
      setSelectedGrade(distinctGrades[0]);
    }
  }, [distinctGrades, selectedGrade]);

  useEffect(() => {
    if (distinctSections.length > 0 && !selectedSection) {
      setSelectedSection(distinctSections[0]);
    }
  }, [distinctSections, selectedSection]);

  // Compute base matching pool according to filters
  useEffect(() => {
    let pool = [...students];

    if (targetType === 'grade') {
      if (selectedGrade) {
        pool = pool.filter(s => s.grade === selectedGrade);
      }
    } else if (targetType === 'section') {
      if (selectedGrade) {
        pool = pool.filter(s => s.grade === selectedGrade);
      }
      if (selectedSection) {
        pool = pool.filter(s => s.section === selectedSection);
      }
    } else if (targetType === 'custom') {
      // In custom, display all students to let them manually check/uncheck
      pool = [...students];
    }

    setBaseMatchingPool(pool);
    // Never auto-select the whole pool: selecting everyone must be an explicit action
    // ("تحديد جميع النتائج"). When the filter changes, keep only selections still inside the pool.
    if (targetType !== 'custom') {
      const poolIds = new Set(pool.map(s => s.id));
      setSelectedStudentIds(prev => prev.filter(id => poolIds.has(id)));
    }
  }, [targetType, selectedGrade, selectedSection, students]);

  // Handle live search filter on the visible pool
  useEffect(() => {
    let result = [...baseMatchingPool];

    if (searchTerm.trim()) {
      const query = searchTerm.toLowerCase();
      result = result.filter(s => 
        s.name.toLowerCase().includes(query) || 
        (s.nameEn && s.nameEn.toLowerCase().includes(query)) ||
        s.parentName.toLowerCase().includes(query) || 
        s.phone.includes(query) ||
        (s.phone2 && s.phone2.includes(query))
      );
    }

    // Sort selected students to the top of the list in real-time
    result.sort((a, b) => {
      const aSel = selectedStudentIds.includes(a.id) ? 1 : 0;
      const bSel = selectedStudentIds.includes(b.id) ? 1 : 0;
      if (aSel !== bSel) {
        return bSel - aSel; // Bubble selected to the top (1 before 0)
      }
      return a.name.localeCompare(b.name, 'ar'); // tie break with name alphabetical
    });

    setVisiblePool(result);
  }, [baseMatchingPool, searchTerm, selectedStudentIds]);

  // Final recipients are students within the baseMatchingPool who are currently selected
  useEffect(() => {
    const finalRecipients = baseMatchingPool.filter(s => selectedStudentIds.includes(s.id));
    setFilteredRecipients(finalRecipients);
  }, [baseMatchingPool, selectedStudentIds]);

  // Recipients that will be excluded because they lack a valid mobile number (visible warning)
  const phoneExclusions = useMemo(
    () => buildDispatchItems(filteredRecipients, phoneTarget, '', () => '').excluded,
    [filteredRecipients, phoneTarget]
  );

  // Evaluate message template placeholders for a student (shared, tested renderer)
  const evaluatePlaceholders = (templateStr: string, student: Student): string =>
    renderTemplate(templateStr, student);

  // Real length of the message as rendered for the first selected recipient (Arabic: 70 / 67 per part)
  const lengthInfo = segmentInfo(
    filteredRecipients[0] ? evaluatePlaceholders(messageContent, filteredRecipients[0]) : messageContent
  );

  // Recipients missing Moodle values that the template needs
  const moodleMissing = useMemo(
    () => filteredRecipients.filter(st => missingMoodleFields(messageContent, st).length > 0),
    [filteredRecipients, messageContent]
  );

  // Pre-send confirmation dialog
  const [confirmOpen, setConfirmOpen] = useState(false);
  const confirmedRef = useRef(false);
  const confirmData = useMemo(() => {
    if (!confirmOpen) return null;
    const { items, excluded } = buildDispatchItems(filteredRecipients, phoneTarget, messageContent, evaluatePlaceholders);
    return { items, excluded };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmOpen, filteredRecipients, phoneTarget, messageContent]);

  // 3. AUTO ADVANCE COUNTDOWN FOR SEQUENTIAL SENDER
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    
    if (isManualSequentialActive && isAutoPlayPulse && currentQueueIndex < sequentialQueue.length) {
      interval = setInterval(() => {
        setCountdownRemaining(prev => {
          if (prev <= 1) {
            // Auto-launch current and auto-advance for autoplay mode
            triggerLaunchAtIndex(currentQueueIndex, false);
            return autoPlayTimerSec;
          }
          return prev - 1;
        });
      }, 1000);
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isManualSequentialActive, isAutoPlayPulse, currentQueueIndex, sequentialQueue, autoPlayTimerSec]);

  // Execute actual launch command at specific index
  const triggerLaunchAtIndex = (index: number, isInitialGesture: boolean = false) => {
    if (index >= sequentialQueue.length) return;
    
    const item = sequentialQueue[index];
    
    let phoneNum = formatPhoneForDispatch(item.phone);
    
    let url = "";
    if (broadcastChannel === 'whatsapp') {
      url = `https://api.whatsapp.com/send?phone=${phoneNum}&text=${encodeURIComponent(item.content)}`;
      
      try {
        if (isInitialGesture) {
          whatsappWindowRef.current = window.open(url, 'whatsapp_broadcast_tab');
        } else {
          if (whatsappWindowRef.current && !whatsappWindowRef.current.closed) {
            whatsappWindowRef.current.location.href = url;
            try {
              whatsappWindowRef.current.focus();
            } catch (e1) {}
          } else {
            whatsappWindowRef.current = window.open(url, 'whatsapp_broadcast_tab');
          }
        }
      } catch (err) {
        console.error("Tab redirection failed:", err);
        whatsappWindowRef.current = window.open(url, 'whatsapp_broadcast_tab');
      }
    } else {
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const separator = isIOS ? '&' : '?';
      url = `sms:${phoneNum}${separator}body=${encodeURIComponent(item.content)}`;
      window.location.href = url;
    }

    setSequentialQueue(prev => {
      const copy = [...prev];
      if (copy[index]) {
        copy[index].status = 'opened';
      }
      return copy;
    });

    // Opening the messaging app is NOT a delivery confirmation: record it as 'sent' (manual channel)
    const logId = newLogId();
    const newLog: MessageLog = {
      id: logId,
      studentId: item.studentId,
      studentName: item.studentName,
      parentName: item.parentName,
      phone: item.phone,
      grade: item.grade,
      section: item.section,
      messageContent: item.logContent ?? item.content, // never store the Moodle password in logs
      sentTime: new Date().toISOString(),
      status: 'sent',
      channel: 'manual',
      campaignId: activeCampaignIdRef.current,
    };
    
    setAccumulatedManualLogs(prev => [...prev, newLog]);
    
    // Auto advance index
    setCurrentQueueIndex(index + 1);
    setCountdownRemaining(autoPlayTimerSec);
  };

  const skipLaunchAtIndex = (index: number) => {
    if (index >= sequentialQueue.length) return;
    
    setSequentialQueue(prev => {
      const copy = [...prev];
      if (copy[index]) {
        copy[index].status = 'skipped';
      }
      return copy;
    });

    setCurrentQueueIndex(index + 1);
    setCountdownRemaining(autoPlayTimerSec);
  };

  const handleInsertPlaceholder = (placeholder: string) => {
    const textarea = document.getElementById('message-body-composer') as HTMLTextAreaElement;
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const currentVal = textarea.value;
      const newVal = currentVal.substring(0, start) + ' ' + placeholder + ' ' + currentVal.substring(end);
      
      setMessageContent(newVal);
      
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(start + placeholder.length + 2, start + placeholder.length + 2);
      }, 10);
    } else {
      setMessageContent(prev => prev + ' ' + placeholder + ' ');
    }
  };

  const handleStudentSelectToggle = (id: string) => {
    setSelectedStudentIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const selectAllFilteredStudents = () => {
    const visibleIds = visiblePool.map(s => s.id);
    setSelectedStudentIds(prev => {
      const allSelected = visibleIds.every(id => prev.includes(id));
      if (allSelected) {
        return prev.filter(id => !visibleIds.includes(id));
      } else {
        return Array.from(new Set([...prev, ...visibleIds]));
      }
    });
  };

  // Load a scheduled campaign for a manual, confirmed send
  useEffect(() => {
    if (!prefill) return;
    activeCampaignIdRef.current = prefill.campaignId;
    setActivePrefillTitle(prefill.title);
    setCampaignTitle(prefill.title);
    setMessageContent(prefill.content);
    setSelectedTemplateId('');
    setDeliveryMode('now');
    setPhoneTarget(prefill.phoneTarget);
    setTargetType('custom');
    setSearchTerm('');
    setSelectedStudentIds(prefill.studentIds);
    onPrefillConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  // Dispatch campaign (either immediate simulation/real or schedule creation)
  const handleDispatchCampaign = (e: React.FormEvent) => {
    e.preventDefault();
    if (filteredRecipients.length === 0) return alert('الرجاء تحديد مستلم واحد على الأقل أولاً.');
    if (!messageContent.trim()) return alert('الرجاء كتابة محتوى الرسالة.');
    if (deliveryMode === 'schedule' && (!scheduleDate || !scheduleTime)) {
      return alert('الرجاء تحديد تاريخ ووقت جدولة الرسالة بشكل صحيح.');
    }
    // Always show the confirmation dialog first (count, SMS parts, cost, real preview)
    if (!confirmedRef.current) {
      setConfirmOpen(true);
      return;
    }
    confirmedRef.current = false;

    if (deliveryMode === 'schedule') {
      if (!scheduleDate || !scheduleTime) {
        return alert('الرجاء تحديد تاريخ ووقت جدولة الرسالة بشكل صحيح.');
      }
      
      const fullScheduledTime = `${scheduleDate}T${scheduleTime}:00`;
      
      onScheduleMessage({
        title: campaignTitle,
        contentTemplate: messageContent,
        targetType,
        targetGrade: targetType === 'grade' || targetType === 'section' ? selectedGrade : undefined,
        targetSection: targetType === 'section' ? selectedSection : undefined,
        targetStudentIds: filteredRecipients.map(s => s.id),
        phoneTarget: phoneTarget,
        scheduledTime: fullScheduledTime,
        totalRecipients: phoneTarget === 'both' ? filteredRecipients.length * 2 : filteredRecipients.length
      });

      // Reset
      setMessageContent('');
      setSelectedTemplateId('');
      setDeliveryMode('now');
      setCampaignTitle('حملة تواصل مدرسية');
    } else {
      // Students without a valid mobile number are excluded (never sent to a fallback number).
      // (they are listed in the visible warning box above the send button)
      const { items: itemsToDispatch } = buildDispatchItems(
        filteredRecipients,
        phoneTarget,
        messageContent,
        evaluatePlaceholders
      );

      if (itemsToDispatch.length === 0) {
        return alert('لا يوجد أي رقم جوال صالح بين المستلمين المحددين. راجع أرقام الطلاب أولاً.');
      }

      if (useSilentGateway) {
        // Cloud gateway: batches go to the authenticated Edge Function (max 50 recipients per call).
        setSilentProgress({
          current: 0,
          total: itemsToDispatch.length,
          studentName: itemsToDispatch[0]?.studentName || '',
          stage: 'sending',
          successCount: 0,
          failedCount: 0,
          statusText: 'جاري إرسال الرسائل عبر خادم الإرسال الآمن...',
          results: []
        });
        setIsSilentBroadcastActive(true);

        (async () => {
          const keyed = itemsToDispatch.map((item, idx) => ({ key: `m${idx}`, item }));
          const byKey = new Map(keyed.map(k => [k.key, k.item]));
          const toRow = (r: ProxyItemResult) => {
            const item = byKey.get(r.id)!;
            return {
              name: item.studentName,
              phone: item.phone,
              status: r.ok ? 'success' as const : 'failed' as const,
              message: r.ok ? 'سُلّمت للبوابة (لا يوجد تأكيد استلام من الهاتف بعد)' : proxyErrorMessage(r.error),
              content: item.logContent ?? item.content
            };
          };
          const { results, fatalError } = await sendViaProxy(
            invokeSmsFunction,
            keyed.map(k => ({ id: k.key, phone: k.item.phone, text: k.item.content })),
            partial => {
              const rows = partial.map(toRow);
              const ok = partial.filter(r => r.ok).length;
              const last = partial[partial.length - 1];
              setSilentProgress(prev => ({
                ...prev,
                current: partial.length,
                studentName: last ? byKey.get(last.id)?.studentName || '' : prev.studentName,
                successCount: ok,
                failedCount: partial.length - ok,
                results: rows
              }));
            }
          );

          const now = new Date().toISOString();
          const generatedLogs: MessageLog[] = results.map(r => {
            const item = byKey.get(r.id)!;
            return {
              id: newLogId(),
              studentId: item.studentId,
              studentName: item.studentName,
              parentName: item.parentName,
              phone: item.phone,
              grade: item.grade,
              section: item.section,
              messageContent: item.logContent ?? item.content, // never store the Moodle password in logs
              sentTime: now,
              status: statusAfterGatewayCall(r.ok),
              failureReason: r.ok ? undefined : proxyErrorMessage(r.error),
              channel: 'gateway' as const,
              campaignId: activeCampaignIdRef.current,
            };
          });

          setSilentProgress(prev => ({
            ...prev,
            stage: 'finished',
            statusText: fatalError
              ? `توقف الإرسال: ${proxyErrorMessage(fatalError)}`
              : 'تم الانتهاء من معالجة جميع الرسائل عبر خادم الإرسال.'
          }));

          // A request-level failure (e.g. gateway not configured) sent nothing: do not record fake history.
          if (fatalError === 'sms_gateway_not_configured' || fatalError === 'unauthorized' || fatalError === 'not_allowed') {
            activeCampaignIdRef.current = undefined;
            return;
          }
          emitLogs(generatedLogs);
        })();
      } else {
        // Standard Manual clicks with Pop-ups (Free sequential browser mode)
        setSequentialQueue(itemsToDispatch);
        setCurrentQueueIndex(0);
        setCountdownRemaining(autoPlayTimerSec);
        setIsAutoPlayPulse(false); 
        setAccumulatedManualLogs([]);
        setIsManualSequentialActive(true);
      }
    }
  };


  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6" id="message-composer-workflow">
      
      {/* Col 1: Target Selector Dashboard (Left 5 cols) */}
      <div className="lg:col-span-12 xl:col-span-5 space-y-6 flex flex-col justify-between">
        <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-xs flex-1 flex flex-col">
          <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-4">
            <Users className="w-5 h-5 text-emerald-600" />
            تحديد المستلمين والطلاب المستهدفين
          </h3>

          {/* Segment selection buttons */}
          <div className="grid grid-cols-4 gap-1 p-1 bg-slate-100 rounded-xl mb-4" id="target-types-segmented-control">
            {(['all', 'grade', 'section', 'custom'] as const).map(type => {
              const labels = { all: 'الجميع', grade: 'صف محدد', section: 'شعبة', custom: 'استيراد Excel 📊' };
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => handleTargetTypeChange(type)}
                  className={`py-2 text-xs font-semibold rounded-lg transition duration-150 cursor-pointer ${
                    targetType === type
                      ? 'bg-white text-emerald-700 shadow-xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {labels[type]}
                </button>
              );
            })}
          </div>

          {/* Detailed filter inputs based on segment choice */}
          <div className="space-y-4 mb-4" id="filters-form-fields">
            {targetType === 'custom' && (
              <div className="bg-gradient-to-br from-indigo-50/45 to-slate-50/60 border border-dashed border-indigo-200/80 rounded-xl p-3.5 mb-2 space-y-2 animate-fade-in text-right">
                <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5 font-sans">
                  <FileText className="w-4 h-4 text-indigo-600" />
                  تحديد المستقبلين عبر استيراد ملف Excel 📊
                </span>
                <p className="text-[10.5px] text-slate-500 leading-relaxed text-right font-medium">
                  ارفع ملف Excel لأسماء طلاب محددين لمطابقتها فورياً واختيارها من السجلات وتصدير التقارير.
                </p>
                
                <div className="flex items-center gap-3">
                  {!excelReport ? (
                    <label className="flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-1.5 px-3.5 rounded-lg text-xs transition cursor-pointer select-none shadow-xs font-sans">
                      <FileText className="w-3.5 h-3.5" />
                      اختر ملف Excel (.xlsx)
                      <input
                        type="file"
                        accept=".xlsx, .xls, .xlsm, .csv"
                        onChange={handleExcelImport}
                        className="hidden"
                      />
                    </label>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setExcelReport(null);
                        setSelectedStudentIds([]);
                      }}
                      className="text-[10px] font-bold text-rose-600 hover:text-rose-700 hover:underline transition cursor-pointer flex items-center gap-1.5 font-sans"
                    >
                      <X className="w-3.5 h-3.5 text-rose-600" />
                      إلغاء الاستيراد والعودة للاستهداف العادي
                    </button>
                  )}
                </div>

                {/* Excel matched report feedback badge log */}
                {excelReport && (
                  <div className="text-[11px] leading-relaxed p-3 rounded-xl border border-indigo-150 bg-indigo-50/20 space-y-3.5 animate-fade-in text-right">
                    <div className="font-bold text-indigo-900 flex items-center justify-between border-b border-indigo-100 pb-2">
                      <span className="flex items-center gap-1.5 font-bold text-xs font-sans">
                        <CheckSquare className="w-4 h-4 text-emerald-600" />
                        <span>التقرير النهائي المذهل لـ مطابقة الطلاب:</span>
                      </span>
                      <span className="font-mono text-[10px] bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded-md font-bold">
                        المطابقة: {Math.round((excelReport.matchedCount / excelReport.totalRows) * 100) || 0}%
                      </span>
                    </div>

                    {/* Scanned metrics bento box layout */}
                    <div className="grid grid-cols-3 gap-1.5 text-center text-xs">
                      <div className="bg-white border border-slate-200/80 rounded-lg p-1.5 font-bold shadow-3xs">
                        <div className="text-slate-400 text-[8.5px] font-bold">إجمالي المرفوع</div>
                        <div className="text-xs font-black text-slate-700 font-mono mt-0.5">{excelReport.totalRows}</div>
                      </div>
                      <div className="bg-emerald-50/55 border border-emerald-100 rounded-lg p-1.5 font-bold shadow-3xs">
                        <div className="text-emerald-700 text-[8.5px] font-bold">مطابق ومحدد</div>
                        <div className="text-xs font-black text-emerald-600 font-mono mt-0.5">{excelReport.matchedCount}</div>
                      </div>
                      <div className="bg-rose-50/55 border border-rose-100 rounded-lg p-1.5 font-bold shadow-3xs">
                        <div className="text-rose-700 text-[8.5px] font-bold">غير مطابق ⚠️</div>
                        <div className="text-xs font-black text-rose-600 font-mono mt-0.5">{excelReport.unmatchedNames.length}</div>
                      </div>
                    </div>

                    <p className="text-slate-600 text-[10px] leading-relaxed font-sans">
                      تم العثور وتحديد <span className="font-bold text-emerald-700">{excelReport.matchedCount}</span> طالباً يدوياً أو آلياً. تم فرزهم في أعلى السجلات مع إظهار علامة الاختيار 🟢.
                    </p>

                    {/* High quality mismatch report inspector log */}
                    {excelReport.unmatchedNames.length > 0 && (
                      <div className="text-[11px] bg-white rounded-xl p-2.5 border border-rose-150 text-right space-y-2 shadow-3xs">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-1 flex-wrap gap-1.5">
                          <span className="font-bold text-rose-800 flex items-center gap-1 text-[10.5px] font-sans">
                            <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
                            أسماء مفقودة لم تطابق ({excelReport.unmatchedNames.length}):
                          </span>
                          
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                const listStr = excelReport.unmatchedNames.join('\n');
                                navigator.clipboard.writeText(listStr);
                                alert('✓ تم نسخ الأسماء غير المطابقة بالكامل للحافظة.');
                              }}
                              className="text-[9px] bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 px-2 py-0.5 rounded-md font-bold transition flex items-center gap-1 cursor-pointer font-sans"
                            >
                              📋 نسخ الحافظة
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (!excelReport || excelReport.unmatchedNames.length === 0) return;
                                const rowData = excelReport.unmatchedNames.map((name, i) => ({
                                  'الرقم التسلسلي': i + 1,
                                  'الاسم مفقود وغير مطابق بالسجلات': name
                                }));
                                const ws = XLSX.utils.json_to_sheet(rowData);
                                const wb = XLSX.utils.book_new();
                                XLSX.utils.book_append_sheet(wb, ws, "أسماء غير مطابقة");
                                XLSX.writeFile(wb, `طلاب_غير_مطابقين_${new Date().toISOString().split('T')[0]}.xlsx`);
                              }}
                              className="text-[9px] bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 px-2 py-0.5 rounded-md font-bold transition flex items-center gap-1 cursor-pointer font-sans"
                            >
                              📥 تصدير Excel
                            </button>
                          </div>
                        </div>

                        <p className="text-[9px] text-rose-950 leading-relaxed bg-rose-50/30 p-1.5 rounded-lg border border-rose-100 font-sans">
                          بوسعك كتابة الاسم الصحيح ومطابقته فورياً لتحديده وتثبيته بالرسوم والتقارير:
                        </p>

                        <div>
                          <input
                            type="text"
                            placeholder="صفي الأسماء غير المطابقة..."
                            value={unmatchedExcelSearch}
                            onChange={(e) => setUnmatchedExcelSearch(e.target.value)}
                            className="w-full px-2 py-1 text-[10px] border border-slate-200 rounded-lg outline-hidden focus:border-rose-300 bg-slate-50/50 font-sans"
                          />
                        </div>

                        <div className="max-h-[140px] overflow-y-auto border border-slate-100 rounded-lg divide-y divide-slate-100 bg-rose-50/5 p-1 space-y-1">
                          {excelReport.unmatchedNames
                            .filter(name => name.toLowerCase().includes(unmatchedExcelSearch.toLowerCase()))
                            .map((rawName, index) => (
                              <div key={index} className="p-1.5 text-[10px] font-mono text-rose-950 flex flex-col justify-between gap-1 hover:bg-rose-50/40 rounded-md">
                                <span className="text-slate-700 font-sans font-semibold truncate" title={rawName}>{rawName}</span>
                                {(excelReport.suggestions?.[rawName] || []).length > 0 && (
                                  <span className="text-amber-700 font-sans text-[9.5px] font-bold">⚠️ تطابق غير مؤكد ({excelReport.suggestions![rawName].length} مرشح) — اختر يدوياً</span>
                                )}
                                
                                <select
                                  onChange={(e) => {
                                    if (e.target.value) {
                                      handleManualMatch(rawName, e.target.value);
                                      e.target.value = ''; // reset select
                                    }
                                  }}
                                  className="px-2 py-0.5 bg-white border border-rose-200 focus:border-indigo-400 rounded-md text-[9.5px] text-slate-600 outline-hidden font-sans cursor-pointer"
                                >
                                  <option value="">⚙️ ربط يدوي مع السجلات...</option>
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
                                    .map(student => (
                                      <option key={student.id} value={student.id}>
                                        {student.name} ({student.grade})
                                      </option>
                                    ))
                                  }
                                </select>
                              </div>
                            ))
                          }
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {(targetType === 'grade' || targetType === 'section') && (
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">الصف الدراسي المستهدف:</label>
                <select
                  value={selectedGrade}
                  onChange={e => setSelectedGrade(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 focus:border-emerald-500 rounded-xl text-xs transition outline-hidden"
                >
                  {distinctGrades.map(g => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
              </div>
            )}

            {targetType === 'section' && (
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">الشعبة المستهدفة:</label>
                <select
                  value={selectedSection}
                  onChange={e => setSelectedSection(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 focus:border-emerald-500 rounded-xl text-xs transition outline-hidden"
                >
                  {distinctSections.map(s => (
                    <option key={s} value={s}>شعبة {s}</option>
                  ))}
                </select>
              </div>
            )}
            {/* Selection student list lookup - Always show search tool */}
            <div className="relative mt-2">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
              <input
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="ابحث بالاسم أو الإنجليزي أو هاتف ولي الأمر..."
                className="w-full pr-9 pl-3 py-2 bg-slate-50 border border-slate-200 focus:border-emerald-500 rounded-xl text-xs transition outline-hidden"
              />
            </div>
          </div>

          {/* Recipients summary header & list */}
          <div className="flex-1 flex flex-col min-h-[180px]">
            <div className="flex items-center justify-between text-xs text-slate-500 mb-2 font-semibold">
              <span className="flex items-center gap-1">
                <span>تحديد الطلاب من القائمة:</span>
                <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md font-mono font-bold">
                  ({filteredRecipients.length} من {baseMatchingPool.length}) محددين
                </span>
              </span>
              
              <button
                type="button"
                onClick={selectAllFilteredStudents}
                className="text-emerald-600 hover:text-emerald-700 font-bold flex items-center gap-1 cursor-pointer"
              >
                {visiblePool.length > 0 && visiblePool.every(s => selectedStudentIds.includes(s.id)) ? 'إلغاء تحديد الكل' : `تحديد جميع النتائج (${visiblePool.length})`}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto max-h-[220px] lg:max-h-[340px] border border-slate-100 rounded-xl divide-y divide-slate-50 bg-slate-50/20" id="recipient-pool-selector">
              {visiblePool.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center p-6 text-center text-slate-400 text-xs">
                  <AlertCircle className="w-5 h-5 text-slate-300 mb-1" />
                  لا يوجد طلاب يطابقون خيارات البحث والفلترة المحددة
                </div>
              ) : (
                visiblePool.map(student => {
                  const isChecked = selectedStudentIds.includes(student.id);
                  return (
                    <div
                      key={student.id}
                      onClick={() => handleStudentSelectToggle(student.id)}
                      className={`p-3 text-right flex items-center justify-between gap-3 transition cursor-pointer select-none text-xs hover:bg-slate-50/70 ${
                        isChecked ? 'bg-emerald-50/20 hover:bg-emerald-50/40' : ''
                      }`}
                    >
                      <div className="space-y-0.5 max-w-[85%]">
                        <div className="font-bold text-slate-800 flex items-center gap-1.5 flex-wrap">
                          <span>{student.name}</span>
                          {student.nameEn && <span className="text-[10px] text-slate-400 font-normal">({student.nameEn})</span>}
                          {excelReport && isChecked && (
                            <span className="inline-flex items-center gap-0.5 text-[9px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded-full font-bold select-none">
                              ✓ مستورد Excel
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 flex flex-wrap items-center gap-1.5 font-mono">
                          <span className="bg-slate-150 text-slate-600 px-1 py-0.2 rounded-sm">{student.grade} - {student.section}</span>
                          <span>•</span>
                          <span className="text-emerald-600 font-semibold" title="الرقم الرئيسي">رقم1: {student.phone}</span>
                          {student.phone2 && (
                            <>
                              <span>•</span>
                              <span className="text-indigo-600 font-semibold" title="الرقم البديل">رقم2: {student.phone2}</span>
                            </>
                          )}
                        </div>
                        {student.notes && (
                          <div className="text-[10px] text-amber-700 bg-amber-50/40 px-1.5 py-0.5 rounded-sm line-clamp-1 block mt-0.5">
                            ملاحظة/مستحقات: {student.notes}
                          </div>
                        )}
                      </div>

                      <div className="relative flex items-center justify-center">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {}} // Done via row click
                          className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 h-4 w-4 pointer-events-none"
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Col 2: Action Message Writer (Right 7 cols) */}
      <form onSubmit={handleDispatchCampaign} className="lg:col-span-12 xl:col-span-7 bg-white rounded-2xl border border-slate-100 p-5 shadow-xs flex flex-col justify-between space-y-4" id="campaign-composer-form">
        {activePrefillTitle && (
          <div className="p-3 rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-800 text-xs" id="prefill-campaign-banner">
            تم تحميل الحملة المجدولة «{activePrefillTitle}». الحملات المجدولة لا تُرسل تلقائياً — راجع المستلمين والنص ثم اضغط إرسال وأكّد.
          </div>
        )}
        <ConfirmSendDialog
          open={confirmOpen && !!confirmData}
          mode={deliveryMode === 'schedule' ? 'schedule' : 'now'}
          studentCount={filteredRecipients.length}
          contents={confirmData ? confirmData.items.map(i => i.content) : []}
          excludedCount={confirmData ? confirmData.excluded.length : 0}
          sampleText={confirmData && confirmData.items[0] ? confirmData.items[0].content : ''}
          sampleMaskedText={confirmData && confirmData.items[0] ? confirmData.items[0].logContent : undefined}
          missingMoodleCount={confirmData ? moodleMissing.length : 0}
          sampleRecipientLabel={confirmData && confirmData.items[0] ? confirmData.items[0].studentName : undefined}
          scheduledLabel={deliveryMode === 'schedule' ? `${scheduleDate} ${scheduleTime}` : undefined}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => {
            setConfirmOpen(false);
            confirmedRef.current = true;
            handleDispatchCampaign({ preventDefault() {} } as React.FormEvent);
          }}
        />
        <div>
          <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-3">
            <FileText className="w-5 h-5 text-indigo-600" />
            صياغة وإعداد الحملة
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">اسم الحملة الداخلي (للتقارير):</label>
              <input
                type="text"
                value={campaignTitle}
                onChange={e => setCampaignTitle(e.target.value)}
                placeholder="مثال: إشعار درجات امتحانات الفصل الثاني"
                className="w-full px-3.5 py-1.5 border border-slate-200 focus:border-indigo-500 rounded-lg text-xs outline-hidden"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">استيراد من القوالب المحفوظة:</label>
              <select
                value={selectedTemplateId}
                onChange={e => setSelectedTemplateId(e.target.value)}
                className="w-full px-3.5 py-1.5 border border-slate-200 focus:border-indigo-500 rounded-lg text-xs outline-hidden"
              >
                <option value="">-- صياغة مباشرة (بدون قالب) --</option>
                {templates.map(t => (
                  <option key={t.id} value={t.id}>{t.title} [{t.category}]</option>
                ))}
              </select>
            </div>
          </div>

          {/* Dynamic Placeholders Tag Bar */}
          <div className="mb-2">
            <div className="flex items-center justify-between text-xs font-bold text-slate-600 mb-1">
              <span>محتوى نص رسالة الإرسال:</span>
              <span className="text-[10px] text-slate-400 font-normal">استعن بالمتغيرات لإضفاء ملمس مخصص</span>
            </div>
            <div className="flex flex-wrap items-center gap-1 bg-slate-100/55 p-2 rounded-lg border border-slate-150/50 mb-1.5">
              {PLACEHOLDERS.map(ph => (
                <button
                  key={ph.tag}
                  type="button"
                  onClick={() => handleInsertPlaceholder(ph.tag)}
                  className="px-2 py-1 bg-white hover:bg-indigo-50 hover:text-indigo-700 text-slate-600 text-[10px] rounded-md border border-slate-200 hover:border-indigo-200 cursor-pointer shadow-2xs font-semibold"
                >
                  +{ph.label}
                </button>
              ))}
            </div>

            <textarea
              id="message-body-composer"
              value={messageContent}
              onChange={e => setMessageContent(e.target.value)}
              placeholder={`اكتب صياغة الرسالة هنا... تفخر ${schoolName} بنجاح ابنكم {{اسم_الطالب}} من الصف {{الصف}} وحصوله على...`}
              rows={4}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 focus:border-indigo-500 rounded-xl text-xs transition outline-hidden leading-relaxed"
              required
            />
            
            {/* Live SMS Characters Counter Box */}
            <div className="flex flex-wrap items-center justify-between gap-2 mt-2 bg-slate-50 border border-slate-150 p-2 rounded-lg text-xs text-slate-600 font-sans">
              <div className="flex items-center gap-3">
                <span>الطول{filteredRecipients[0] ? ' (لأول مستلم محدد)' : ''}: <strong className="text-slate-800 font-mono font-bold">{lengthInfo.units}</strong> حرفًا</span>
                <span className="text-slate-300">|</span>
                <span>الحجم الفعلي: <span className="bg-indigo-50 text-indigo-700 font-bold px-1.5 py-0.5 rounded-sm outline-1 outline-indigo-200">
                  {lengthInfo.segments <= 1 ? '1 جزء SMS' : `${lengthInfo.segments} أجزاء SMS`}
                </span></span>
              </div>

              <div className="text-[10px] text-slate-500">
                {lengthInfo.segments <= 1 ? (
                  <span>متبقي <strong className="text-emerald-600 font-mono font-bold">{lengthInfo.remainingInPart}</strong> حرف للاحتفاظ بجزء واحد ({lengthInfo.singleLimit} حرفًا)</span>
                ) : (
                  <span>متبقي <strong className="text-indigo-600 font-mono font-bold">{lengthInfo.remainingInPart}</strong> حرف للجزء القادم ({lengthInfo.perPart} لكل جزء)</span>
                )}
              </div>
            </div>

            {/* Save Current Content as Template Button */}
            <div className="flex justify-end mt-2">
              <button
                type="button"
                onClick={handleSaveAsTemplate}
                disabled={!messageContent.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed text-indigo-700 font-bold text-xs rounded-xl border border-indigo-200/40 transition cursor-pointer"
              >
                <span>💾 إضافة الرسالة الحالية إلى القوالب</span>
              </button>
            </div>
          </div>

          {/* Delivery trigger / scheduling selection */}
          <div className="border-t border-slate-100 pt-3 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1.5 text-xs font-bold text-slate-700 cursor-pointer select-none">
                <input
                  type="radio"
                  name="deliveryMode"
                  checked={deliveryMode === 'now'}
                  onChange={() => setDeliveryMode('now')}
                  className="rounded-full border-slate-300 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
                />
                إرسال فوري الآن
              </label>

              <label className="flex items-center gap-1.5 text-xs font-bold text-slate-700 cursor-pointer select-none">
                <input
                  type="radio"
                  name="deliveryMode"
                  checked={deliveryMode === 'schedule'}
                  onChange={() => setDeliveryMode('schedule')}
                  className="rounded-full border-slate-300 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
                />
                جدولة الإرسال لوقت لاحق
              </label>
            </div>

            {deliveryMode === 'schedule' && (
              <div className="flex items-center gap-2" id="scheduler-date-time-inputs">
                <input
                  type="date"
                  value={scheduleDate}
                  onChange={e => setScheduleDate(e.target.value)}
                  className="px-2.5 py-1 border border-slate-300 rounded-lg text-xs text-slate-600 focus:border-indigo-500 bg-white"
                  required
                />
                <input
                  type="time"
                  value={scheduleTime}
                  onChange={e => setScheduleTime(e.target.value)}
                  className="px-2.5 py-1 border border-slate-300 rounded-lg text-xs text-slate-600 focus:border-indigo-500 bg-white"
                  required
                />
              </div>
            )}
          </div>
        </div>

        {/* Moodle placeholders used but some recipients have no value */}
        {moodleMissing.length > 0 && (
          <div className="p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-xs space-y-1" id="missing-moodle-warning">
            <div className="font-bold">
              ⚠️ القالب يستخدم بيانات مودل لكن ({moodleMissing.length}) طالب بدون اسم مستخدم/كلمة مرور — سيظهر المكان فارغاً في رسائلهم:
            </div>
            <div className="max-h-20 overflow-y-auto">{moodleMissing.slice(0, 20).map(st => st.name).join('، ')}{moodleMissing.length > 20 ? ' ...' : ''}</div>
          </div>
        )}

        {/* Phone validity warning: students without a valid mobile are excluded from sending */}
        {phoneExclusions.length > 0 && (
          <div className="p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-xs space-y-1" id="excluded-phones-warning">
            <div className="font-bold">
              ⚠️ سيتم استبعاد ({phoneExclusions.length}) رقم من الإرسال لعدم وجود رقم جوال صالح:
            </div>
            <ul className="list-disc pr-5 max-h-32 overflow-y-auto">
              {phoneExclusions.slice(0, 50).map((ex, i) => (
                <li key={`${ex.studentId}-${ex.which}-${i}`}>
                  {ex.studentName} — {ex.which === 'primary' ? 'الرقم الرئيسي' : 'الرقم البديل'}: {PHONE_PROBLEM_LABELS[ex.problem]}
                  {ex.rawPhone ? <span dir="ltr" className="font-mono"> ({ex.rawPhone})</span> : null}
                </li>
              ))}
              {phoneExclusions.length > 50 && <li>... و{phoneExclusions.length - 50} آخرين</li>}
            </ul>
            <div>صحّح الأرقام من شاشة الطلاب أو ملف الإكسل ثم أعد المحاولة.</div>
          </div>
        )}

        {/* Action Button Trigger */}
        <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-4">
          <div className="text-[11px] text-slate-400">
            {deliveryMode === 'now' ? (
              <span>سيتم بث {phoneTarget === 'both' ? filteredRecipients.length * 2 : filteredRecipients.length} إشعار متتابع ومجاني عبر بروتوكول البث المعتمد.</span>
            ) : (
              <span>سيتم حفظها بجدول الحملات ليوم {scheduleDate || '____'} الساعة {scheduleTime || '__:__'}.</span>
            )}
          </div>

          <button
            type="submit"
            disabled={filteredRecipients.length === 0}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-sm shadow-xs transition duration-200 ${
              filteredRecipients.length === 0
                ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                : deliveryMode === 'now'
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white hover:shadow-md'
                : 'bg-indigo-600 hover:bg-indigo-700 text-white hover:shadow-md'
            }`}
            id="btn-dispatch-campaign"
          >
            {deliveryMode === 'now' ? (
              <>
                <Send className="w-4 h-4" />
                إطلاق البث المتتابع لـ ({phoneTarget === 'both' ? filteredRecipients.length * 2 : filteredRecipients.length}) مستهدف
              </>
            ) : (
              <>
                <Calendar className="w-4 h-4" />
                أرشفة وجدولة الحملة الذكية
              </>
            )}
          </button>
        </div>
      </form>


      {/* 3. MANUAL SEQUENTIAL BROADCASTER DIALOG MODAL (FULL SCREEN OVERLAY) */}
      {isManualSequentialActive && sequentialQueue.length > 0 && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in text-right font-sans" id="manual-sequential-broadcast-modal-overlay" dir="rtl">
          <div className="bg-white rounded-2xl max-w-4xl w-full border border-slate-100 shadow-2xl flex flex-col h-[90vh] overflow-hidden">
            
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2.5">
                <Send className="w-5 h-5 text-emerald-600 animate-pulse" />
                <div>
                  <h3 className="font-bold text-slate-800 text-base">
                    لوحة البث اليدوي المتتابع والآمن 📡
                  </h3>
                  <p className="text-[10px] text-slate-500 font-medium">بث وتخريج رسائل الدفعة دفعة واحدة عبر المتصفح تلقائياً</p>
                </div>
              </div>
              
              <button 
                onClick={() => {
                  if (confirm('هل أنت متأكد من رغبتك في إغلاق نافذة البث المباشر؟ لن يتم تخزين الإحصائيات غير المكتملة.')) {
                    setIsManualSequentialActive(false);
                    // Reset
                    setSequentialQueue([]);
                    setCurrentQueueIndex(0);
                    setIsAutoPlayPulse(false);
                  }
                }}
                className="p-1 hover:bg-slate-200 text-slate-400 hover:text-slate-700 rounded-full transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Main Modal Dashboard Split Grid */}
            <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-12">
              
              {/* Left Column: Log, Controls and Queue List (Col span 5) */}
              <div className="lg:col-span-5 border-l border-slate-100 flex flex-col h-full bg-slate-50/50">
                <div className="p-4 border-b border-slate-100 space-y-3 bg-white">
                  <h4 className="text-xs font-bold text-slate-700">قائمة المستلمين في هذه الحملة:</h4>
                  
                  {/* Stats Badges */}
                  <div className="grid grid-cols-3 gap-2 text-center text-[11px] font-bold">
                    <div className="bg-emerald-50 border border-emerald-100 p-1.5 rounded-lg text-emerald-700">
                      <div>تم الإرسال</div>
                      <div className="text-sm font-mono mt-0.5">{sequentialQueue.filter(q => q.status === 'opened').length}</div>
                    </div>
                    <div className="bg-amber-50 border border-amber-100 p-1.5 rounded-lg text-amber-700">
                      <div>المتبقي</div>
                      <div className="text-sm font-mono mt-0.5">{sequentialQueue.filter(q => q.status === 'pending').length}</div>
                    </div>
                    <div className="bg-slate-100 border border-slate-200 p-1.5 rounded-lg text-slate-600">
                      <div>تم التخطي</div>
                      <div className="text-sm font-mono mt-0.5">{sequentialQueue.filter(q => q.status === 'skipped').length}</div>
                    </div>
                  </div>
                </div>

                {/* Vertical Scrollable Queue Stack */}
                <div className="flex-1 overflow-y-auto divide-y divide-slate-100 p-3 space-y-2">
                  {sequentialQueue.map((item, idx) => {
                    const isCurrent = idx === currentQueueIndex;
                    const isPassed = idx < currentQueueIndex;
                    
                    return (
                      <div 
                        key={idx} 
                        className={`p-2.5 rounded-xl border transition text-xs flex items-center justify-between gap-2 bg-white ${
                          isCurrent 
                            ? 'border-emerald-500 bg-emerald-50/20 shadow-xs scale-[1.01]' 
                            : isPassed 
                            ? 'border-slate-100 opacity-60 bg-slate-50/20' 
                            : 'border-slate-200/60'
                        }`}
                      >
                        <div className="space-y-0.5 text-right">
                          <div className="font-bold text-slate-800 flex items-center gap-1.5">
                            <span>{idx + 1}. {item.studentName}</span>
                            {isCurrent && <span className="bg-emerald-600 text-white text-[9px] px-1 py-0.2 rounded-sm animate-pulse font-normal">جاري معالجته</span>}
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono">({item.phone}) • الصف {item.grade}</div>
                        </div>

                        <div>
                          {item.status === 'opened' ? (
                            <span className="px-2 py-0.5 rounded-md text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">✓ تم الإطلاق</span>
                          ) : item.status === 'skipped' ? (
                            <span className="px-2 py-0.5 rounded-md text-[9px] font-bold bg-slate-100 text-slate-500 border border-slate-200">↩ تخطي</span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-md text-[9px] font-bold bg-slate-50 text-slate-400 border border-slate-200">⏳ وبانتظار</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Right Column: Execution Engine and Core Workspace (Col span 7) */}
              <div className="lg:col-span-7 p-6 flex flex-col justify-between h-full bg-white overflow-y-auto">
                
                {/* Active queue index finished view or execution dashboard */}
                {currentQueueIndex >= sequentialQueue.length ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-8 space-y-4">
                    <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mb-2">
                      <ShieldCheck className="w-9 h-9 text-emerald-600" />
                    </div>
                    <h4 className="text-lg font-bold text-slate-800">اكتمل بث الدفعة بنجاح!</h4>
                    <p className="text-slate-500 text-xs max-w-md leading-relaxed">
                      لقد قمت بإطلاق وإجراء محادثات وتنبيهات لجميع الطلاب المستهدفين المحددين بالكامل بنجاح وبدون تكرار أو مجهود يدوي متكرر.
                    </p>
                    
                    <div className="bg-slate-50 p-4 border border-slate-100 rounded-2xl w-full max-w-sm text-right space-y-1.5 text-xs font-semibold">
                      <div className="text-slate-500 text-[10px] uppercase font-bold text-center border-b border-slate-200 pb-1.5 mb-2 font-mono">ملخص البث المعتمد للتقارير</div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">مجموع المستلمين الكلي:</span>
                        <span className="font-mono text-slate-800">{sequentialQueue.length}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">تم فتح تبويبات تواصل لـ:</span>
                        <span className="font-mono text-emerald-600 font-bold">{sequentialQueue.filter(q => q.status === 'opened').length} طالب</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">تم تجاهلها/تخطيها:</span>
                        <span className="font-mono text-slate-600">{sequentialQueue.filter(q => q.status === 'skipped').length}</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        emitLogs(accumulatedManualLogs);
                        setIsManualSequentialActive(false);
                        // Reset forms
                        setMessageContent('');
                        setSelectedTemplateId('');
                        setCampaignTitle('حملة تواصل مدرسية');
                      }}
                      className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer"
                    >
                      حفظ إقرار البث وإغلاق النافذة
                    </button>
                  </div>
                ) : (
                  <div className="space-y-6 flex-1 flex flex-col justify-between">
                    
                    {/* Execution Selector & Controls Header */}
                    <div className="space-y-4">
                      
                      {/* Gateway Channel Choice Selector */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-1">قناة البث المستهدفة:</label>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setBroadcastChannel('whatsapp')}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold border flex items-center gap-1.5 transition cursor-pointer ${
                                broadcastChannel === 'whatsapp'
                                  ? 'bg-emerald-50 border-emerald-400 text-emerald-800'
                                  : 'bg-white border-slate-200 text-slate-600 hover:border-emerald-300'
                              }`}
                            >
                              <MessageCircle className="w-3.5 h-3.5 text-emerald-600" />
                              عبر WhatsApp Web 🟢
                            </button>
                            <button
                              type="button"
                              onClick={() => setBroadcastChannel('sms')}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold border flex items-center gap-1.5 transition cursor-pointer ${
                                broadcastChannel === 'sms'
                                  ? 'bg-indigo-50 border-indigo-400 text-indigo-800'
                                  : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-300'
                              }`}
                            >
                              <Smartphone className="w-3.5 h-3.5 text-indigo-600" />
                              عبر تطبيق SMS للجوال 📱
                            </button>
                          </div>
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-1">سرعة التتابع التلقائي:</label>
                          <select
                            value={autoPlayTimerSec}
                            onChange={e => {
                              const val = Number(e.target.value);
                              setAutoPlayTimerSec(val);
                              setCountdownRemaining(val);
                            }}
                            className="bg-white border border-slate-200 rounded-lg text-xs font-bold px-2 py-1 outline-hidden cursor-pointer"
                          >
                            <option value={2}>سريعة جداً (ثانيتين)</option>
                            <option value={3}>سريعة (3 ثواني)</option>
                            <option value={4}>المتوسطة (4 ثواني)</option>
                            <option value={6}>متأنية (6 ثواني)</option>
                            <option value={8}>آمنة جداً (8 ثواني)</option>
                          </select>
                        </div>
                      </div>

                      {/* Display Alert Banner for Popups */}
                      <div className="text-[11px] leading-relaxed p-2.5 rounded-xl border border-blue-100 bg-blue-50/50 text-blue-900 flex gap-2">
                        <span className="text-base">💡</span>
                        <div>
                          <p className="font-bold">يرجى التأكد من تفعيل "السماح بالنوافذ المنبثقة (Pop-ups)"</p>
                          <p className="text-[10px] text-blue-800">بمجرد الضغط على تشغيل، سيقوم المتصفح تلقائياً بفتح النوافذ المتتالية لرسائل أولياء الأمور فترسلها وتنتقل للتالي دون تكرار!</p>
                        </div>
                      </div>

                      {/* Current Active Recipient Card */}
                      <div className="bg-slate-50 border border-slate-200/65 rounded-2xl p-4 text-right space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 border-b border-slate-200/75 pb-2">
                          <span className="text-[10px] uppercase font-bold text-slate-400 font-sans">المستهدف الفعلي الحالي بالدور:</span>
                          <span className="text-xs font-mono font-bold text-indigo-700">ترتيب رقم {currentQueueIndex + 1} من {sequentialQueue.length}</span>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <span className="text-[10px] text-slate-400 block mb-0.5 font-sans">اسم طالب المدرسة:</span>
                            <span className="text-sm font-bold text-slate-800">{sequentialQueue[currentQueueIndex].studentName}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-400 block mb-0.5 font-sans">اسم العائلة / ولي الأمر ورقم جواله:</span>
                            <span className="text-sm font-bold text-slate-800">{sequentialQueue[currentQueueIndex].parentName} ({sequentialQueue[currentQueueIndex].phone})</span>
                          </div>
                        </div>

                        <div className="space-y-1">
                          <span className="text-[10px] text-slate-400 font-bold block font-sans">مضمون نص الرسالة المخصصة له:</span>
                          <div className="bg-white border border-slate-100 rounded-xl p-3 text-xs leading-relaxed text-slate-700 whitespace-pre-wrap font-sans max-h-[120px] overflow-y-auto">
                            <SecretText
                              block
                              value={sequentialQueue[currentQueueIndex].content}
                              maskedValue={sequentialQueue[currentQueueIndex].logContent ?? sequentialQueue[currentQueueIndex].content}
                            />
                          </div>
                        </div>

                        {/* Automatic Play Countdown Display */}
                        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-1">
                          
                          <div className="flex items-center gap-1.5">
                            {isAutoPlayPulse ? (
                              <div className="flex items-center gap-1.5">
                                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
                                <span className="text-xs font-bold text-emerald-700 font-sans">جاري البث التلقائي: سيتم إطلاق المحادثة والذهاب للتالي بعد <strong className="font-mono text-base font-black px-1 text-emerald-800 animate-pulse">{countdownRemaining}</strong> ثانية...</span>
                              </div>
                            ) : (
                              <span className="text-xs font-bold text-slate-500 font-sans">⏱ الوضع الآلي متوقف مؤقتاً... اضغط تشغيل لبدء الانتقال التلقائي.</span>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            {isAutoPlayPulse ? (
                              <button
                                type="button"
                                onClick={() => setIsAutoPlayPulse(false)}
                                className="flex items-center gap-1.5 py-1.5 px-3 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg transition cursor-pointer font-sans"
                              >
                                <Pause className="w-3.5 h-3.5" />
                                إيقاف مؤقت ⏸
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setIsAutoPlayPulse(true);
                                  setCountdownRemaining(autoPlayTimerSec);
                                  // Open the named tab with user click gesture context first
                                  triggerLaunchAtIndex(currentQueueIndex, true);
                                }}
                                className="flex items-center gap-1.5 py-1.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition cursor-pointer font-sans"
                              >
                                <Play className="w-3.5 h-3.5" />
                                بدء تشغيل آلي ▶
                              </button>
                            )}
                          </div>

                        </div>

                      </div>
                    </div>

                    {/* Operational Action Footer Buttons */}
                    <div className="pt-4 border-t border-slate-200/80 flex flex-wrap items-center justify-between gap-4 font-sans">
                      
                      {/* Exit/Cancel safely */}
                      <button
                        type="button"
                        onClick={() => {
                          if (accumulatedManualLogs.length > 0) {
                            if (confirm(`لقد قمت بإطلاق ${accumulatedManualLogs.length} محادثة بالفعل. هل ترغب في حفظ البث الحالي حتى هذه اللحظة في قاعدة الإحصائيات قبل الخروج؟`)) {
                              emitLogs(accumulatedManualLogs);
                              setIsManualSequentialActive(false);
                            }
                          } else {
                            setIsManualSequentialActive(false);
                          }
                        }}
                        className="px-4 py-2 hover:bg-slate-100 text-slate-600 text-xs font-bold rounded-xl transition cursor-pointer font-sans"
                      >
                        خروج وإلغاء البث
                      </button>

                      {/* Manual Trigger & Skip Buttons */}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => skipLaunchAtIndex(currentQueueIndex)}
                          className="flex items-center gap-1.5 py-2 px-3.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl border border-slate-200 transition cursor-pointer font-sans"
                          title="تخطي هذا الرقم دون فتح المحادثة والذهاب للرقم القادم"
                        >
                          <SkipForward className="w-3.5 h-3.5" />
                          تخطي هذا الطالب ⏭
                        </button>

                        <button
                          type="button"
                          onClick={() => triggerLaunchAtIndex(currentQueueIndex, true)}
                          className="flex items-center gap-1.5 py-2 px-6 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs hover:shadow-md transition cursor-pointer font-sans"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
                          إرسال وفتح التالي &gt;&gt;
                        </button>
                      </div>

                    </div>

                  </div>
                )}

              </div>

            </div>

          </div>
        </div>
      )}

      {/* 4. SILENT BACKGROUND BROADCAST ACTIVE MODAL (FULL SCREEN OVERLAY) */}
      {isSilentBroadcastActive && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in text-right font-sans" id="silent-broadcast-modal-overlay" dir="rtl">
          <div className="bg-white rounded-2xl max-w-2xl w-full border border-slate-100 shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
            
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2.5">
                {silentProgress.stage === 'sending' ? (
                  <Loader2 className="w-5 h-5 text-indigo-600 animate-spin" />
                ) : (
                  <ShieldCheck className="w-5 h-5 text-emerald-600" />
                )}
                <h3 className="font-bold text-slate-800 text-base">
                  {silentProgress.stage === 'sending' 
                    ? 'جاري إرسال وبث الإشعارات بالخلفية بشكل صامت تلقائياً...' 
                    : 'اكتملت حملة البث الدفعي الصامت بنجاح!'}
                </h3>
              </div>
              
              {silentProgress.stage === 'finished' && (
                <button 
                  onClick={() => {
                    setIsSilentBroadcastActive(false);
                    setMessageContent('');
                    setSelectedTemplateId('');
                    setCampaignTitle('حملة تواصل مدرسية');
                  }}
                  className="p-1 hover:bg-slate-200 text-slate-400 hover:text-slate-700 rounded-full transition"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>

            {/* Modal Content */}
            <div className="p-6 overflow-y-auto space-y-5 flex-1">
              
              {/* Progress Bar Display */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                  <span>التقدم المحرز لبوابة الـ API:</span>
                  <span className="font-mono text-indigo-700">{silentProgress.current} من {silentProgress.total} مستلم</span>
                </div>

                <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                  <div 
                    className="bg-indigo-600 h-full transition-all duration-300"
                    style={{ width: `${(silentProgress.current / silentProgress.total) * 100}%` }}
                  />
                </div>

                <p className="text-xs text-slate-500 italic mt-1 font-medium">{silentProgress.statusText}</p>
              </div>

              {/* Success Ratio Counter Cards */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-emerald-50/70 border border-emerald-100 rounded-xl p-3 text-right">
                  <div className="text-[10px] text-emerald-700 font-bold">نجحت عملية البث والتسليم</div>
                  <div className="text-xl font-bold font-mono text-emerald-600 mt-1">{silentProgress.successCount} رسالة</div>
                </div>
                <div className="bg-rose-50/70 border border-rose-100 rounded-xl p-3 text-right">
                  <div className="text-[10px] text-rose-700 font-bold">فشل الطلب البرمجي للبوابة</div>
                  <div className="text-xl font-bold font-mono text-rose-600 mt-1">{silentProgress.failedCount} رسالة</div>
                </div>
              </div>

              {/* Detailed Broadcast Results Table log */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-700">سجل إطلاق البث الصامت الحي:</h4>
                <div className="border border-slate-150 rounded-xl overflow-hidden max-h-[220px] overflow-y-auto divide-y divide-slate-100 bg-slate-50/30">
                  {silentProgress.results.length === 0 ? (
                    <div className="p-8 text-center text-slate-400 text-xs font-bold">يرجى الانتظار، جاري بدء المعالجة برمز البث التلقائي...</div>
                  ) : (
                    silentProgress.results.map((res, idx) => (
                      <div key={idx} className="p-3 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-white hover:bg-slate-50/50 transition">
                        <div className="space-y-0.5">
                          <div className="font-bold text-slate-800 flex items-center gap-1.5 font-sans">
                            <span>{res.name}</span>
                            <span className="text-[10px] text-slate-400 font-mono font-normal">({res.phone})</span>
                          </div>
                          <div className="text-[10px] text-slate-500 line-clamp-1">{res.content}</div>
                          {res.status === 'failed' && (
                            <div className="text-[9.5px] text-rose-600 font-semibold italic font-medium">سبب عطل البث: {res.message}</div>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 self-end sm:self-center shrink-0">
                          {res.status === 'success' ? (
                            <span className="px-2.5 py-0.5 rounded-md text-[9.5px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-100">✓ تم الإرسال</span>
                          ) : (
                            <span className="px-2.5 py-0.5 rounded-md text-[9.5px] font-bold bg-rose-50 text-rose-700 border border-rose-100">⚠️ فشل بروتوكولياً</span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-100 flex items-center justify-end bg-slate-50 gap-3">
              {silentProgress.stage === 'sending' ? (
                <div className="text-[11px] text-slate-500 font-medium font-sans">الرجاء إبقاء هذه التبويبة نشطة ومفتوحة، سيقوم التطبيق بالبث دفعة واحدة صامتاً...</div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setIsSilentBroadcastActive(false);
                    setMessageContent('');
                    setSelectedTemplateId('');
                    setCampaignTitle('حملة تواصل مدرسية');
                  }}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer font-sans"
                >
                  حفظ تقارير البث وإغلاق الشاشة
                </button>
              )}
            </div>

          </div>
        </div>
      )}
      {/* Save Template Custom Popup Modal */}
      {isSaveModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs font-sans">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-xl border border-slate-100 overflow-hidden text-right">
            <div className="p-5 border-b border-slate-100 bg-slate-50/70 flex items-center justify-between">
              <button 
                type="button" 
                onClick={() => setIsSaveModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer text-sm"
              >
                ✕
              </button>
              <h3 className="text-sm font-black text-slate-800 flex items-center gap-1.5">
                <span>💾 حفظ الرسالة كقالب جاهز</span>
              </h3>
            </div>
            
            <div className="p-5 space-y-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700">اسم أو عنوان القالب:</label>
                <input
                  type="text"
                  value={newTemplateTitle}
                  onChange={e => setNewTemplateTitle(e.target.value)}
                  placeholder="مثال: تنبيه نجاح وتفوق الطالب"
                  className="w-full px-3 py-2 border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-xl text-xs transition outline-hidden"
                  autoFocus
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-500">نص الرسالة الذي سيتم حفظه:</label>
                <div className="bg-slate-50 border border-slate-150 rounded-xl p-3 text-[11px] text-slate-600 leading-relaxed max-h-[100px] overflow-y-auto whitespace-pre-wrap">
                  {messageContent}
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 flex items-center justify-end bg-slate-50 gap-2.5">
              <button
                type="button"
                onClick={() => setIsSaveModalOpen(false)}
                className="px-4 py-2 hover:bg-slate-200 text-slate-600 text-xs font-bold rounded-xl transition cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleConfirmSaveTemplate}
                disabled={!newTemplateTitle.trim()}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer"
              >
                حفظ في بنك النصوص القوالب
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save Success Custom Beautiful Toast */}
      {saveSuccessNotification && (
        <div className="fixed bottom-6 left-6 z-50 flex items-center gap-3 bg-emerald-600 text-white font-sans text-xs font-bold py-3 px-5 rounded-2xl shadow-xl border border-emerald-500/30">
          <div className="w-5 h-5 bg-white/20 rounded-full flex items-center justify-center shrink-0 text-[10px]">
            ✓
          </div>
          <span className="leading-relaxed">{saveSuccessNotification}</span>
        </div>
      )}

    </div>
  );
}

