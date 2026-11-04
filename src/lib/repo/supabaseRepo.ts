/**
 * Supabase implementation of SchoolRepository (schema `school_notify`, RLS-protected).
 * Every row carries owner = the signed-in user id; RLS enforces owner = auth.uid() AND is_allowed().
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MessageLog, MessageTemplate, ScheduledMessage, Student } from '../../types';
import { isNetworkError } from '../../auth/authService';
import {
  CampaignRow,
  MessageRow,
  StudentRow,
  TemplateRow,
  campaignToRow,
  chunk,
  dedupeStudents,
  logToRow,
  prepareLogs,
  rowToCampaign,
  rowToLog,
  rowToStudent,
  rowToTemplate,
  studentToRow,
  templateToRow,
} from './mapping';
import { AppData, ProgressFn, RepoError, SchoolRepository, UPSERT_CHUNK_SIZE } from './types';

const PAGE = 1000;

function toRepoError(err: any): RepoError {
  if (err instanceof RepoError) return err;
  if (isNetworkError(err)) return new RepoError('offline', 'network');
  const code = String(err?.code ?? '');
  const status = Number(err?.status ?? 0);
  if (code === 'PGRST301' || code === 'PGRST302' || code === '42501' || status === 401 || status === 403 || /jwt/i.test(String(err?.message ?? ''))) {
    return new RepoError('auth', code || 'auth');
  }
  // Never include row data in the message.
  return new RepoError('other', code || 'db_error');
}

export class SupabaseSchoolRepository implements SchoolRepository {
  private studentUuidByNationalId = new Map<string, string>();
  private campaignIds = new Set<string>();

  constructor(private sb: SupabaseClient<any, any, any>, private owner: string) {}

  private async selectAll<T>(table: string, columns: string): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.sb
        .from(table)
        .select(columns)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw toRepoError(error);
      out.push(...((data ?? []) as T[]));
      if (!data || data.length < PAGE) break;
    }
    return out;
  }

  async loadAll(): Promise<AppData> {
    try {
      const [students, templates, campaigns, messages] = await Promise.all([
        this.selectAll<StudentRow>('students', 'id,national_id,name,parent_name,phone,class_name,extra'),
        this.selectAll<TemplateRow>('templates', 'id,title,body,category'),
        this.selectAll<CampaignRow>('campaigns', 'id,title,body,status,meta,created_at'),
        this.selectAll<MessageRow>('messages', 'id,campaign_id,student_id,phone,body,status,error,sent_at,meta'),
      ]);
      this.studentUuidByNationalId = new Map(students.filter(r => r.id).map(r => [r.national_id, r.id as string]));
      this.campaignIds = new Set(campaigns.map(c => c.id));
      return {
        students: students.map(rowToStudent),
        templates: templates.map(rowToTemplate),
        campaigns: campaigns.filter(c => (c.meta as any)?.kind !== 'immediate').map(rowToCampaign),
        logs: messages.map(rowToLog).sort((a, b) => (a.sentTime < b.sentTime ? 1 : a.sentTime > b.sentTime ? -1 : 0)),
      };
    } catch (err) {
      throw toRepoError(err);
    }
  }

  async upsertStudents(students: Student[], onProgress?: ProgressFn): Promise<number> {
    const unique = dedupeStudents(students);
    const batches = chunk(unique, UPSERT_CHUNK_SIZE);
    let done = 0;
    try {
      for (const batch of batches) {
        const rows = batch.map(s => studentToRow(s, this.owner));
        const { data, error } = await this.sb
          .from('students')
          .upsert(rows, { onConflict: 'owner,national_id' })
          .select('id,national_id');
        if (error) throw toRepoError(error);
        for (const r of (data ?? []) as { id: string; national_id: string }[]) this.studentUuidByNationalId.set(r.national_id, r.id);
        done += batch.length;
        onProgress?.(done, unique.length);
      }
    } catch (err) {
      throw toRepoError(err);
    }
    return done;
  }

  async deleteStudents(ids: string[]): Promise<void> {
    const keys = [...new Set(ids.map(i => String(i).trim()).filter(Boolean))];
    try {
      for (const batch of chunk(keys, 200)) {
        const { error } = await this.sb.from('students').delete().eq('owner', this.owner).in('national_id', batch);
        if (error) throw toRepoError(error);
        batch.forEach(k => this.studentUuidByNationalId.delete(k));
      }
    } catch (err) {
      throw toRepoError(err);
    }
  }

  async deleteAllStudents(): Promise<void> {
    const { error } = await this.sb.from('students').delete().eq('owner', this.owner);
    if (error) throw toRepoError(error);
    this.studentUuidByNationalId.clear();
  }

  async upsertTemplates(templates: MessageTemplate[]): Promise<void> {
    if (!templates.length) return;
    try {
      for (const batch of chunk(templates, UPSERT_CHUNK_SIZE)) {
        const { error } = await this.sb.from('templates').upsert(batch.map(t => templateToRow(t, this.owner)), { onConflict: 'id' });
        if (error) throw toRepoError(error);
      }
    } catch (err) {
      throw toRepoError(err);
    }
  }

  async deleteTemplate(id: string): Promise<void> {
    const { error } = await this.sb.from('templates').delete().eq('id', id);
    if (error) throw toRepoError(error);
  }

  async upsertCampaigns(campaigns: ScheduledMessage[]): Promise<void> {
    if (!campaigns.length) return;
    try {
      for (const batch of chunk(campaigns, UPSERT_CHUNK_SIZE)) {
        const { error } = await this.sb.from('campaigns').upsert(batch.map(c => campaignToRow(c, this.owner)), { onConflict: 'id' });
        if (error) throw toRepoError(error);
        batch.forEach(c => this.campaignIds.add(c.id));
      }
    } catch (err) {
      throw toRepoError(err);
    }
  }

  async addLogs(logs: MessageLog[]): Promise<MessageLog[]> {
    if (!logs.length) return [];
    const { logs: prepared, immediateCampaign } = prepareLogs(logs, this.campaignIds);
    try {
      if (immediateCampaign) {
        const { error } = await this.sb.from('campaigns').insert({
          id: immediateCampaign.id,
          owner: this.owner,
          title: 'إرسال فوري',
          body: immediateCampaign.body,
          status: 'completed',
          meta: { kind: 'immediate' },
        });
        if (error) throw toRepoError(error);
        this.campaignIds.add(immediateCampaign.id);
      }
      for (const batch of chunk(prepared, UPSERT_CHUNK_SIZE)) {
        const rows = batch.map(l =>
          logToRow(l, this.owner, l.campaignId as string, this.studentUuidByNationalId.get(String(l.studentId)) ?? null)
        );
        const { error } = await this.sb.from('messages').upsert(rows, { onConflict: 'id' });
        if (error) throw toRepoError(error);
      }
    } catch (err) {
      throw toRepoError(err);
    }
    return prepared;
  }

  async clearLogs(): Promise<void> {
    const { error } = await this.sb.from('messages').delete().eq('owner', this.owner);
    if (error) throw toRepoError(error);
    // Immediate-send grouping rows have no other purpose once their messages are gone.
    const { error: e2 } = await this.sb.from('campaigns').delete().eq('owner', this.owner).eq('meta->>kind', 'immediate');
    if (e2) throw toRepoError(e2);
  }
}
