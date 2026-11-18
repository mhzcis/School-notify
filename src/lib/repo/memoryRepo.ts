import { mergeState } from '../../../supabase/functions/school-notify-sms-webhook/webhook';
/**
 * In-memory SchoolRepository fake for tests. Mirrors the Supabase semantics that matter:
 * dedupe by national id, chunked upserts (recorded in `studentBatches`), immediate campaigns.
 */
import type { MessageLog, MessageTemplate, ScheduledMessage, Student } from '../../types';
import type { StudentEditPatch } from '../studentEdit';
import { chunk, dedupeStudents, mergeIncomingStudent, prepareLogs } from './mapping';
import { AppData, ProgressFn, RepoError, SchoolRepository, UPSERT_CHUNK_SIZE, GatewayLogUpdate } from './types';
import { parseGroups, type RecipientGroup } from '../recipientGroups';

export class InMemorySchoolRepository implements SchoolRepository {
  students = new Map<string, Student>();
  templates = new Map<string, MessageTemplate>();
  campaigns = new Map<string, ScheduledMessage & { kind?: string }>();
  logs = new Map<string, MessageLog>();
  groups = new Map<string, RecipientGroup>();
  /** Sizes of each student upsert request (to assert chunking). */
  studentBatches: number[] = [];
  /** When set, the next call throws this error kind. */
  failNext: RepoError['kind'] | null = null;

  constructor(seed?: Partial<AppData>) {
    seed?.students?.forEach(s => this.students.set(s.id, { ...s }));
    seed?.templates?.forEach(t => this.templates.set(t.id, { ...t }));
    seed?.campaigns?.forEach(c => this.campaigns.set(c.id, { ...c, kind: 'scheduled' }));
    seed?.logs?.forEach(l => this.logs.set(l.id, { ...l }));
    seed?.groups?.forEach(g => this.groups.set(g.id, { ...g, studentNationalIds: [...g.studentNationalIds] }));
  }

  private maybeFail() {
    if (this.failNext) {
      const k = this.failNext;
      this.failNext = null;
      throw new RepoError(k, k);
    }
  }

  async loadAll(): Promise<AppData> {
    this.maybeFail();
    return {
      students: [...this.students.values()].map(s => ({ ...s })),
      templates: [...this.templates.values()].map(t => ({ ...t })),
      campaigns: [...this.campaigns.values()].filter(c => c.kind !== 'immediate').map(({ kind: _k, ...c }) => ({ ...c })),
      logs: [...this.logs.values()].map(l => ({ ...l })),
      campaignFlags: [...this.campaigns.values()].map(c => ({
        id: c.id,
        title: c.title,
        isTest: Boolean(c.isTest),
        archived: Boolean(c.archived),
        kind: c.kind,
      })),
      groups: [...this.groups.values()].map(g => ({ ...g, studentNationalIds: [...g.studentNationalIds] })),
    };
  }

  async upsertStudents(students: Student[], onProgress?: ProgressFn): Promise<number> {
    this.maybeFail();
    const unique = dedupeStudents(students);
    let done = 0;
    for (const batch of chunk(unique, UPSERT_CHUNK_SIZE)) {
      this.studentBatches.push(batch.length);
      batch.forEach(s => {
        const key = String(s.id).trim();
        this.students.set(key, mergeIncomingStudent(this.students.get(key), { ...s, id: key }));
      });
      done += batch.length;
      onProgress?.(done, unique.length);
    }
    return done;
  }

  async insertStudent(student: Student): Promise<void> {
    this.maybeFail();
    const key = String(student.id).trim();
    if (!key) throw new RepoError('other', 'not_found');
    if (this.students.has(key)) throw new RepoError('other', 'duplicate');
    this.students.set(key, mergeIncomingStudent(undefined, { ...student, id: key }));
  }

  async updateStudent(id: string, patch: StudentEditPatch): Promise<void> {
    this.maybeFail();
    const key = String(id).trim();
    const cur = this.students.get(key);
    if (!cur) throw new RepoError('other', 'not_found');
    this.students.set(key, { ...cur, name: patch.name, grade: patch.grade, section: patch.section, phone: patch.phone, phone2: patch.phone2 });
  }

  async deleteStudents(ids: string[]): Promise<void> {
    this.maybeFail();
    ids.forEach(id => this.students.delete(String(id).trim()));
  }

  async deleteAllStudents(): Promise<void> {
    this.maybeFail();
    this.students.clear();
  }

  async upsertTemplates(templates: MessageTemplate[]): Promise<void> {
    this.maybeFail();
    templates.forEach(t => this.templates.set(t.id, { ...t }));
  }

  async deleteTemplate(id: string): Promise<void> {
    this.maybeFail();
    this.templates.delete(id);
  }

  async upsertCampaigns(campaigns: ScheduledMessage[]): Promise<void> {
    this.maybeFail();
    campaigns.forEach(c => {
      const prev = this.campaigns.get(c.id);
      this.campaigns.set(c.id, { ...prev, ...c, kind: prev?.kind ?? 'scheduled' });
    });
  }

  async updateCampaignFlags(id: string, flags: { isTest?: boolean; archived?: boolean }): Promise<void> {
    this.maybeFail();
    const cur = this.campaigns.get(id);
    if (!cur) throw new RepoError('other', 'not_found');
    this.campaigns.set(id, {
      ...cur,
      isTest: flags.isTest !== undefined ? flags.isTest : cur.isTest,
      archived: flags.archived !== undefined ? flags.archived : cur.archived,
    });
  }

  async addLogs(logs: MessageLog[]): Promise<MessageLog[]> {
    this.maybeFail();
    if (!logs.length) return [];
    const { logs: prepared, immediateCampaign } = prepareLogs(logs, new Set(this.campaigns.keys()));
    const isTest = prepared.some(l => l.isTest);
    if (immediateCampaign) {
      this.campaigns.set(immediateCampaign.id, {
        id: immediateCampaign.id,
        title: 'إرسال فوري',
        contentTemplate: immediateCampaign.body,
        targetType: 'custom',
        scheduledTime: new Date().toISOString(),
        status: 'completed',
        createdAt: new Date().toISOString(),
        totalRecipients: prepared.length,
        kind: 'immediate',
        isTest: isTest || undefined,
      });
    }
    prepared.forEach(l => this.logs.set(l.id, { ...l, isTest: l.isTest || isTest || undefined }));
    return prepared;
  }

  async clearLogs(): Promise<void> {
    this.maybeFail();
    this.logs.clear();
    for (const [id, c] of this.campaigns) if (c.kind === 'immediate') this.campaigns.delete(id);
  }

  async updateGatewayStates(updates: GatewayLogUpdate[]): Promise<string[]> {
    this.maybeFail();
    const done: string[] = [];
    for (const u of updates) {
      const cur = this.logs.get(u.logId);
      if (!cur || !u.gatewayState || !mergeState(cur.gatewayState, u.gatewayState)) continue;
      this.logs.set(u.logId, { ...cur, gatewayState: u.gatewayState, status: u.status, ...(u.failureReason ? { failureReason: u.failureReason } : {}) });
      done.push(u.logId);
    }
    return done;
  }

  async listRecipientGroups(): Promise<RecipientGroup[]> {
    this.maybeFail();
    return [...this.groups.values()].map(g => ({ ...g, studentNationalIds: [...g.studentNationalIds] }));
  }

  async upsertRecipientGroups(groups: RecipientGroup[]): Promise<void> {
    this.maybeFail();
    for (const g of parseGroups(groups)) this.groups.set(g.id, { ...g, studentNationalIds: [...g.studentNationalIds] });
  }

  async deleteRecipientGroup(id: string): Promise<void> {
    this.maybeFail();
    this.groups.delete(id);
  }
}
