// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SuppressionListPanel from './SuppressionListPanel';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let el: HTMLDivElement;
afterEach(() => el?.remove());

function render(props: any) {
  el = document.createElement('div');
  document.body.appendChild(el);
  act(() => createRoot(el).render(<SuppressionListPanel {...props} />));
}
function type(sel: string, v: string) {
  const input = el.querySelector(sel) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => { setter.call(input, v); input.dispatchEvent(new Event('input', { bubbles: true })); });
}
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 5)); });

describe('SuppressionListPanel', () => {
  it('shows unavailable notice when the table is missing', () => {
    render({ available: false, rows: [], onAdd: vi.fn(), onRemove: vi.fn() });
    expect(el.querySelector('#suppression-unavailable')).not.toBeNull();
  });

  it('rejects invalid numbers and adds a normalised one', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render({ available: true, rows: [], onAdd, onRemove: vi.fn() });
    type('#input-suppress-phone', '12');
    act(() => (el.querySelector('#btn-suppress-add') as HTMLButtonElement).click());
    expect(onAdd).not.toHaveBeenCalled();
    expect(el.querySelector('#suppression-msg')!.textContent).toContain('رقم غير صالح');
    type('#input-suppress-phone', '+970599000111');
    type('#input-suppress-reason', 'طلب ولي الأمر');
    act(() => (el.querySelector('#btn-suppress-add') as HTMLButtonElement).click());
    await flush();
    expect(onAdd).toHaveBeenCalledWith({ phone: '0599000111', reason: 'طلب ولي الأمر' });
  });

  it('masks numbers by default', () => {
    render({ available: true, rows: [{ phone: '0599000111', reason: '' }], onAdd: vi.fn(), onRemove: vi.fn() });
    expect(el.querySelector('#suppression-list')!.textContent).toContain('059****111');
    expect(el.querySelector('#suppression-list')!.textContent).not.toContain('0599000111');
  });
});
