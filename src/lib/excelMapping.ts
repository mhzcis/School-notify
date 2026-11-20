/**
 * Excel header -> Student field mapping.
 *
 * Mapping is resolved ONCE per sheet from the header row:
 *   1. exact matches (after Arabic normalisation) win;
 *   2. only then a guarded "contains" fallback is tried, with explicit exclusions
 *      (e.g. 'مهنة ولي الأمر' can never become the parent name, and an English-name
 *      column can never become the Arabic student name);
 *   3. each field is taken from at most one column and each column feeds at most one field.
 */
import type { Student } from '../types';

export type MappedField =
  | 'name'
  | 'nameEn'
  | 'idNumber'
  | 'grade'
  | 'section'
  | 'phone'
  | 'phone2'
  | 'parentName'
  | 'previousYearGPA'
  | 'email';

/** Same normalisation the importer already used: strip diacritics/punctuation/spaces, unify letters. */
export function normalizeHeader(str: string): string {
  if (!str) return '';
  return String(str)
    .replace(/["'”’«»`']/g, '')
    .replace(/[\u0640]/g, '')
    .replace(/[\u064B-\u065F]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ة]/g, 'ه')
    .replace(/[ى]/g, 'ي')
    .replace(/[^a-zA-Z0-9\u0621-\u064A\u0660-\u0669]/g, '')
    .trim()
    .toLowerCase();
}

interface FieldRule {
  field: MappedField;
  exact: string[];
  /** Fallback: header must contain ALL tokens of at least one group... */
  containsAll?: string[][];
  /** ...and must not contain any of these tokens. */
  exclude?: string[];
}

const n = (xs: string[]) => xs.map(normalizeHeader);

/** Headers that are known and deliberately NOT imported; they can never feed any field. */
const IGNORED_HEADERS = new Set(
  n([
    'مهنة ولي الأمر', 'مهنة ولي الامر', 'مهنة الأب', 'مهنة الاب', 'عمل ولي الأمر', 'وظيفة ولي الأمر',
    'اسم الأم', 'مهنة الأم', 'نوع بطاقة التعريف', 'نوع الهوية', 'رقم تسجيل الفرد', 'رقم تسجيل العائلة',
    'المنطقة', 'المدرسة', 'حالة اللجوء', 'الجنسية', 'الجنس', 'تاريخ الميلاد', 'مكان الميلاد', 'المدينة',
    'المحافظة', 'البلدة الأصلية', 'العنوان', 'الديانة', 'شبكة الأمان الاجتماعي', 'هل لديه مرض مزمن', 'يسكن في المخيم',
    // Notes and Moodle credentials must never be imported into students.
    'ملاحظات أو مستحقات', 'ملاحظات', 'المستحقات', 'مستحقات',
    'اسم المستخدم', 'اسم مستخدم', 'اسم المستخدم مودل', 'اسم مستخدم مودل', 'Username', 'User Name', 'Moodle Username', 'moodle_username',
    'كلمة المرور', 'كلمة مرور', 'كلمة المرور مودل', 'كلمة مرور مودل', 'Password', 'Moodle Password', 'moodle_password',
    'كلمة المرور الافتراضية', 'كلمة مرور افتراضية', 'Default Password', 'default_password',
  ])
);

const RULES: FieldRule[] = [
  {
    field: 'name',
    exact: n(['اسم الطالب', 'الاسم', 'اسم الطالب رباعي', 'اسم الطالب كاملا', 'الاسم الكامل', 'اسم الطالب عربي', 'اسم الطالب بالعربي', 'الطالب']),
    containsAll: [n(['اسم', 'طالب'])],
    exclude: n(['انجليزي', 'english', 'eng', 'لاتيني', 'ولي', 'الام', 'الاب', 'مهنه', 'رقم', 'هويه', 'مستخدم', 'مرور', 'user', 'password', 'مودل', 'moodle']),
  },
  {
    field: 'nameEn',
    exact: n(['اسم الطالب انجليزي', 'اسم الطالب بالانجليزي', 'اسم الطالب بالإنجليزية', 'الاسم بالانجليزي', 'الاسم انجليزي', 'English Name', 'Student Name (English)', 'name en']),
    containsAll: [n(['اسم', 'انجليزي']), n(['english', 'name'])],
    exclude: n(['ولي', 'الام', 'مهنه', 'user', 'مستخدم', 'moodle']),
  },
  {
    field: 'idNumber',
    exact: n(['رقم بطاقة التعريف', 'رقم الهوية', 'رقم التعريف', 'الهوية', 'رقم هوية الطالب']),
    containsAll: [n(['رقم', 'هويه']), n(['رقم', 'تعريف'])],
    exclude: n(['نوع', 'ولي', 'الام', 'الاب', 'تسجيل']),
  },
  {
    field: 'grade',
    exact: n(['الصف', 'الصف الدراسي', 'الصف والمرحلة']),
    containsAll: [n(['صف'])],
    exclude: n(['وصف']),
  },
  {
    field: 'section',
    exact: n(['الشعبة', 'شعبة']),
    containsAll: [n(['شعبه'])],
  },
  {
    field: 'phone',
    exact: n(['جوال العائلة', 'الجوال', 'رقم الجوال', 'جوال', 'جوال ولي الأمر', 'رقم جوال ولي الأمر', 'موبايل', 'Mobile', 'Phone']),
    containsAll: [n(['جوال'])],
    exclude: n(['تليفون', 'بديل', 'اخر', 'ثاني']),
  },
  {
    field: 'phone2',
    exact: n(['تليفون العائلة', 'الهاتف', 'الهاتف البديل', 'هاتف المنزل', 'جوال بديل', 'جوال آخر', 'رقم بديل']),
    containsAll: [n(['تليفون']), n(['هاتف'])],
  },
  {
    field: 'parentName',
    exact: n(['اسم ولي امر الطالب', 'اسم ولي أمر الطالب', 'اسم ولي الأمر', 'ولي الأمر', 'اسم الأب', 'اسم الوالد']),
    containsAll: [n(['اسم', 'ولي'])],
    exclude: n(['مهنه', 'عمل', 'وظيفه', 'جوال', 'هاتف', 'تليفون', 'هويه', 'رقم', 'بريد', 'انجليزي', 'مستخدم', 'مرور', 'user', 'password', 'مودل', 'moodle']),
  },
  {
    field: 'previousYearGPA',
    exact: n(['معدل الطالب العام السابق', 'المعدل', 'معدل الطالب']),
    containsAll: [n(['معدل'])],
  },
  {
    field: 'email',
    exact: n(['البريد', 'البريد الإلكتروني', 'الايميل', 'Email', 'E-mail']),
    containsAll: [n(['email']), n(['ايميل']), n(['بريد'])],
  },
];

/** Resolves header (original text) -> field. Unmapped headers are absent from the result. */
export function resolveHeaderMap(headers: string[]): Record<string, MappedField> {
  const result: Record<string, MappedField> = {};
  const usedFields = new Set<MappedField>();
  const normHeaders = headers.map(h => ({ orig: h, norm: normalizeHeader(h) }));
  const available = normHeaders.filter(h => h.norm && !IGNORED_HEADERS.has(h.norm));

  // Pass 1: exact matches.
  for (const rule of RULES) {
    const hit = available.find(h => !(h.orig in result) && rule.exact.includes(h.norm));
    if (hit) {
      result[hit.orig] = rule.field;
      usedFields.add(rule.field);
    }
  }
  // Pass 2: guarded contains fallback for fields still missing.
  for (const rule of RULES) {
    if (usedFields.has(rule.field) || !rule.containsAll) continue;
    const hit = available.find(h => {
      if (h.orig in result) return false;
      if (rule.exclude?.some(x => h.norm.includes(x))) return false;
      return rule.containsAll!.some(group => group.every(tok => h.norm.includes(tok)));
    });
    if (hit) {
      result[hit.orig] = rule.field;
      usedFields.add(rule.field);
    }
  }
  return result;
}

/** Applies a resolved header map to one row. Values are trimmed strings; empties are skipped. */
export function mapRowToStudentFields(row: Record<string, unknown>, headerMap: Record<string, MappedField>): Partial<Student> {
  const student: Partial<Student> = {};
  for (const [header, field] of Object.entries(headerMap)) {
    const raw = row[header];
    if (raw === undefined || raw === null) continue;
    const val = String(raw).trim();
    if (!val || val === 'undefined' || val === 'null') continue;
    (student as Record<string, string>)[field] = val;
  }
  if (student.idNumber) student.id = student.idNumber;
  return student;
}

/** Fields the teacher may assign in the column-mapping review (never notes or Moodle credentials). */
export const IMPORTABLE_FIELDS: MappedField[] = [
  'name', 'nameEn', 'idNumber', 'grade', 'section', 'phone', 'phone2', 'parentName', 'previousYearGPA', 'email',
];

export const FIELD_LABELS: Record<MappedField, string> = {
  name: 'اسم الطالب (عربي)',
  nameEn: 'اسم الطالب (إنجليزي)',
  idNumber: 'رقم الهوية',
  grade: 'الصف',
  section: 'الشعبة',
  phone: 'الرقم 1 (الرئيسي)',
  phone2: 'الرقم 2 (البديل)',
  parentName: 'اسم ولي الأمر',
  previousYearGPA: 'المعدل السابق',
  email: 'البريد الإلكتروني',
};

export function isEnglishNameHeader(header: string): boolean {
  const h = normalizeHeader(header);
  return h.includes('انجليزي') || h.includes('english') || h.includes('لاتيني') || h.includes('eng');
}

export function isParentProfessionHeader(header: string): boolean {
  const h = normalizeHeader(header);
  return (h.includes('مهنه') || h.includes('عمل') || h.includes('وظيفه')) && (h.includes('ولي') || h.includes('اب') || h.includes('ام'));
}

export function isIgnoredHeader(header: string): boolean {
  return IGNORED_HEADERS.has(normalizeHeader(header));
}

/**
 * A teacher override must not bind an English-name header to the Arabic name,
 * or a parent-profession header to the parent name, or any ignored/credential header to a field.
 */
export function canAssignField(header: string, field: MappedField): boolean {
  if (isIgnoredHeader(header)) return false;
  if (field === 'name' && isEnglishNameHeader(header)) return false;
  if (field === 'parentName' && isParentProfessionHeader(header)) return false;
  return true;
}

export type ColumnAssignment = MappedField | 'ignore';

/** Applies teacher overrides on top of auto-mapping; illegal assignments are dropped (column ignored). */
export function applyColumnOverrides(
  headers: string[],
  autoMap: Record<string, MappedField>,
  overrides: Record<string, ColumnAssignment>
): Record<string, MappedField> {
  const used = new Set<MappedField>();
  const result: Record<string, MappedField> = {};
  for (const header of headers) {
    const over = overrides[header];
    if (over === 'ignore') continue;
    const field = (over && canAssignField(header, over) ? over : autoMap[header]);
    if (!field) continue;
    if (!canAssignField(header, field)) continue;
    if (used.has(field)) continue;
    result[header] = field;
    used.add(field);
  }
  return result;
}
