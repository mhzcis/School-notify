// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import HelpPage from './HelpPage';
import { PLACEHOLDERS } from '../lib/template';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('HelpPage', () => {
  it('renders the safe-send sections and every placeholder', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    act(() => createRoot(el).render(<HelpPage />));
    for (const id of ['help-import', 'help-recipients', 'help-send', 'help-schedule', 'help-reports', 'help-backup', 'help-placeholders']) {
      expect(el.querySelector('#' + id)).not.toBeNull();
    }
    for (const p of PLACEHOLDERS) expect(el.textContent).toContain(p.tag);
    expect(el.textContent).toContain('30');
    el.remove();
  });
});
