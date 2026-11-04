/**
 * In-memory SchoolRepository fake for tests. Mirrors the Supabase semantics that matter:
 * dedupe by national id, chunked upserts (recorded in `studentBatches`), immediate campaigns.
 */
import type { MessageLog, MessageTemplate, ScheduledMessage, Student } from '../../types';
import { chunk, dedupeStudents, prepareLogs } from './mapping';
import { AppData, ProgressFn, RepoError, SchoolRepository, UPSERT_CHUNK_SIZE } from './types';

export class InMemorySchoolRepository implements SchoolRepository {
  students = new Map<string, Student>();
  templates = new Map<string, MessageTemplate>();
  campaigns = new Map<string, ScheduledMessage & { kind?: string }>();
  logs = new Map<string, MessageLog>();
  /** Sizes of each student upsert request (to assert chunking). */
  studentBatches: number[] = [];
  /** When set, the next call throws this error kind. */
  failNext: RepoError['kind'] | null = null;

  constructor(seed?: Partial<AppData>) {
    seed?.students?.forEach(s => this.students.set(s.id, { ...s }));
    seed?.templates?.forEach(t => this.templates.set(t.id, { ...t }));
    seed?.campaigns?.forEach(c => this.campaigns.set(c.id, { ...c, kind: 'scheduled' }));
    seed?.logs?.forEach(l => this.logs.set(l.id, { ...l }));
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
    };
  }

  async upsertStudents(students: Student[], onProgress?: ProgressFn): Promise<number> {
    this.maybeFail();
    const unique = dedupeStudents(students);
    let done = 0;
    for (const batch of chunk(unique, UPSERT_CHUNK_SIZE)) {
      this.studentBatches.push(batch.length);
      batch.forEach(s => this.students.set(s.id, { ...s }));
      done += batch.length;
      onProgress?.(done, unique.length);
    }
    return done;
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
    campaigns.forEach(c => this.campaigns.set(c.id, { ...c, kind: 'scheduled' }));
  }

  async addLogs(logs: MessageLog[]): Promise<MessageLog[]> {
    this.maybeFail();
    if (!logs.length) return [];
    const { logs: prepared, immediateCampaign } = prepareLogs(logs, new Set(this.campaigns.keys()));
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
      });
    }
    prepared.forEach(l => this.logs.set(l.id, { ...l }));
    return prepared;
  }

  async clearLogs(): Promise<void> {
    this.maybeFail();
    this.logs.clear();
    for (const [id, c] of this.campaigns) if (c.kind === 'immediate') this.campaigns.delete(id);
  }
}
