// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ConfirmSendDialog from './ConfirmSendDialog';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
afterEach(() => { container?.remove(); localStorage.clear(); });

function render(el: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(el));
  return root;
}

const sample = 'مرحبا ولي أمر الطالب تجريبي'; // fake

describe('ConfirmSendDialog', () => {
  it('shows counts, segments, excluded and a real sample; confirm calls back once', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmSendDialog
        open mode="now" studentCount={3}
        contents={[sample, 'ا'.repeat(100)]}
        excludedCount={1}
        sampleText={sample}
        onConfirm={onConfirm} onCancel={() => {}}
      />
    );
    expect(container.querySelector('#confirm-student-count')!.textContent).toBe('3');
    expect(container.querySelector('#confirm-message-count')!.textContent).toBe('2');
    expect(container.querySelector('#confirm-total-segments')!.textContent).toBe('3');
    expect(container.querySelector('#confirm-sample-preview')!.textContent).toBe(sample);
    expect(container.textContent).toContain('سيتم استبعاد (1)');
    act(() => { (container.querySelector('#confirm-send-button') as HTMLButtonElement).click(); });
    act(() => { (container.querySelector('#confirm-send-button') as HTMLButtonElement).click(); });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('renders the first 3–5 recipient previews when samples are provided', () => {
    render(
      <ConfirmSendDialog
        open mode="now" studentCount={5}
        contents={['ا', 'ب', 'ج', 'د', 'ه']}
        excludedCount={0}
        sampleText="ا"
        samples={[
          { label: 'طالب تجريبي 1', text: 'رسالة واحد' },
          { label: 'طالب تجريبي 2', text: 'رسالة اثنان' },
          { label: 'طالب تجريبي 3', text: 'رسالة ثلاثة' },
        ]}
        onConfirm={() => {}} onCancel={() => {}}
      />
    );
    expect(container.querySelector('#confirm-sample-preview')!.textContent).toContain('رسالة واحد');
    expect(container.querySelector('#confirm-sample-preview-2')!.textContent).toContain('رسالة اثنان');
    expect(container.querySelector('#confirm-sample-preview-3')!.textContent).toContain('رسالة ثلاثة');
  });

  it('requires typing the message count when there are 30 or more messages', () => {
    const onConfirm = vi.fn();
    const contents = Array.from({ length: 31 }, (_, i) => `رسالة ${i}`);
    render(
      <ConfirmSendDialog
        open mode="now" studentCount={31}
        contents={contents}
        excludedCount={0}
        sampleText={contents[0]}
        onConfirm={onConfirm} onCancel={() => {}}
      />
    );
    const btn = container.querySelector('#confirm-send-button') as HTMLButtonElement;
    expect(container.querySelector('#confirm-typed-count-box')).toBeTruthy();
    expect(btn.disabled).toBe(true);
    act(() => {
      const input = container.querySelector('#confirm-typed-count') as HTMLInputElement;
      input.value = '30';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // Controlled input needs a change event with React's onChange
    act(() => {
      const input = container.querySelector('#confirm-typed-count') as HTMLInputElement;
      const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      proto?.set?.call(input, '31');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });

  it('blocks confirm during quiet hours until the override is checked', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmSendDialog
        open mode="now" studentCount={1}
        contents={[sample]}
        excludedCount={0}
        sampleText={sample}
        quietHoursActive
        onConfirm={onConfirm} onCancel={() => {}}
      />
    );
    expect(container.querySelector('#confirm-quiet-hours')).toBeTruthy();
    expect((container.querySelector('#confirm-send-button') as HTMLButtonElement).disabled).toBe(true);
    act(() => { (container.querySelector('#confirm-quiet-override') as HTMLInputElement).click(); });
    expect((container.querySelector('#confirm-send-button') as HTMLButtonElement).disabled).toBe(false);
    act(() => { (container.querySelector('#confirm-send-button') as HTMLButtonElement).click(); });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('shows a 24h duplicate warning without blocking confirm', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmSendDialog
        open mode="now" studentCount={1}
        contents={[sample]}
        excludedCount={0}
        sampleText={sample}
        duplicateCount={2}
        onConfirm={onConfirm} onCancel={() => {}}
      />
    );
    expect(container.querySelector('#confirm-duplicate-warning')!.textContent).toContain('24');
    act(() => { (container.querySelector('#confirm-send-button') as HTMLButtonElement).click(); });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when closed and disables confirm with zero messages', () => {
    render(<ConfirmSendDialog open={false} mode="now" studentCount={0} contents={[]} excludedCount={0} sampleText="" onConfirm={() => {}} onCancel={() => {}} />);
    expect(container.innerHTML).toBe('');
    container.remove();
    render(<ConfirmSendDialog open mode="now" studentCount={1} contents={[]} excludedCount={1} sampleText="" onConfirm={() => {}} onCancel={() => {}} />);
    expect((container.querySelector('#confirm-send-button') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('ConfirmSendDialog credentials gate', () => {
  it('blocks confirm until the extra Moodle-credentials box is ticked', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmSendDialog
        open mode="now" studentCount={1}
        contents={[sample]}
        excludedCount={0}
        sampleText={sample}
        requiresCredentialsConfirm
        onConfirm={onConfirm} onCancel={() => {}}
      />
    );
    expect(container.querySelector('#confirm-credentials-box')).toBeTruthy();
    const btn = container.querySelector('#confirm-send-button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    act(() => { btn.click(); });
    expect(onConfirm).not.toHaveBeenCalled();
    act(() => { (container.querySelector('#confirm-credentials-override') as HTMLInputElement).click(); });
    expect(btn.disabled).toBe(false);
    act(() => { btn.click(); });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0]).toMatchObject({ credentialsConfirmed: true });
  });
});
