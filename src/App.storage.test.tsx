import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import App from './App';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('App storage hydration', () => {
  it('fresh install starts empty (no demo students/logs/scheduled), keeps default templates', () => {
    root = createRoot(container);
    act(() => root.render(<App />));
    expect(JSON.parse(localStorage.getItem('resal_students')!)).toEqual([]);
    expect(JSON.parse(localStorage.getItem('resal_logs')!)).toEqual([]);
    expect(JSON.parse(localStorage.getItem('resal_scheduled')!)).toEqual([]);
    expect(JSON.parse(localStorage.getItem('resal_templates')!).length).toBeGreaterThan(0);
    expect(container.querySelector('#storage-quarantine-notice')).toBeNull();
  });

  it('corrupt stored students do not crash the app; raw value is quarantined and a notice is shown', () => {
    localStorage.setItem('resal_students', '[{"id":"S1","name":"طالب');
    root = createRoot(container);
    act(() => root.render(<App />));
    const qKeys = Object.keys(localStorage).filter((k) => k.startsWith('resal_corrupt_students_'));
    expect(qKeys.length).toBe(1);
    expect(localStorage.getItem(qKeys[0])).toBe('[{"id":"S1","name":"طالب');
    expect(container.querySelector('#storage-quarantine-notice')?.textContent).toContain(qKeys[0]);
  });
});
