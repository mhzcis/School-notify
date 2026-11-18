import { describe, expect, it } from 'vitest';
import { PLACEHOLDERS, SECRET_MASK, missingMoodleFields, renderTemplate, templateUsesSecrets } from './template';
import { mapRowToStudentFields, resolveHeaderMap } from './excelMapping';
import { buildDispatchItems } from './recipients';
import type { Student } from '../types';

// FAKE credentials only.
const fake: Student = {
  id: 'T-1', name: 'طالب تجريبي الأول', parentName: 'ولي أمر تجريبي', phone: '0599000001',
  grade: 'السابع', section: 'أ', moodleUsername: 'fake.user01', moodlePassword: 'Fake#Pass-0001',
};
const tpl = 'مرحباً {{الاسم_الأول}}، مستخدم مودل: {{اسم_المستخدم}} وكلمة المرور: {{كلمة_المرور}}';

describe('Moodle template variables', () => {
  it('are offered in the picker, with the password flagged as sensitive', () => {
    const tags = PLACEHOLDERS.map(p => p.tag);
    expect(tags).toContain('{{اسم_المستخدم}}');
    expect(PLACEHOLDERS.find(p => p.tag === '{{كلمة_المرور}}')?.sensitive).toBe(true);
  });

  it('render the real values for sending and a mask when maskSecrets is set', () => {
    expect(renderTemplate(tpl, fake)).toBe('مرحباً طالب، مستخدم مودل: fake.user01 وكلمة المرور: Fake#Pass-0001');
    const masked = renderTemplate(tpl, fake, { maskSecrets: true });
    expect(masked).toContain('fake.user01');
    expect(masked).toContain(SECRET_MASK);
    expect(masked).not.toContain('Fake#Pass-0001');
  });

  it('render empty for students without Moodle data and report what is missing', () => {
    const noMoodle = { ...fake, moodleUsername: undefined, moodlePassword: undefined };
    expect(renderTemplate('[{{اسم_المستخدم}}|{{كلمة_المرور}}]', noMoodle)).toBe('[|]');
    expect(missingMoodleFields(tpl, noMoodle)).toEqual(['moodleUsername', 'moodlePassword']);
    expect(missingMoodleFields(tpl, fake)).toEqual([]);
    expect(missingMoodleFields('بدون متغيرات', noMoodle)).toEqual([]);
    expect(templateUsesSecrets(tpl)).toBe(true);
    expect(templateUsesSecrets('{{اسم_المستخدم}}')).toBe(false);
  });

  it('dispatch items carry the real text for sending but a masked logContent for logs/lists', () => {
    const { items } = buildDispatchItems([fake], 'primary', tpl);
    expect(items[0].content).toContain('Fake#Pass-0001');
    expect(items[0].logContent).not.toContain('Fake#Pass-0001');
    expect(items[0].logContent).toContain(SECRET_MASK);
    const plain = buildDispatchItems([fake], 'primary', 'مرحباً {{اسم_الطالب}}').items[0];
    expect(plain.logContent).toBe(plain.content);
  });
});

describe('Moodle Excel columns', () => {
  it('does not map Moodle credential or notes headers into student fields', () => {
    const map = resolveHeaderMap(['اسم الطالب', 'الصف', 'اسم المستخدم', 'كلمة المرور', 'ملاحظات']);
    expect(map['اسم الطالب']).toBe('name');
    expect(map['اسم المستخدم']).toBeUndefined();
    expect(map['كلمة المرور']).toBeUndefined();
    expect(map['ملاحظات']).toBeUndefined();
    const en = resolveHeaderMap(['اسم الطالب', 'Username', 'Password']);
    expect(en.Username).toBeUndefined();
    expect(en.Password).toBeUndefined();
  });

  it('never confuses Moodle columns with the student/parent name, regardless of column order', () => {
    const map = resolveHeaderMap(['اسم المستخدم', 'كلمة المرور', 'اسم ولي الأمر', 'الصف', 'اسم الطالب']);
    expect(map['اسم الطالب']).toBe('name');
    expect(map['اسم ولي الأمر']).toBe('parentName');
    expect(Object.values(map)).not.toContain('moodleUsername');
    expect(Object.values(map)).not.toContain('moodlePassword');
    // A username column without a student-name column must NOT become the name
    const only = resolveHeaderMap(['اسم مستخدم الطالب', 'الصف']);
    expect(Object.values(only)).not.toContain('name');
  });

  it('does not fuzzy-map unrelated columns to the password', () => {
    const map = resolveHeaderMap(['اسم الطالب', 'الصف', 'كلمة السر للبريد', 'رمز المرور']);
    expect(Object.values(map)).not.toContain('moodlePassword');
  });

  it('does not import Moodle username/password values from the sheet', () => {
    const map = resolveHeaderMap(['اسم الطالب', 'الصف', 'Username', 'Password']);
    const st = mapRowToStudentFields({ 'اسم الطالب': 'طالب وهمي', 'الصف': 'الثامن', Username: 'fake02', Password: 123456 }, map);
    expect(st.name).toBe('طالب وهمي');
    expect(st.moodleUsername).toBeUndefined();
    expect(st.moodlePassword).toBeUndefined();
  });
});

describe('Moodle aliases and section placeholders', () => {
  it('renders {{اسم_مستخدم_مودل}} / {{كلمة_مرور_مودل}} as aliases and masks the password', () => {
    const t = 'مستخدم {{اسم_مستخدم_مودل}} كلمة {{كلمة_مرور_مودل}}';
    expect(renderTemplate(t, fake)).toBe('مستخدم fake.user01 كلمة Fake#Pass-0001');
    expect(renderTemplate(t, fake, { maskSecrets: true })).toBe(`مستخدم fake.user01 كلمة ${SECRET_MASK}`);
    expect(templateUsesSecrets(t)).toBe(true);
  });

  it('fills {{رابط_الاختبار}} and {{موعد_الإغلاق}} from the section event, not from student notes', () => {
    const t = 'شعبة {{الشعبة}} رابط {{رابط_الاختبار}} قبل {{موعد_الإغلاق}}';
    const out = renderTemplate(t, fake, {
      quizUrl: 'https://mhzcis.github.io/moodle-quiz-launcher/?id=111111',
      closeDate: 'الخميس ظهراً',
    });
    expect(out).toBe('شعبة أ رابط https://mhzcis.github.io/moodle-quiz-launcher/?id=111111 قبل الخميس ظهراً');
    expect(out).not.toContain('ملاحظات');
    expect(renderTemplate(t, { ...fake, notes: 'لا تُستخدم' })).not.toContain('لا تُستخدم');
    expect(renderTemplate(t, { ...fake, notes: 'لا تُستخدم' })).toBe('شعبة أ رابط  قبل ');
  });
});
