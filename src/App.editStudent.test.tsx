// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import App from './App';
import { InMemorySchoolRepository } from './lib/repo/memoryRepo';
import { fakeStudents } from './test/fixtures';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const USER = { id: '00000000-0000-4000-8000-000000000001', email: 'teacher@example.test' };
let container: HTMLDivElement;
let root: Root;

const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
const click = async (el: Element) => { await act(async () => { (el as HTMLElement).click(); }); await settle(); };
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}
const q = <T extends Element>(sel: string) => container.querySelector(sel) as T;
const checkboxOf = (id: string) => (q(`[data-testid="edit-student-${id}"]`).parentElement!.querySelector('input[type="checkbox"]') as HTMLInputElement);

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

async function openComposer(repo: InMemorySchoolRepository) {
  await act(async () => {
    root.render(<App repo={repo} user={USER} onSignOut={() => {}} checkGateway={async () => ({ ok: false, error: 'sms_gateway_not_configured' })} />);
  });
  await settle();
  const nav = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('شاشة بث الرسائل'))!;
  await click(nav);
}

describe('edit single student (recipient picker)', () => {
  it('edits only that student, keeps count and selection, does not toggle the row', async () => {
    const students = fakeStudents(3).map(s => ({ ...s, notes: 'ملاحظة تجريبية', phone2: '0590000050' }));
    const repo = new InMemorySchoolRepository({ students });
    await openComposer(repo);
    const [a, b, c] = students.map(s => s.id);

    // select student A by clicking its row
    await click(q(`[data-testid="edit-student-${a}"]`).parentElement!.parentElement!);
    expect(checkboxOf(a).checked).toBe(true);
    expect(checkboxOf(b).checked).toBe(false);

    await click(q(`[data-testid="edit-student-${b}"]`));
    expect(q('#student-edit-dialog')).not.toBeNull();
    expect(q('#edit-notes')).toBeNull();
    expect(checkboxOf(b).checked).toBe(false); // edit click did not toggle selection

    // invalid phone is rejected
    type(q<HTMLInputElement>('#edit-phone'), '12345');
    await click(q('#student-edit-dialog button[type="submit"]'));
    expect(q('#student-edit-dialog')!.textContent).toContain('رقم غير صالح');
    expect((await repo.loadAll()).students.find(s => s.id === b)!.phone).toBe(students[1].phone);

    // clear phone 1, keep phone 2 -> valid
    type(q<HTMLInputElement>('#edit-phone'), '');
    type(q<HTMLInputElement>('#edit-name'), 'طالب تجريبي معدل');
    await click(q('#student-edit-dialog button[type="submit"]'));
    expect(q('#student-edit-dialog')).toBeNull();

    const after = (await repo.loadAll()).students;
    expect(after).toHaveLength(3);
    expect(after.find(s => s.id === b)).toEqual({ ...students[1], name: 'طالب تجريبي معدل', phone: '', phone2: '0590000050' });
    expect(after.find(s => s.id === a)).toEqual(students[0]);
    expect(after.find(s => s.id === c)).toEqual(students[2]);
    expect(container.textContent).toContain('طالب تجريبي معدل');
    expect(checkboxOf(a).checked).toBe(true);
    expect(checkboxOf(b).checked).toBe(false);
    expect(checkboxOf(c).checked).toBe(false);
  });

  it('keeps the dialog open and data unchanged when the save fails', async () => {
    const students = fakeStudents(2);
    const repo = new InMemorySchoolRepository({ students });
    await openComposer(repo);
    await click(q(`[data-testid="edit-student-${students[0].id}"]`));
    type(q<HTMLInputElement>('#edit-name'), 'اسم تجريبي');
    repo.failNext = 'offline';
    await click(q('#student-edit-dialog button[type="submit"]'));
    expect(q('#student-edit-dialog')).not.toBeNull();
    expect((await repo.loadAll()).students).toEqual(students);
  });
});
