// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SmsGatewaySettings from './SmsGatewaySettings';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
afterEach(() => { container?.remove(); localStorage.clear(); vi.restoreAllMocks(); });

const FAKE_PHONE = '0590000001'; // fake

function render(invoke: any) {
  container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(
    <SmsGatewaySettings schoolName="مدرسة تجريبية" gatewayStatus="configured" onRefreshStatus={() => {}} invoke={invoke} pollOptions={{ intervalMs: 1, timeoutMs: 50 }} />
  ));
}

function typePhone(v: string) {
  const input = container.querySelector('#input-test-phone') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => { setter.call(input, v); input.dispatchEvent(new Event('input', { bubbles: true })); });
}
const click = (sel: string) => act(() => { (container.querySelector(sel) as HTMLButtonElement).click(); });
const result = () => container.querySelector('#test-send-result');
const flush = () => act(async () => { for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 2)); });

describe('SmsGatewaySettings test send feedback', () => {
  it('never uses window.confirm and shows an inline confirmation before sending', () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    const invoke = vi.fn();
    render(invoke);
    typePhone(FAKE_PHONE);
    click('#btn-test-send');
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(result()!.getAttribute('data-state')).toBe('confirm');
    expect(container.querySelector('#btn-test-send-confirm')).not.toBeNull();
  });

  it('shows a clear message when the teacher cancels', () => {
    const invoke = vi.fn();
    render(invoke);
    typePhone(FAKE_PHONE);
    click('#btn-test-send');
    click('#btn-test-send-cancel');
    expect(invoke).not.toHaveBeenCalled();
    expect(result()!.textContent).toContain('تم إلغاء الإرسال التجريبي');
    expect(result()!.textContent).toContain('لم تُرسل أي رسالة');
  });

  it('shows an error for an invalid number without calling the server', () => {
    const invoke = vi.fn();
    render(invoke);
    typePhone('123');
    click('#btn-test-send');
    expect(invoke).not.toHaveBeenCalled();
    expect(result()!.getAttribute('data-state')).toBe('error');
    expect(result()!.textContent).toContain('رقم غير صالح');
  });

  it('shows the gateway error when the server rejects the send', async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true, results: [{ id: 'test', ok: false, error: 'gateway_auth_failed' }] });
    render(invoke);
    typePhone(FAKE_PHONE);
    click('#btn-test-send');
    click('#btn-test-send-confirm');
    await flush();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result()!.getAttribute('data-state')).toBe('error');
    expect(result()!.textContent).toContain('رفضت البوابة المصادقة');
  });

  it('shows an error (not silence) when the call throws', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('network'));
    render(invoke);
    typePhone(FAKE_PHONE);
    click('#btn-test-send');
    click('#btn-test-send-confirm');
    await flush();
    expect(result()!.getAttribute('data-state')).toBe('error');
    expect(result()!.textContent!.length).toBeGreaterThan(5);
  });

  it('confirm sends exactly one message and reports acceptance', async () => {
    const invoke = vi.fn(async (body: any) => body.action === 'messageStatus'
      ? { ok: true, statuses: [{ id: 'gw-1', state: 'Delivered' }] }
      : { ok: true, results: [{ id: 'test', ok: true, gatewayMessageId: 'gw-1' }] });
    render(invoke);
    typePhone(FAKE_PHONE);
    click('#btn-test-send');
    click('#btn-test-send-confirm');
    // The confirm button disappears after the first click, so a double click cannot send twice.
    expect(container.querySelector('#btn-test-send-confirm')).toBeNull();
    await flush();
    const sends = invoke.mock.calls.filter(c => (c[0] as any).action !== 'messageStatus');
    expect(sends).toHaveLength(1);
    expect(result()!.getAttribute('data-state')).toBe('ok');
  });
});
