/**
 * Pure helpers: entity <-> row mapping, dedupe and chunking (unit-tested).
 */
import type { MessageLog, MessageTemplate, ScheduledMessage, Student } from '../../types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // RFC4122 v4 fallback
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) throw new Error('chunk size must be > 0');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Dedupe by national id (Student.id, trimmed). The LAST occurrence wins; rows without an id are dropped. */
export function dedupeStudents(students: Student[]): Student[] {
  const map = new Map<string, Student>();
  for (const s of students) {
    const key = String(s?.id ?? '').trim();
    if (!key) continue;
    if (map.has(key)) map.delete(key); // keep insertion order of the last occurrence
    map.set(key, { ...s, id: key });
  }
  return [...map.values()];
}

// ---------------- students ----------------
export interface StudentRow {
  id?: string;
  owner?: string;
  national_id: string;
  name: string;
  parent_name: string | null;
  phone: string | null;
  class_name: string | null;
  extra: Record<string, unknown>;
  updated_at?: string;
}

const STUDENT_COLUMNS = new Set(['id', 'name', 'parentName', 'phone', 'grade']);

export function studentToRow(s: Student, owner: string): StudentRow {
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) {
    if (!STUDENT_COLUMNS.has(k) && v !== undefined) extra[k] = v;
  }
  return {
    owner,
    national_id: String(s.id).trim(),
    name: s.name || '',
    parent_name: s.parentName ?? null,
    phone: s.phone ?? null,
    class_name: s.grade ?? null,
    extra,
    updated_at: new Date().toISOString(),
  };
}

export function rowToStudent(r: StudentRow): Student {
  const extra = (r.extra && typeof r.extra === 'object' ? r.extra : {}) as Partial<Student>;
  return {
    ...(extra as any),
    id: r.national_id || r.id || '',
    name: r.name,
    parentName: r.parent_name ?? '',
    phone: r.phone ?? '',
    grade: r.class_name ?? '',
    section: (extra.section as string) ?? '',
    nameEn: (extra.nameEn as string) ?? '',
    phone2: (extra.phone2 as string) ?? '',
    email: (extra.email as string) ?? '',
  } as Student;
}

// ---------------- templates ----------------
export interface TemplateRow {
  id: string;
  owner?: string;
  title: string;
  body: string;
  category: string;
}

export const templateToRow = (t: MessageTemplate, owner: string): TemplateRow => ({
  id: t.id,
  owner,
  title: t.title || 'قالب',
  body: t.content ?? '',
  category: t.category || 'general',
});

export const rowToTemplate = (r: TemplateRow): MessageTemplate => ({
  id: r.id,
  title: r.title,
  content: r.body,
  category: (r.category || 'general') as MessageTemplate['category'],
});

// ---------------- campaigns ----------------
export interface CampaignRow {
  id: string;
  owner?: string;
  title: string;
  body: string;
  status: string;
  meta: Record<string, unknown>;
  created_at?: string;
}

export const campaignToRow = (c: ScheduledMessage, owner: string): CampaignRow => ({
  id: c.id,
  owner,
  title: c.title || 'حملة',
  body: c.contentTemplate ?? '',
  status: c.status,
  created_at: c.createdAt,
  meta: {
    kind: 'scheduled',
    targetType: c.targetType,
    targetGrade: c.targetGrade,
    targetSection: c.targetSection,
    targetStudentIds: c.targetStudentIds,
    phoneTarget: c.phoneTarget,
    scheduledTime: c.scheduledTime,
    totalRecipients: c.totalRecipients,
  },
});

export const rowToCampaign = (r: CampaignRow): ScheduledMessage => {
  const m = (r.meta || {}) as any;
  return {
    id: r.id,
    title: r.title,
    contentTemplate: r.body,
    status: r.status as ScheduledMessage['status'],
    createdAt: r.created_at || new Date().toISOString(),
    targetType: m.targetType ?? 'all',
    targetGrade: m.targetGrade,
    targetSection: m.targetSection,
    targetStudentIds: m.targetStudentIds,
    phoneTarget: m.phoneTarget,
    scheduledTime: m.scheduledTime ?? r.created_at ?? '',
    totalRecipients: Number(m.totalRecipients ?? 0),
  };
};

// ---------------- messages ----------------
export interface MessageRow {
  id: string;
  owner?: string;
  campaign_id: string;
  student_id: string | null;
  phone: string | null;
  body: string;
  status: string;
  error: string | null;
  sent_at: string | null;
  meta: Record<string, unknown>;
}

export const logToRow = (l: MessageLog, owner: string, campaignId: string, studentUuid: string | null): MessageRow => ({
  id: l.id,
  owner,
  campaign_id: campaignId,
  student_id: studentUuid,
  phone: l.phone ?? null,
  body: l.messageContent ?? '',
  status: l.status,
  error: l.failureReason ?? null,
  sent_at: l.sentTime ?? null,
  meta: {
    appStudentId: l.studentId,
    studentName: l.studentName,
    parentName: l.parentName,
    grade: l.grade,
    section: l.section,
    channel: l.channel,
    ...(l.gatewayMessageId ? { gatewayMessageId: l.gatewayMessageId } : {}),
    ...(l.gatewayState ? { gatewayState: l.gatewayState } : {}),
  },
});

export const rowToLog = (r: MessageRow): MessageLog => {
  const m = (r.meta || {}) as any;
  return {
    id: r.id,
    campaignId: r.campaign_id,
    studentId: m.appStudentId ?? '',
    studentName: m.studentName ?? '',
    parentName: m.parentName ?? '',
    phone: r.phone ?? '',
    grade: m.grade ?? '',
    section: m.section ?? '',
    messageContent: r.body,
    sentTime: r.sent_at ?? '',
    status: r.status as MessageLog['status'],
    failureReason: r.error ?? undefined,
    channel: m.channel,
    ...(m.gatewayMessageId ? { gatewayMessageId: m.gatewayMessageId } : {}),
    ...(m.gatewayState ? { gatewayState: m.gatewayState } : {}),
  };
};

/**
 * Normalises log ids to UUIDs and assigns logs without a known campaign to one new
 * "immediate" campaign. Returns the logs plus the immediate campaign to create (if any).
 */
export function prepareLogs(
  logs: MessageLog[],
  knownCampaignIds: Set<string>
): { logs: MessageLog[]; immediateCampaign: { id: string; body: string } | null } {
  let immediate: { id: string; body: string } | null = null;
  const out = logs.map(l => {
    let campaignId = l.campaignId;
    if (!campaignId || !isUuid(campaignId) || !knownCampaignIds.has(campaignId)) {
      if (!immediate) immediate = { id: newId(), body: l.messageContent ?? '' };
      campaignId = immediate.id;
    }
    return { ...l, id: isUuid(l.id) ? l.id : newId(), campaignId };
  });
  return { logs: out, immediateCampaign: immediate };
}
