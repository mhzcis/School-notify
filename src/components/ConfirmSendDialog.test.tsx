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

describe('ConfirmSendDialog', () => {
  it('shows counts, segments, excluded and a real sample; confirm calls back', () => {
    const onConfirm = vi.fn();
    const sample = 'مرحبا ولي أمر الطالب تجريبي'; // fake
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
