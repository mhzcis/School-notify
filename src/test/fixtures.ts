/** FAKE fixtures only — no real student data. */
import { Student } from '../types';

export function fakeStudent(n: number, overrides: Partial<Student> = {}): Student {
  return {
    id: String(1000000000 + n),
    name: `طالب تجريبي ${n}`,
    parentName: 'ولي أمر تجريبي',
    phone: `05900000${String(n % 100).padStart(2, '0')}`.replace(/^0590000000$/, '0590000001'),
    grade: 'العاشر',
    section: 'أ',
    ...overrides,
  };
}

export const fakeStudents = (count: number, start = 1) => Array.from({ length: count }, (_, i) => fakeStudent(start + i));
