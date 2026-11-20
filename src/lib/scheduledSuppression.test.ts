import { describe, expect, it } from 'vitest';
import { buildItems, excludeSuppressed, type StudentRec } from '../../supabase/functions/school-notify-scheduled/dispatch';

const rec = (id: string, phone: string): StudentRec => ({ uuid: 'u' + id, nationalId: id, name: 'طالب ' + id, parentName: 'ولي', phone, grade: 'ص', section: 'أ' } as StudentRec);

describe('scheduled sender do-not-send list', () => {
  it('drops suppressed numbers and keeps the rest', () => {
    const items = buildItems([rec('1', '0599000111'), rec('2', '0599000222')], 'primary', 'مرحبا');
    expect(excludeSuppressed(items, new Set(['0599000111'])).map(i => i.phoneLocal)).toEqual(['0599000222']);
    expect(excludeSuppressed(items, new Set())).toHaveLength(2);
  });
});
