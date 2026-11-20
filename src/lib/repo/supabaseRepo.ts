/**
 * Supabase implementation of SchoolRepository (schema `school_notify`, RLS-protected).
 * Every row carries owner = the signed-in user id; RLS enforces owner = auth.uid() AND is_allowed().
 */
import { parseSuppressed, type SuppressedPhone } from '../suppression';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MessageLog, MessageTemplate, ScheduledMessage, Student } from '../../types';
import { isNetworkError } from '../../auth/authService';
import {
  CampaignRow,
  MessageRow,
  StudentRow,
  TemplateRow,
  campaignFlagsFromRow,
  forbiddenExtraFromRow,
  campaignToRow,
  chunk,
  dedupeStudents,
  logToRow,
  mergeIncomingStudent,
  prepareLogs,
  rowToCampaign,
  rowToLog,
  rowToStudent,
  rowToTemplate,
  studentToRow,
  templateToRow,
} from './mapping';
import { AppData, GatewayLogUpdate, ProgressFn, RepoError, SchoolRepository, UPSERT_CHUNK_SIZE } from './types';
import type { StudentEditPatch } from '../studentEdit';
import { mergeState } from '../../../supabase/functions/school-notify-sms-webhook/webhook';
import {
  deleteLocalGroup,
  isMissingRelationError,
  parseGroups,
  readLocalGroups,
  writeLocalGroups,
  type RecipientGroup,
} from '../recipientGroups';
import type { MoodleCredential } from '../moodleCredentials';
import {
  parseSectionEvents,
  readLocalSectionEvents,
  writeLocalSectionEvents,
  type SectionEvent,
} from '../sectionEvents';
import { DEFAULT_MAX_PER_RUN, defaultSchedulerSettings, type SchedulerSettings } from '../scheduledSend';

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

  /** 'unknown' until the first groups call; then 'cloud' or 'local' for the rest of the session. */
  private groupsMode: 'unknown' | 'cloud' | 'local' = 'unknown';

  private useLocalGroups(): boolean {
    return this.groupsMode === 'local';
  }

  private markGroupsLocal(): void {
    this.groupsMode = 'local';
  }

  private groupToRow(g: RecipientGroup) {
    return {
      id: g.id,
      owner: this.owner,
      title: g.title,
      student_national_ids: g.studentNationalIds,
      created_at: g.createdAt || new Date().toISOString(),
      updated_at: g.updatedAt || new Date().toISOString(),
    };
  }

  private rowToGroup(r: { id: string; title: string; student_national_ids: unknown; created_at?: string; updated_at?: string }): RecipientGroup {
    return parseGroups([{
      id: r.id,
      title: r.title,
      studentNationalIds: Array.isArray(r.student_national_ids) ? r.student_national_ids.map(String) : [],
      createdAt: r.created_at || '',
      updatedAt: r.updated_at || r.created_at || '',
    }])[0];
  }

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
      let groups: RecipientGroup[] = [];
      try {
        groups = await this.listRecipientGroups();
      } catch {
        groups = readLocalGroups();
      }
      let sectionEvents: SectionEvent[] = [];
      try {
        sectionEvents = await this.listSectionEvents();
      } catch {
        sectionEvents = readLocalSectionEvents();
      }
      return {
        students: students.map(rowToStudent),
        templates: templates.map(rowToTemplate),
        campaigns: campaigns.filter(c => (c.meta as any)?.kind !== 'immediate').map(rowToCampaign),
        logs: messages.map(rowToLog).sort((a, b) => (a.sentTime < b.sentTime ? 1 : a.sentTime > b.sentTime ? -1 : 0)),
        campaignFlags: campaigns.map(campaignFlagsFromRow),
        groups,
        sectionEvents,
      };
    } catch (err) {
      throw toRepoError(err);
    }
  }

  async upsertStudents(students: Student[], onProgress?: ProgressFn): Promise<number> {
    const unique = dedupeStudents(students);
    let done = 0;
    try {
      const existingById = new Map<string, Student>();
      const existingForbidden = new Map<string, Record<string, unknown>>();
      for (const idBatch of chunk(unique.map(s => s.id), 200)) {
        const { data, error } = await this.sb
          .from('students')
          .select('id,national_id,name,parent_name,phone,class_name,extra')
          .eq('owner', this.owner)
          .in('national_id', idBatch);
        if (error) throw toRepoError(error);
        for (const r of (data ?? []) as StudentRow[]) {
          existingById.set(r.national_id, rowToStudent(r));
          existingForbidden.set(r.national_id, forbiddenExtraFromRow(r));
          if (r.id) this.studentUuidByNationalId.set(r.national_id, r.id);
        }
      }
      const merged = unique.map(s => mergeIncomingStudent(existingById.get(s.id), s));
      for (const batch of chunk(merged, UPSERT_CHUNK_SIZE)) {
        const rows = batch.map(s => {
          const row = studentToRow(s, this.owner);
          const preserved = existingForbidden.get(s.id);
          if (preserved) {
            // Leftover keys stay in extra so a partial upsert does not wipe historical values;
            // they are never exposed on Student and never accepted from an incoming import.
            Object.assign(row.extra, preserved);
          }
          return row;
        });
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

  async insertStudent(student: Student): Promise<void> {
    const key = String(student.id).trim();
    if (!key) throw new RepoError('other', 'not_found');
    const row = studentToRow(mergeIncomingStudent(undefined, { ...student, id: key }), this.owner);
    try {
      const { data, error } = await this.sb.from('students').insert(row).select('id,national_id');
      if (error) {
        if (String((error as any).code) === '23505') throw new RepoError('other', 'duplicate');
        throw toRepoError(error);
      }
      const r = ((data ?? []) as { id: string; national_id: string }[])[0];
      if (r) this.studentUuidByNationalId.set(r.national_id, r.id);
    } catch (err) {
      throw toRepoError(err);
    }
  }

  async updateStudent(id: string, patch: StudentEditPatch): Promise<void> {
    const key = String(id).trim();
    if (!key) throw new RepoError('other', 'not_found');
    try {
      // Read the current extra jsonb so only section/phone2 change inside it (notes etc. stay as stored).
      const { data, error } = await this.sb
        .from('students')
        .select('extra')
        .eq('owner', this.owner)
        .eq('national_id', key)
        .maybeSingle();
      if (error) throw toRepoError(error);
      if (!data) throw new RepoError('other', 'not_found');
      const extra = { ...(((data as { extra: Record<string, unknown> | null }).extra ?? {}) as Record<string, unknown>) };
      extra.section = patch.section;
      extra.phone2 = patch.phone2;
      const { data: updated, error: upErr } = await this.sb
        .from('students')
        .update({ name: patch.name, phone: patch.phone, class_name: patch.grade, extra, updated_at: new Date().toISOString() })
        .eq('owner', this.owner)
        .eq('national_id', key)
        .select('id');
      if (upErr) throw toRepoError(upErr);
      if (!updated || (updated as unknown[]).length !== 1) throw new RepoError('other', 'update_count');
    } catch (err) {
      throw toRepoError(err);
    }
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

  async updateCampaignFlags(id: string, flags: { isTest?: boolean; archived?: boolean }): Promise<void> {
    try {
      const { data, error } = await this.sb.from('campaigns').select('meta').eq('id', id).maybeSingle();
      if (error) throw toRepoError(error);
      if (!data) throw new RepoError('other', 'not_found');
      const meta = { ...(((data as { meta: Record<string, unknown> | null }).meta ?? {}) as Record<string, unknown>) };
      if (flags.isTest !== undefined) meta.isTest = flags.isTest;
      if (flags.archived !== undefined) meta.archived = flags.archived;
      const { error: upErr } = await this.sb.from('campaigns').update({ meta }).eq('id', id);
      if (upErr) throw toRepoError(upErr);
    } catch (err) {
      throw toRepoError(err);
    }
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
        const isTest = prepared.some(l => l.isTest);
        const { error } = await this.sb.from('campaigns').insert({
          id: immediateCampaign.id,
          owner: this.owner,
          title: 'إرسال فوري',
          body: immediateCampaign.body,
          status: 'completed',
          meta: { kind: 'immediate', ...(isTest ? { isTest: true } : {}) },
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

  async updateGatewayStates(updates: GatewayLogUpdate[]): Promise<string[]> {
    const done: string[] = [];
    try {
      for (const u of updates) {
        if (!u.gatewayState) continue;
        const { data, error } = await this.sb.from('messages').select('meta').eq('id', u.logId).maybeSingle();
        if (error) throw toRepoError(error);
        if (!data) continue;
        const meta = ((data as { meta: Record<string, unknown> | null }).meta ?? {}) as Record<string, unknown>;
        if (!mergeState(meta.gatewayState as string | undefined, u.gatewayState)) continue;
        const patch: Record<string, unknown> = { status: u.status, meta: { ...meta, gatewayState: u.gatewayState } };
        if (u.failureReason) patch.error = u.failureReason;
        const { error: upErr } = await this.sb.from('messages').update(patch).eq('id', u.logId);
        if (upErr) throw toRepoError(upErr);
        done.push(u.logId);
      }
    } catch (err) {
      throw toRepoError(err);
    }
    return done;
  }

  async listRecipientGroups(): Promise<RecipientGroup[]> {
    if (this.useLocalGroups()) return readLocalGroups();
    try {
      const { data, error } = await this.sb
        .from('recipient_groups')
        .select('id,title,student_national_ids,created_at,updated_at')
        .order('created_at', { ascending: true });
      if (error) {
        if (isMissingRelationError(error)) {
          this.markGroupsLocal();
          return readLocalGroups();
        }
        throw toRepoError(error);
      }
      this.groupsMode = 'cloud';
      return parseGroups((data ?? []).map(r => this.rowToGroup(r as any)).filter(Boolean));
    } catch (err) {
      if (isMissingRelationError(err)) {
        this.markGroupsLocal();
        return readLocalGroups();
      }
      throw toRepoError(err);
    }
  }

  async upsertRecipientGroups(groups: RecipientGroup[]): Promise<void> {
    const list = parseGroups(groups);
    if (!list.length) return;
    if (this.useLocalGroups()) {
      const current = readLocalGroups();
      const map = new Map(current.map(g => [g.id, g]));
      for (const g of list) map.set(g.id, g);
      writeLocalGroups([...map.values()]);
      return;
    }
    try {
      const { error } = await this.sb.from('recipient_groups').upsert(list.map(g => this.groupToRow(g)), { onConflict: 'id' });
      if (error) {
        if (isMissingRelationError(error)) {
          this.markGroupsLocal();
          await this.upsertRecipientGroups(list);
          return;
        }
        throw toRepoError(error);
      }
      this.groupsMode = 'cloud';
    } catch (err) {
      if (isMissingRelationError(err)) {
        this.markGroupsLocal();
        await this.upsertRecipientGroups(list);
        return;
      }
      throw toRepoError(err);
    }
  }

  async deleteRecipientGroup(id: string): Promise<void> {
    if (this.useLocalGroups()) {
      deleteLocalGroup(id);
      return;
    }
    try {
      const { error } = await this.sb.from('recipient_groups').delete().eq('id', id);
      if (error) {
        if (isMissingRelationError(error)) {
          this.markGroupsLocal();
          deleteLocalGroup(id);
          return;
        }
        throw toRepoError(error);
      }
      this.groupsMode = 'cloud';
    } catch (err) {
      if (isMissingRelationError(err)) {
        this.markGroupsLocal();
        deleteLocalGroup(id);
        return;
      }
      throw toRepoError(err);
    }
  }

  // ----- Moodle credentials (no localStorage fallback) -----
  private credentialsMode: 'unknown' | 'cloud' | 'unavailable' = 'unknown';

  private credToRow(c: MoodleCredential) {
    return {
      owner: this.owner,
      national_id: c.nationalId,
      moodle_username: c.moodleUsername ?? '',
      moodle_password: c.moodlePassword ?? '',
      updated_at: new Date().toISOString(),
    };
  }

  private rowToCred(r: { national_id: string; moodle_username?: string; moodle_password?: string }): MoodleCredential {
    return {
      nationalId: String(r.national_id),
      moodleUsername: String(r.moodle_username ?? ''),
      moodlePassword: String(r.moodle_password ?? ''),
    };
  }

  async listMoodleCredentials(): Promise<{ available: boolean; rows: MoodleCredential[] }> {
    if (this.credentialsMode === 'unavailable') return { available: false, rows: [] };
    try {
      const { data, error } = await this.sb
        .from('student_moodle_credentials')
        .select('national_id,moodle_username,moodle_password')
        .order('national_id', { ascending: true });
      if (error) {
        if (isMissingRelationError(error)) {
          this.credentialsMode = 'unavailable';
          return { available: false, rows: [] };
        }
        throw toRepoError(error);
      }
      this.credentialsMode = 'cloud';
      return { available: true, rows: (data ?? []).map(r => this.rowToCred(r as any)) };
    } catch (err) {
      if (isMissingRelationError(err)) {
        this.credentialsMode = 'unavailable';
        return { available: false, rows: [] };
      }
      throw toRepoError(err);
    }
  }

  private schedulerMode: 'unknown' | 'cloud' | 'unavailable' = 'unknown';

  async getSchedulerSettings(): Promise<SchedulerSettings> {
    if (this.schedulerMode === 'unavailable') return defaultSchedulerSettings();
    try {
      const { data, error } = await this.sb
        .from('scheduler_settings')
        .select('enabled,max_per_run')
        .eq('owner', this.owner)
        .maybeSingle();
      if (error) {
        if (isMissingRelationError(error)) {
          this.schedulerMode = 'unavailable';
          return defaultSchedulerSettings();
        }
        throw toRepoError(error);
      }
      this.schedulerMode = 'cloud';
      if (!data) return { available: true, enabled: false, maxPerRun: DEFAULT_MAX_PER_RUN };
      return {
        available: true,
        enabled: Boolean(data.enabled),
        maxPerRun: Math.max(1, Math.min(Number(data.max_per_run) || DEFAULT_MAX_PER_RUN, 200)),
      };
    } catch (err) {
      if (isMissingRelationError(err)) {
        this.schedulerMode = 'unavailable';
        return defaultSchedulerSettings();
      }
      throw toRepoError(err);
    }
  }

  async upsertMoodleCredentials(rows: MoodleCredential[]): Promise<number> {
    const unique = new Map<string, MoodleCredential>();
    for (const r of rows) {
      const id = String(r.nationalId ?? '').trim();
      if (id.length < 4) continue;
      unique.set(id, { ...r, nationalId: id });
    }
    const list = [...unique.values()];
    if (!list.length) return 0;
    if (this.credentialsMode === 'unavailable') throw new RepoError('other', 'credentials_unavailable');
    try {
      const { error } = await this.sb
        .from('student_moodle_credentials')
        .upsert(list.map(c => this.credToRow(c)), { onConflict: 'owner,national_id' });
      if (error) {
        if (isMissingRelationError(error)) {
          this.credentialsMode = 'unavailable';
          throw new RepoError('other', 'credentials_unavailable');
        }
        throw toRepoError(error);
      }
      this.credentialsMode = 'cloud';
      return list.length;
    } catch (err) {
      if (err instanceof RepoError) throw err;
      if (isMissingRelationError(err)) {
        this.credentialsMode = 'unavailable';
        throw new RepoError('other', 'credentials_unavailable');
      }
      throw toRepoError(err);
    }
  }

  async deleteMoodleCredential(nationalId: string): Promise<void> {
    const id = String(nationalId ?? '').trim();
    if (!id) return;
    if (this.credentialsMode === 'unavailable') throw new RepoError('other', 'credentials_unavailable');
    try {
      const { error } = await this.sb.from('student_moodle_credentials').delete().eq('national_id', id);
      if (error) {
        if (isMissingRelationError(error)) {
          this.credentialsMode = 'unavailable';
          throw new RepoError('other', 'credentials_unavailable');
        }
        throw toRepoError(error);
      }
    } catch (err) {
      if (err instanceof RepoError) throw err;
      if (isMissingRelationError(err)) {
        this.credentialsMode = 'unavailable';
        throw new RepoError('other', 'credentials_unavailable');
      }
      throw toRepoError(err);
    }
  }

  // ----- Section events (localStorage fallback) -----
  private eventsMode: 'unknown' | 'cloud' | 'local' = 'unknown';

  private eventToRow(e: SectionEvent) {
    return {
      id: e.id,
      owner: this.owner,
      grade: e.grade,
      section: e.section,
      event_type: e.type,
      title: e.title,
      close_at: e.closeAt || null,
      close_label: e.closeLabel,
      url: e.url,
      duration: e.duration,
      attempts: e.attempts,
      updated_at: e.updatedAt || new Date().toISOString(),
    };
  }

  private rowToEvent(r: any): SectionEvent {
    return parseSectionEvents([{
      id: r.id,
      grade: r.grade,
      section: r.section,
      type: r.event_type,
      title: r.title,
      closeAt: r.close_at || '',
      closeLabel: r.close_label || '',
      url: r.url || '',
      duration: r.duration || '',
      attempts: r.attempts || '',
      updatedAt: r.updated_at || r.created_at || '',
    }])[0];
  }

  async listSectionEvents(): Promise<SectionEvent[]> {
    if (this.eventsMode === 'local') return readLocalSectionEvents();
    try {
      const { data, error } = await this.sb
        .from('section_events')
        .select('id,grade,section,event_type,title,close_at,close_label,url,duration,attempts,created_at,updated_at')
        .order('created_at', { ascending: true });
      if (error) {
        if (isMissingRelationError(error)) {
          this.eventsMode = 'local';
          return readLocalSectionEvents();
        }
        throw toRepoError(error);
      }
      this.eventsMode = 'cloud';
      return parseSectionEvents((data ?? []).map(r => this.rowToEvent(r)).filter(Boolean));
    } catch (err) {
      if (isMissingRelationError(err)) {
        this.eventsMode = 'local';
        return readLocalSectionEvents();
      }
      throw toRepoError(err);
    }
  }

  async upsertSectionEvents(events: SectionEvent[]): Promise<void> {
    const list = parseSectionEvents(events);
    if (!list.length) return;
    if (this.eventsMode === 'local') {
      const current = readLocalSectionEvents();
      const map = new Map(current.map(e => [e.id, e]));
      for (const e of list) map.set(e.id, e);
      writeLocalSectionEvents([...map.values()]);
      return;
    }
    try {
      const { error } = await this.sb.from('section_events').upsert(list.map(e => this.eventToRow(e)), { onConflict: 'id' });
      if (error) {
        if (isMissingRelationError(error)) {
          this.eventsMode = 'local';
          await this.upsertSectionEvents(list);
          return;
        }
        throw toRepoError(error);
      }
      this.eventsMode = 'cloud';
    } catch (err) {
      if (isMissingRelationError(err)) {
        this.eventsMode = 'local';
        await this.upsertSectionEvents(list);
        return;
      }
      throw toRepoError(err);
    }
  }

  async deleteSectionEvent(id: string): Promise<void> {
    if (this.eventsMode === 'local') {
      writeLocalSectionEvents(readLocalSectionEvents().filter(e => e.id !== id));
      return;
    }
    try {
      const { error } = await this.sb.from('section_events').delete().eq('id', id);
      if (error) {
        if (isMissingRelationError(error)) {
          this.eventsMode = 'local';
          writeLocalSectionEvents(readLocalSectionEvents().filter(e => e.id !== id));
          return;
        }
        throw toRepoError(error);
      }
      this.eventsMode = 'cloud';
    } catch (err) {
      if (isMissingRelationError(err)) {
        this.eventsMode = 'local';
        writeLocalSectionEvents(readLocalSectionEvents().filter(e => e.id !== id));
        return;
      }
      throw toRepoError(err);
    }
  }

  async upsertSchedulerSettings(patch: { enabled: boolean; maxPerRun?: number }): Promise<void> {
    if (this.schedulerMode === 'unavailable') throw new RepoError('other', 'scheduler_unavailable');
    const maxPerRun = Math.max(1, Math.min(Number(patch.maxPerRun) || DEFAULT_MAX_PER_RUN, 200));
    try {
      const { error } = await this.sb.from('scheduler_settings').upsert({
        owner: this.owner,
        enabled: Boolean(patch.enabled),
        max_per_run: maxPerRun,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'owner' });
      if (error) {
        if (isMissingRelationError(error)) {
          this.schedulerMode = 'unavailable';
          throw new RepoError('other', 'scheduler_unavailable');
        }
        throw toRepoError(error);
      }
      this.schedulerMode = 'cloud';
    } catch (err) {
      if (err instanceof RepoError) throw err;
      if (isMissingRelationError(err)) {
        this.schedulerMode = 'unavailable';
        throw new RepoError('other', 'scheduler_unavailable');
      }
      throw toRepoError(err);
    }
  }

  private suppressionMode: 'unknown' | 'cloud' | 'unavailable' = 'unknown';

  async listSuppressedPhones(): Promise<{ available: boolean; rows: SuppressedPhone[] }> {
    if (this.suppressionMode === 'unavailable') return { available: false, rows: [] };
    try {
      const { data, error } = await this.sb
        .from('suppressed_phones')
        .select('phone,reason,created_at')
        .order('created_at', { ascending: true });
      if (error) {
        if (isMissingRelationError(error)) {
          this.suppressionMode = 'unavailable';
          return { available: false, rows: [] };
        }
        throw toRepoError(error);
      }
      this.suppressionMode = 'cloud';
      return {
        available: true,
        rows: (data ?? []).map((r: any) => ({ phone: String(r.phone ?? ''), reason: String(r.reason ?? ''), createdAt: r.created_at ?? undefined })),
      };
    } catch (err) {
      if (err instanceof RepoError) throw err;
      if (isMissingRelationError(err)) {
        this.suppressionMode = 'unavailable';
        return { available: false, rows: [] };
      }
      throw toRepoError(err);
    }
  }

  async upsertSuppressedPhone(entry: SuppressedPhone): Promise<void> {
    const p = parseSuppressed(entry.phone, entry.reason);
    if (!p.ok) throw new RepoError('other', 'invalid_phone');
    if (this.suppressionMode === 'unavailable') throw new RepoError('other', 'suppression_unavailable');
    try {
      const { error } = await this.sb
        .from('suppressed_phones')
        .upsert({ owner: this.owner, phone: p.entry.phone, reason: p.entry.reason }, { onConflict: 'owner,phone' });
      if (error) {
        if (isMissingRelationError(error)) {
          this.suppressionMode = 'unavailable';
          throw new RepoError('other', 'suppression_unavailable');
        }
        throw toRepoError(error);
      }
      this.suppressionMode = 'cloud';
    } catch (err) {
      if (err instanceof RepoError) throw err;
      throw toRepoError(err);
    }
  }

  async deleteSuppressedPhone(phone: string): Promise<void> {
    const p = parseSuppressed(phone, '');
    if (!p.ok) return;
    if (this.suppressionMode === 'unavailable') throw new RepoError('other', 'suppression_unavailable');
    try {
      const { error } = await this.sb.from('suppressed_phones').delete().eq('owner', this.owner).eq('phone', p.entry.phone);
      if (error) throw toRepoError(error);
    } catch (err) {
      if (err instanceof RepoError) throw err;
      throw toRepoError(err);
    }
  }
}
