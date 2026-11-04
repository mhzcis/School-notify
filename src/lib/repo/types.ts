/**
 * Repository layer for all school data (students, templates, campaigns, per-message history).
 * The app talks only to this interface; the Supabase implementation stores everything in the
 * RLS-protected `school_notify` schema, and the in-memory fake is used by tests.
 */
import type { MessageLog, MessageTemplate, ScheduledMessage, Student } from '../../types';

export interface AppData {
  students: Student[];
  templates: MessageTemplate[];
  /** Scheduled campaigns only (immediate-send campaigns are internal grouping rows). */
  campaigns: ScheduledMessage[];
  logs: MessageLog[];
}

export type ProgressFn = (done: number, total: number) => void;

export interface SchoolRepository {
  loadAll(): Promise<AppData>;
  /** Insert-or-update by national id (Student.id), deduped, in chunks of UPSERT_CHUNK_SIZE. Returns rows written. */
  upsertStudents(students: Student[], onProgress?: ProgressFn): Promise<number>;
  /**
   * Updates ONE existing student (by national id) with only the editable fields (name, grade, section,
   * phone, phone2). Other students and all other fields (notes, Moodle data, ...) are left untouched.
   * Throws RepoError('other', 'not_found') if the student does not exist (never inserts).
   */
  updateStudent(id: string, patch: import('../studentEdit').StudentEditPatch): Promise<void>;
  deleteStudents(ids: string[]): Promise<void>;
  deleteAllStudents(): Promise<void>;
  upsertTemplates(templates: MessageTemplate[]): Promise<void>;
  deleteTemplate(id: string): Promise<void>;
  upsertCampaigns(campaigns: ScheduledMessage[]): Promise<void>;
  /**
   * Persists per-message history. Logs without a known campaign are grouped under a new
   * "immediate" campaign. Returns the logs as stored (ids / campaignId normalised to UUIDs).
   */
  addLogs(logs: MessageLog[]): Promise<MessageLog[]>;
  clearLogs(): Promise<void>;
  /**
   * Updates gateway state/status of stored logs by log id. Never downgrades: an update is skipped
   * when the stored gateway state is already final or newer. Returns ids actually updated.
   */
  updateGatewayStates(updates: GatewayLogUpdate[]): Promise<string[]>;
}

export interface GatewayLogUpdate {
  logId: string;
  gatewayState: import('../../types').MessageLog['gatewayState'];
  status: MessageLog['status'];
  failureReason?: string;
}

export type RepoErrorKind = 'auth' | 'offline' | 'other';

export class RepoError extends Error {
  kind: RepoErrorKind;
  constructor(kind: RepoErrorKind, message: string) {
    super(message);
    this.name = 'RepoError';
    this.kind = kind;
  }
}

export const UPSERT_CHUNK_SIZE = 500;

/** Arabic, user-facing message for a repository failure. */
export function repoErrorMessage(err: unknown): string {
  if (err instanceof RepoError) {
    if (err.kind === 'offline') return 'تعذر الاتصال بالخادم. تحقق من الإنترنت ثم أعد المحاولة؛ لم يتم حفظ التغيير.';
    if (err.kind === 'auth') return 'انتهت الجلسة أو لم تعد مصرحاً. الرجاء تسجيل الدخول من جديد.';
  }
  return 'تعذر حفظ البيانات في السحابة. حاول مرة أخرى.';
}
