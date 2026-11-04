import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import SecretText from './SecretText';
import ConfirmSendDialog from './ConfirmSendDialog';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

function mount(el: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(el));
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

describe('SecretText', () => {
  it('masks by default and reveals only on demand', () => {
    const c = mount(<SecretText value="Fake#Pass-0001" />);
    expect(c.textContent).not.toContain('Fake#Pass-0001');
    act(() => (c.querySelector('[data-testid="secret-toggle"]') as HTMLButtonElement).click());
    expect(c.textContent).toContain('Fake#Pass-0001');
  });
});

describe('ConfirmSendDialog with secrets', () => {
  it('shows the masked sample by default and warns about missing Moodle data', () => {
    const c = mount(
      <ConfirmSendDialog
        open
        mode="now"
        studentCount={1}
        contents={['كلمة المرور: Fake#Pass-0001']}
        excludedCount={0}
        sampleText="كلمة المرور: Fake#Pass-0001"
        sampleMaskedText="كلمة المرور: ••••••"
        missingMoodleCount={2}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    const preview = c.querySelector('#confirm-sample-preview')!;
    expect(preview.textContent).not.toContain('Fake#Pass-0001');
    expect(preview.textContent).toContain('••••••');
    expect(c.querySelector('#confirm-missing-moodle')?.textContent).toContain('2');
  });
});
