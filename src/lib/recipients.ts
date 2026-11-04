/**
 * Builds the per-phone dispatch list for a set of students. Students without a valid
 * mobile number for the chosen target are EXCLUDED (never sent to a fallback number)
 * and returned in `excluded` so the UI can show a visible warning.
 */
import type { Student } from '../types';
import { checkPhone, PhoneProblem } from './phone';
import { renderTemplate, templateUsesSecrets } from './template';

export type PhoneTarget = 'primary' | 'secondary' | 'both';

export interface DispatchItem {
  studentId: string;
  studentName: string;
  parentName: string;
  phone: string;
  grade: string;
  section: string;
  content: string;
  /** Same message with secrets (Moodle password) masked: use this for logs, lists and previews. */
  logContent: string;
  status: 'pending' | 'opened' | 'skipped';
}

export interface ExcludedRecipient {
  studentId: string;
  studentName: string;
  which: 'primary' | 'secondary';
  rawPhone: string;
  problem: PhoneProblem;
}

export function buildDispatchItems(
  students: Student[],
  phoneTarget: PhoneTarget,
  template: string,
  render: (tpl: string, s: Student) => string = (tpl, s) => renderTemplate(tpl, s)
): { items: DispatchItem[]; excluded: ExcludedRecipient[] } {
  const items: DispatchItem[] = [];
  const excluded: ExcludedRecipient[] = [];

  for (const s of students) {
    const wanted: Array<'primary' | 'secondary'> =
      phoneTarget === 'both' ? ['primary', 'secondary'] : [phoneTarget];
    const seen = new Set<string>();
    let content: string | null = null;
    let logContent: string | null = null;

    for (const which of wanted) {
      const raw = which === 'primary' ? s.phone : s.phone2;
      // With 'both', a missing secondary number is simply skipped (previous behaviour), not an error.
      if (which === 'secondary' && phoneTarget === 'both' && (!raw || !String(raw).trim())) continue;
      const check = checkPhone(raw);
      if (!check.valid) {
        excluded.push({ studentId: s.id, studentName: s.name, which, rawPhone: raw ? String(raw) : '', problem: check.problem! });
        continue;
      }
      if (seen.has(check.local)) continue; // same number twice -> send once
      seen.add(check.local);
      if (content === null) {
        content = render(template, s);
        logContent = templateUsesSecrets(template) ? renderTemplate(template, s, { maskSecrets: true }) : content;
      }
      items.push({
        studentId: s.id,
        studentName: s.name,
        parentName: s.parentName,
        phone: check.local,
        grade: s.grade,
        section: s.section,
        content,
        logContent: logContent as string,
        status: 'pending',
      });
    }
  }
  return { items, excluded };
}
