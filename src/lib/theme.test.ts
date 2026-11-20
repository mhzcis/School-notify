// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { applyTheme, nextTheme, readTheme, resolveDark, writeTheme } from './theme';

afterEach(() => { localStorage.clear(); document.documentElement.classList.remove('dark'); });

describe('theme', () => {
  it('defaults to light and ignores junk', () => {
    expect(readTheme()).toBe('light');
    localStorage.setItem('sn_theme', 'neon');
    expect(readTheme()).toBe('light');
  });
  it('resolves system preference', () => {
    expect(resolveDark('system', true)).toBe(true);
    expect(resolveDark('system', false)).toBe(false);
    expect(resolveDark('dark', false)).toBe(true);
    expect(resolveDark('light', true)).toBe(false);
  });
  it('writes, applies the html class, and cycles', () => {
    writeTheme('dark');
    expect(readTheme()).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    writeTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    applyTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('system');
    expect(nextTheme('system')).toBe('light');
  });
});
