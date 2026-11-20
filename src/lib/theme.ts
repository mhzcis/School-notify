/** Light / dark / system theme preference (non-sensitive `sn_theme`). */
import { readPref, UI_PREF_KEYS, writePref } from './smsPrefs';

export type ThemePref = 'light' | 'dark' | 'system';

export function readTheme(): ThemePref {
  const v = readPref(UI_PREF_KEYS.theme, 'light');
  return v === 'dark' || v === 'system' ? v : 'light';
}

export function systemPrefersDark(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

export function resolveDark(pref: ThemePref, prefersDark: boolean = systemPrefersDark()): boolean {
  return pref === 'dark' || (pref === 'system' && prefersDark);
}

export function applyTheme(pref: ThemePref = readTheme()): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', resolveDark(pref));
}

export function writeTheme(pref: ThemePref): void {
  writePref(UI_PREF_KEYS.theme, pref);
  applyTheme(pref);
}

/** Cycles light → dark → system → light. */
export function nextTheme(pref: ThemePref): ThemePref {
  return pref === 'light' ? 'dark' : pref === 'dark' ? 'system' : 'light';
}

export const THEME_LABELS: Record<ThemePref, string> = {
  light: 'الوضع الفاتح',
  dark: 'الوضع الداكن',
  system: 'حسب الجهاز',
};
