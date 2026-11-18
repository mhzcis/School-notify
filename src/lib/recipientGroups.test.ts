import { afterEach, describe, expect, it } from 'vitest';
import { fakeStudent, fakeStudents } from '../test/fixtures';
import {
  buildRecipientGroup,
  isMissingRelationError,
  parseGroups,
  readLocalGroups,
  resolveGroupMembers,
  upsertLocalGroup,
} from './recipientGroups';

afterEach(() => localStorage.clear());

describe('recipient groups', () => {
  it('saves, reloads and drops stale national IDs', () => {
    const group = buildRecipientGroup('غير الداخلين — رابع 1', ['1000000001', ' 1000000001 ', '9999999999', ''], new Date('2026-11-18T12:00:00.000Z'), '44444444-4444-4444-8444-444444444444');
    expect(group.studentNationalIds).toEqual(['1000000001', '9999999999']);
    const resolved = resolveGroupMembers(group, fakeStudents(3));
    expect(resolved.matchedIds).toEqual(['1000000001']);
    expect(resolved.skippedIds).toEqual(['9999999999']);
    expect(resolved.skippedCount).toBe(1);
  });

  it('round-trips through localStorage without storing a message body or credentials', () => {
    const group = buildRecipientGroup('تجريبي', [fakeStudent(2).id]);
    upsertLocalGroup(group);
    const loaded = readLocalGroups();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].title).toBe('تجريبي');
    expect(loaded[0].studentNationalIds).toEqual(['1000000002']);
    expect(JSON.stringify(loaded)).not.toMatch(/moodlePassword|messageContent|SMSGATE/i);
  });

  it('parseGroups ignores junk and caps the title', () => {
    const long = 'ج'.repeat(120);
    const parsed = parseGroups([
      { id: 'a', title: long, studentNationalIds: ['1'] },
      { title: 'no-id', studentNationalIds: [] },
      null,
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].title).toHaveLength(80);
  });

  it('detects a missing-table PostgREST error', () => {
    expect(isMissingRelationError({ code: 'PGRST205', message: 'Could not find the table' })).toBe(true);
    expect(isMissingRelationError({ code: '42P01', message: 'relation "school_notify.recipient_groups" does not exist' })).toBe(true);
    expect(isMissingRelationError({ code: '42501', message: 'permission denied' })).toBe(false);
  });
});
