// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { LAST_FILTER_KEYS, readComposeFilter, readDashboardFilter, validOption, writeComposeFilter, writeDashboardFilter } from './lastFilter';

afterEach(() => localStorage.clear());

describe('lastFilter', () => {
  it('defaults when nothing is stored or the value is corrupt', () => {
    expect(readComposeFilter()).toEqual({ targetType: 'all', grade: '', section: '' });
    localStorage.setItem(LAST_FILTER_KEYS.dashboard, '{bad json');
    expect(readDashboardFilter()).toEqual({ grade: 'all', section: 'all', search: '' });
  });

  it('round-trips compose filter and never restores custom selection', () => {
    writeComposeFilter({ targetType: 'section', grade: 'الصف التجريبي', section: 'أ' });
    expect(readComposeFilter()).toEqual({ targetType: 'section', grade: 'الصف التجريبي', section: 'أ' });
    writeComposeFilter({ targetType: 'custom' });
    expect(readComposeFilter().targetType).toBe('section');
    localStorage.setItem(LAST_FILTER_KEYS.compose, JSON.stringify({ targetType: 'custom' }));
    expect(readComposeFilter().targetType).toBe('all');
  });

  it('round-trips dashboard filter with partial updates', () => {
    writeDashboardFilter({ grade: 'ص1' });
    writeDashboardFilter({ search: 'طالب' });
    expect(readDashboardFilter()).toEqual({ grade: 'ص1', section: 'all', search: 'طالب' });
  });

  it('validOption falls back when a stored value no longer exists', () => {
    expect(validOption('x', ['a', 'b'], 'a')).toBe('a');
    expect(validOption('b', ['a', 'b'], 'a')).toBe('b');
    expect(validOption('all', ['a'], 'a', true)).toBe('all');
  });
});
