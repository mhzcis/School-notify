import { describe, expect, it } from 'vitest';
import { InMemorySchoolRepository } from './memoryRepo';
import { SupabaseSchoolRepository } from './supabaseRepo';
import { chunk, dedupeStudents, isUuid, logToRow, mergeIncomingStudent, prepareLogs, rowToLog, rowToStudent, studentToRow } from './mapping';
import { RepoError, UPSERT_CHUNK_SIZE, repoErrorMessage } from './types';
import { fakeStudent, fakeStudents } from '../../test/fixtures';
import { MessageLog } from '../../types';
import { buildRecipientGroup, LOCAL_GROUPS_KEY } from '../recipientGroups';

const OWNER = '00000000-0000-4000-8000-000000000001';

const fakeLog = (n: number, extra: Partial<MessageLog> = {}): MessageLog => ({
  id: `LOG${n}`,
  studentId: String(1000000000 + n),
  studentName: `طالب تجريبي ${n}`,
  parentName: 'ولي أمر تجريبي',
  phone: '0590000001',
  grade: 'العاشر',
  section: 'أ',
  messageContent: 'رسالة تجريبية',
  sentTime: '2026-11-04T08:00:00.000Z',
  status: 'sent',
  ...extra,
});

describe('mapping', () => {
  it('chunk splits into fixed sizes', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 500)).toEqual([]);
  });

  it('dedupeStudents keeps the last occurrence per national id, trims ids and drops empty ids', () => {
    const out = dedupeStudents([
      fakeStudent(1, { name: 'قديم' }),
      fakeStudent(2),
      { ...fakeStudent(1, { name: 'جديد' }), id: ' 1000000001 ' },
      fakeStudent(3, { id: '  ' }),
    ]);
    expect(out.map(s => s.id).sort()).toEqual(['1000000001', '1000000002']);
    expect(out.find(s => s.id === '1000000001')!.name).toBe('جديد');
  });

  it('student row round-trip keeps the full name and extra fields, and strips notes/passwords', () => {
    const s = fakeStudent(7, { nameEn: 'Test Student', phone2: '0590000002', previousYearGPA: '90', moodlePassword: 'fake-pw', notes: 'secret' });
    const row = studentToRow(s, OWNER);
    expect(row.national_id).toBe('1000000007');
    expect(row.class_name).toBe('العاشر');
    expect(row.owner).toBe(OWNER);
    expect(row.extra).toMatchObject({ nameEn: 'Test Student', phone2: '0590000002', previousYearGPA: '90' });
    expect(row.extra).not.toHaveProperty('moodlePassword');
    expect(row.extra).not.toHaveProperty('notes');
    const back = rowToStudent({ ...row, id: 'uuid' } as any);
    expect(back).toMatchObject({ id: '1000000007', name: s.name, nameEn: 'Test Student', phone2: '0590000002', previousYearGPA: '90' });
    expect(back.moodlePassword).toBeUndefined();
    expect(back.notes).toBeUndefined();
  });

  it('mergeIncomingStudent keeps omitted extra fields and never writes notes or passwords', () => {
    const existing = fakeStudent(1, { phone2: '0590000091', previousYearGPA: '88', section: 'ب', notes: 'old' });
    const incoming = fakeStudent(1, { name: 'طالب تجريبي معدل', phone: '0590000011' });
    delete (incoming as any).phone2;
    delete (incoming as any).previousYearGPA;
    delete (incoming as any).section;
    const merged = mergeIncomingStudent(existing, { ...incoming, notes: 'new-notes', moodlePassword: 'pw' });
    expect(merged.phone2).toBe('0590000091');
    expect(merged.previousYearGPA).toBe('88');
    expect(merged.section).toBe('ب');
    expect(merged.name).toBe('طالب تجريبي معدل');
    expect(merged.phone).toBe('0590000011');
    expect(merged.notes).toBe('old'); // existing kept; incoming notes ignored
    expect(merged.moodlePassword).toBeUndefined();
  });

  it('message row round-trip', () => {
    const l = fakeLog(1, { channel: 'gateway', failureReason: undefined });
    const back = rowToLog({ ...logToRow(l, OWNER, 'c1', null) });
    expect(back).toMatchObject({ ...l, campaignId: 'c1' });
  });

  it('prepareLogs groups logs without a known campaign into one immediate campaign and assigns UUIDs', () => {
    const known = '11111111-1111-4111-8111-111111111111';
    const { logs, immediateCampaign } = prepareLogs([fakeLog(1), fakeLog(2), fakeLog(3, { campaignId: known })], new Set([known]));
    expect(immediateCampaign).not.toBeNull();
    expect(logs[0].campaignId).toBe(immediateCampaign!.id);
    expect(logs[1].campaignId).toBe(immediateCampaign!.id);
    expect(logs[2].campaignId).toBe(known);
    expect(logs.every(l => isUuid(l.id))).toBe(true);
  });

  it('repoErrorMessage is Arabic for each kind', () => {
    expect(repoErrorMessage(new RepoError('offline', 'x'))).toMatch(/الإنترنت|الاتصال/);
    expect(repoErrorMessage(new RepoError('auth', 'x'))).toMatch(/الجلسة|الدخول/);
  });
});

describe('InMemorySchoolRepository', () => {
  it('imports in chunks of 500 and dedupes by national id', async () => {
    const repo = new InMemorySchoolRepository();
    const progress: number[] = [];
    const list = [...fakeStudents(1200), ...fakeStudents(10)]; // 10 duplicates
    const n = await repo.upsertStudents(list, done => progress.push(done));
    expect(UPSERT_CHUNK_SIZE).toBe(500);
    expect(n).toBe(1200);
    expect(repo.studentBatches).toEqual([500, 500, 200]);
    expect(progress).toEqual([500, 1000, 1200]);
    expect((await repo.loadAll()).students).toHaveLength(1200);
    await repo.upsertStudents([fakeStudent(1, { name: 'طالب تجريبي معدل' })]);
    const all = (await repo.loadAll()).students;
    expect(all).toHaveLength(1200);
    expect(all.find(s => s.id === '1000000001')!.name).toBe('طالب تجريبي معدل');
  });

  it('merges extra on upsert so omitted phone2/GPA survive, and strips notes/passwords', async () => {
    const repo = new InMemorySchoolRepository({
      students: [fakeStudent(1, { phone2: '0590000091', previousYearGPA: '91', notes: 'x' })],
    });
    const incoming = fakeStudent(1, { name: 'طالب تجريبي معدل', phone: '0590000011' });
    delete (incoming as any).phone2;
    await repo.upsertStudents([incoming]);
    const s = (await repo.loadAll()).students.find(x => x.id === '1000000001')!;
    expect(s.name).toBe('طالب تجريبي معدل');
    expect(s.phone).toBe('0590000011');
    expect(s.phone2).toBe('0590000091');
    expect(s.previousYearGPA).toBe('91');
    expect(s.notes).toBe('x');
  });

  it('insertStudent adds one row and refuses a duplicate id', async () => {
    const repo = new InMemorySchoolRepository({ students: fakeStudents(2) });
    await repo.insertStudent(fakeStudent(99, { name: 'طالب تجريبي جديد' }));
    expect((await repo.loadAll()).students).toHaveLength(3);
    await expect(repo.insertStudent(fakeStudent(1))).rejects.toMatchObject({ kind: 'other', message: 'duplicate' });
    expect((await repo.loadAll()).students).toHaveLength(3);
  });

  it('deletes, logs with hidden immediate campaign, clearLogs, failNext', async () => {
    const repo = new InMemorySchoolRepository({ students: fakeStudents(3) });
    await repo.deleteStudents(['1000000002']);
    expect((await repo.loadAll()).students.map(s => s.id)).toEqual(['1000000001', '1000000003']);
    const stored = await repo.addLogs([fakeLog(1)]);
    const data = await repo.loadAll();
    expect(data.logs).toHaveLength(1);
    expect(data.campaigns).toHaveLength(0); // immediate campaign hidden from the scheduler
    expect(stored[0].campaignId).toBeTruthy();
    await repo.clearLogs();
    expect((await repo.loadAll()).logs).toHaveLength(0);
    expect(repo.campaigns.size).toBe(0);
    repo.failNext = 'auth';
    await expect(repo.loadAll()).rejects.toMatchObject({ kind: 'auth' });
    await repo.deleteAllStudents();
    expect((await repo.loadAll()).students).toHaveLength(0);
  });
});

/** Minimal fake of the supabase-js query builder recording calls. */
function fakeSupabase(opts: { error?: any; selectError?: any; existing?: any[] } = {}) {
  const calls: any[] = [];
  const sb: any = {
    from(table: string) {
      const q: any = {
        select(cols: string) {
          calls.push({ table, op: 'select', cols });
          return q;
        },
        eq(col: string, val: string) { calls.push({ table, op: 'eq', col, val }); return q; },
        in(col: string, vals: string[]) {
          calls.push({ table, op: 'in', col, vals });
          const data = (opts.existing ?? []).filter((r: any) => vals.includes(r.national_id));
          return Promise.resolve({ data, error: opts.selectError ?? null });
        },
        upsert(rows: any[], o: any) {
          calls.push({ table, op: 'upsert', rows, onConflict: o?.onConflict });
          return {
            select: async () => ({ data: rows.map((r: any, i: number) => ({ id: `uuid-${r.national_id}-${i}`, national_id: r.national_id })), error: opts.error ?? null }),
            then: (res: any) => res({ error: opts.error ?? null }),
          };
        },
        insert(row: any) {
          calls.push({ table, op: 'insert', row });
          return {
            select: async () => ({ data: [{ id: 'uuid-new', national_id: row.national_id }], error: opts.error ?? null }),
          };
        },
      };
      return q;
    },
  };
  return { sb, calls };
}

describe('SupabaseSchoolRepository', () => {
  it('upserts students in chunks of 500 with on_conflict owner,national_id and dedupe', async () => {
    const { sb, calls } = fakeSupabase();
    const repo = new SupabaseSchoolRepository(sb, OWNER);
    const n = await repo.upsertStudents([...fakeStudents(1001), fakeStudent(5)]);
    expect(n).toBe(1001);
    const upserts = calls.filter(c => c.op === 'upsert');
    expect(upserts.map(c => c.rows.length)).toEqual([500, 500, 1]);
    expect(upserts.every(c => c.table === 'students' && c.onConflict === 'owner,national_id')).toBe(true);
    expect(calls.flatMap(c => c.rows).filter((r: any) => r && r.owner).every((r: any) => r.owner === OWNER)).toBe(true);
    expect(calls.some(c => c.op === 'in')).toBe(true);
  });

  it('merges existing extra (phone2/GPA) on supabase upsert and never writes notes or passwords', async () => {
    const existing = [{
      id: 'uuid-1',
      national_id: '1000000001',
      name: 'طالب تجريبي 1',
      parent_name: 'ولي أمر تجريبي',
      phone: '0590000001',
      class_name: 'العاشر',
      extra: { phone2: '0590000091', previousYearGPA: '91', section: 'أ', notes: 'old' },
    }];
    const { sb, calls } = fakeSupabase({ existing });
    const repo = new SupabaseSchoolRepository(sb, OWNER);
    const incoming = fakeStudent(1, { name: 'طالب تجريبي معدل', phone: '0590000011', notes: 'new', moodlePassword: 'pw' });
    delete (incoming as any).phone2;
    await repo.upsertStudents([incoming]);
    const upserts = calls.filter(c => c.op === 'upsert');
    expect(upserts).toHaveLength(1);
    const row = upserts[0].rows[0];
    expect(row.extra.phone2).toBe('0590000091');
    expect(row.extra.previousYearGPA).toBe('91');
    expect(row.name).toBe('طالب تجريبي معدل');
    expect(row.phone).toBe('0590000011');
    expect(row.extra.notes).toBe('old');
    expect(row.extra).not.toHaveProperty('moodlePassword');
  });

  it('maps a PostgREST permission error to an auth RepoError', async () => {
    const { sb } = fakeSupabase({ error: { code: '42501', message: 'permission denied' } });
    const repo = new SupabaseSchoolRepository(sb, OWNER);
    await expect(repo.upsertStudents(fakeStudents(2))).rejects.toMatchObject({ kind: 'auth' });
  });
});

describe('updateStudent', () => {
  const patch = { name: 'طالب تجريبي معدل', grade: 'التاسع', section: 'ج', phone: '', phone2: '0590000077' };

  it('in-memory: updates one student only, keeps notes and count', async () => {
    const students = fakeStudents(4).map(s => ({ ...s, notes: 'ملاحظة تجريبية' }));
    const repo = new InMemorySchoolRepository({ students });
    await repo.updateStudent(students[1].id, patch);
    const after = (await repo.loadAll()).students;
    expect(after).toHaveLength(4);
    expect(after.find(s => s.id === students[1].id)).toEqual({ ...students[1], ...patch });
    for (const s of [students[0], students[2], students[3]]) expect(after.find(x => x.id === s.id)).toEqual(s);
    await expect(repo.updateStudent('9999999999', patch)).rejects.toMatchObject({ kind: 'other' });
    expect((await repo.loadAll()).students).toHaveLength(4);
  });

  function fakeUpdateSb(existing: Record<string, unknown> | null, updatedCount = 1) {
    const calls: any[] = [];
    const sb: any = {
      from(table: string) {
        const filters: any[] = [];
        const q: any = {
          select(cols: string) {
            calls.push({ table, op: 'select', cols, filters });
            return q;
          },
          eq(col: string, val: string) { filters.push([col, val]); return q; },
          maybeSingle: async () => ({ data: existing ? { extra: existing } : null, error: null }),
          update(patch: any) {
            const u = { table, op: 'update', patch, filters: [] as any[] };
            calls.push(u);
            const uq: any = {
              eq(col: string, val: string) { u.filters.push([col, val]); return uq; },
              select: async () => ({ data: Array.from({ length: updatedCount }, () => ({ id: 'x' })), error: null }),
            };
            return uq;
          },
        };
        return q;
      },
    };
    return { sb, calls };
  }

  it('supabase: one UPDATE scoped by owner + national_id, merges section/phone2 into extra and keeps notes', async () => {
    const { sb, calls } = fakeUpdateSb({ section: 'أ', phone2: '', notes: 'ملاحظة تجريبية', nameEn: 'Test' });
    const repo = new SupabaseSchoolRepository(sb, OWNER);
    await repo.updateStudent(' 1000000001 ', patch);
    const updates = calls.filter(c => c.op === 'update');
    expect(updates).toHaveLength(1);
    expect(calls.some(c => c.op === 'upsert' || c.op === 'insert' || c.op === 'delete')).toBe(false);
    expect(updates[0].table).toBe('students');
    expect(updates[0].filters).toEqual([['owner', OWNER], ['national_id', '1000000001']]);
    expect(updates[0].patch).toMatchObject({
      name: patch.name, phone: '', class_name: 'التاسع',
      extra: { section: 'ج', phone2: '0590000077', notes: 'ملاحظة تجريبية', nameEn: 'Test' },
    });
    expect(Object.keys(updates[0].patch).sort()).toEqual(['class_name', 'extra', 'name', 'phone', 'updated_at']);
  });

  it('supabase: missing student or unexpected row count is an error (never inserts)', async () => {
    await expect(new SupabaseSchoolRepository(fakeUpdateSb(null).sb, OWNER).updateStudent('1000000001', patch)).rejects.toMatchObject({ kind: 'other' });
    await expect(new SupabaseSchoolRepository(fakeUpdateSb({}, 0).sb, OWNER).updateStudent('1000000001', patch)).rejects.toMatchObject({ kind: 'other' });
  });
});

describe('recipient groups in the repository', () => {
  it('in-memory: save / reload / delete a group', async () => {
    const repo = new InMemorySchoolRepository();
    const group = buildRecipientGroup('غير الداخلين — تجريبي', ['1000000001', '9999999999']);
    await repo.upsertRecipientGroups([group]);
    const listed = await repo.listRecipientGroups();
    expect(listed).toHaveLength(1);
    expect(listed[0].title).toBe('غير الداخلين — تجريبي');
    await repo.deleteRecipientGroup(group.id);
    expect(await repo.listRecipientGroups()).toHaveLength(0);
  });

  it('supabase: falls back to localStorage when the table is missing', async () => {
    localStorage.removeItem(LOCAL_GROUPS_KEY);
    const sb: any = {
      from(table: string) {
        const err = { code: 'PGRST205', message: 'Could not find the table \'public.recipient_groups\' in the schema cache' };
        const q: any = {
          select: () => q,
          order: async () => ({ data: null, error: table === 'recipient_groups' ? err : null }),
          upsert: async () => ({ error: err }),
          delete: () => ({ eq: async () => ({ error: err }) }),
        };
        return q;
      },
    };
    const repo = new SupabaseSchoolRepository(sb, OWNER);
    const group = buildRecipientGroup('مجموعة محلية', ['1000000001']);
    await repo.upsertRecipientGroups([group]);
    const listed = await repo.listRecipientGroups();
    expect(listed.map(g => g.title)).toEqual(['مجموعة محلية']);
    expect(JSON.parse(localStorage.getItem(LOCAL_GROUPS_KEY) || '[]')[0].title).toBe('مجموعة محلية');
    localStorage.removeItem(LOCAL_GROUPS_KEY);
  });
});

describe('Moodle credentials and section events (memory repo)', () => {
  it('stores credentials separately from students and never puts them on the student row', async () => {
    const repo = new InMemorySchoolRepository({ students: [fakeStudent(1)] });
    await repo.upsertMoodleCredentials([
      { nationalId: '1000000001', moodleUsername: 'fake.user01', moodlePassword: 'Fake#Pass-0001' },
    ]);
    const data = await repo.loadAll();
    expect(data.students[0].moodlePassword).toBeUndefined();
    expect(data.students[0].moodleUsername).toBeUndefined();
    const listed = await repo.listMoodleCredentials();
    expect(listed.available).toBe(true);
    expect(listed.rows[0].moodleUsername).toBe('fake.user01');
  });

  it('reports the store as unavailable and refuses to write when the table is not applied', async () => {
    const repo = new InMemorySchoolRepository();
    repo.credentialsAvailable = false;
    const listed = await repo.listMoodleCredentials();
    expect(listed).toEqual({ available: false, rows: [] });
    await expect(repo.upsertMoodleCredentials([
      { nationalId: '1000000001', moodleUsername: 'x', moodlePassword: 'y' },
    ])).rejects.toMatchObject({ message: 'credentials_unavailable' });
  });

  it('round-trips section events without touching students', async () => {
    const repo = new InMemorySchoolRepository({ students: [fakeStudent(1)] });
    await repo.upsertSectionEvents([{
      id: '44444444-4444-4444-8444-444444444444',
      grade: 'رابع', section: 'أ', type: 'quiz', title: 'اختبار تجريبي',
      closeAt: '', closeLabel: 'الخميس', url: 'https://mhzcis.github.io/moodle-quiz-launcher/?id=111111',
      duration: '30 دقيقة', attempts: 'محاولة واحدة', updatedAt: '2026-11-18T10:00:00.000Z',
    }]);
    const data = await repo.loadAll();
    expect(data.sectionEvents).toHaveLength(1);
    expect(data.sectionEvents![0].title).toBe('اختبار تجريبي');
    expect(data.students).toHaveLength(1);
  });
});

describe('rowToStudent strips leftover credential keys from extra', () => {
  it('does not expose moodlePassword on the Student object', () => {
    const s = rowToStudent({
      national_id: '1000000001',
      name: 'طالب تجريبي 1',
      parent_name: 'ولي أمر تجريبي',
      phone: '0590000001',
      class_name: 'عاشر',
      extra: { section: 'أ', moodlePassword: 'Fake#Pass-0001', moodleUsername: 'fake.user01', notes: 'لا' },
    });
    expect(s.section).toBe('أ');
    expect(s.moodlePassword).toBeUndefined();
    expect(s.moodleUsername).toBeUndefined();
    expect(s.notes).toBeUndefined();
  });
});

describe('scheduler settings (memory repo)', () => {
  it('stays unavailable by default and refuses to enable until marked available', async () => {
    const repo = new InMemorySchoolRepository();
    const s = await repo.getSchedulerSettings();
    expect(s).toEqual({ available: false, enabled: false, maxPerRun: 50 });
    await expect(repo.upsertSchedulerSettings({ enabled: true })).rejects.toMatchObject({ message: 'scheduler_unavailable' });
  });

  it('can enable and disable only after the store is available', async () => {
    const repo = new InMemorySchoolRepository();
    repo.schedulerSettings = { available: true, enabled: false, maxPerRun: 50 };
    await repo.upsertSchedulerSettings({ enabled: true, maxPerRun: 20 });
    expect(await repo.getSchedulerSettings()).toEqual({ available: true, enabled: true, maxPerRun: 20 });
    await repo.upsertSchedulerSettings({ enabled: false, maxPerRun: 20 });
    expect((await repo.getSchedulerSettings()).enabled).toBe(false);
  });
});
