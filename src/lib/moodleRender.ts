/**
 * Render a template with Moodle credentials (session-only) and the matching
 * section event. Never reads student.notes for quiz fields.
 */
import type { Student } from '../types';
import { attachCredentials, type MoodleCredential } from './moodleCredentials';
import { findSectionEvent, formatCloseDate, type SectionEvent } from './sectionEvents';
import { renderTemplate, type RenderOptions } from './template';

export interface MoodleRenderContext {
  credentials?: Map<string, MoodleCredential>;
  events?: SectionEvent[];
  maskSecrets?: boolean;
  today?: Date;
}

export function renderWithMoodle(template: string, student: Student, ctx: MoodleRenderContext = {}): string {
  const s = ctx.credentials ? attachCredentials(student, ctx.credentials) : student;
  const ev = ctx.events ? findSectionEvent(ctx.events, s.grade, s.section) : undefined;
  const options: RenderOptions = {
    maskSecrets: ctx.maskSecrets,
    today: ctx.today,
    quizUrl: ev?.url,
    closeDate: ev ? formatCloseDate(ev) : '',
  };
  return renderTemplate(template, s, options);
}
