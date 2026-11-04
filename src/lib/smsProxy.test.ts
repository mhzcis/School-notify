import { describe, expect, it, vi } from 'vitest';
import {
  MAX_BODY_CHARS, MAX_RECIPIENTS_PER_CALL, isAllowedOrigin, validateProxyRequest,
} from '../../supabase/functions/school-notify-sms/validate';
import { proxyErrorMessage, sendViaProxy, toProxyItems } from './smsProxy';

const item = (i: number, extra: Record<string, unknown> = {}) => ({ id: `m${i}`, phone: '+970590000001', text: 'رسالة تجريبية', ...extra });

describe('validateProxyRequest', () => {
  it('accepts status and a valid send', () => {
    expect(validateProxyRequest({ action: 'status' })).toEqual({ ok: true, value: { action: 'status' } });
    expect(validateProxyRequest({ action: 'send', messages: [item(1)] }).ok).toBe(true);
  });

  it.each([
    [null, 'invalid_json'],
    [[], 'invalid_json'],
    ['x', 'invalid_json'],
    [{ action: 'delete' }, 'invalid_action'],
    [{ action: 'send' }, 'no_recipients'],
    [{ action: 'send', messages: [] }, 'no_recipients'],
    [{ action: 'send', messages: Array.from({ length: MAX_RECIPIENTS_PER_CALL + 1 }, (_, i) => item(i)) }, 'too_many_recipients'],
    [{ action: 'send', messages: [item(1, { phone: '0590000001' })] }, 'invalid_item'],
    [{ action: 'send', messages: [item(1, { phone: '+97059000000a' })] }, 'invalid_item'],
    [{ action: 'send', messages: [item(1, { text: '   ' })] }, 'invalid_item'],
    [{ action: 'send', messages: [item(1, { text: 'ا'.repeat(MAX_BODY_CHARS + 1) })] }, 'invalid_item'],
    [{ action: 'send', messages: [item(1, { id: 'bad id!' })] }, 'invalid_item'],
    [{ action: 'send', messages: [item(1), item(1)] }, 'invalid_item'],
    [{ action: 'send', messages: ['x'] }, 'invalid_item'],
  ])('rejects %j with %s', (body, code) => {
    const r = validateProxyRequest(body);
    expect(r.ok).toBe(false);
    expect((r as any).error).toBe(code);
  });

  it('error details never contain phone numbers or message text', () => {
    const r = validateProxyRequest({ action: 'send', messages: [item(1, { phone: '0590000001', text: '' })] }) as any;
    expect(JSON.stringify(r.details)).not.toContain('0590000001');
    expect(r.details.join(' ')).toMatch(/#0/);
  });
});

describe('isAllowedOrigin', () => {
  it('allows GitHub Pages and localhost only', () => {
    expect(isAllowedOrigin('https://mhzcis.github.io')).toBe(true);
    expect(isAllowedOrigin('http://localhost:3000')).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:5173')).toBe(true);
    expect(isAllowedOrigin('http://localhost')).toBe(true);
    expect(isAllowedOrigin('https://evil.example')).toBe(false);
    expect(isAllowedOrigin('https://mhzcis.github.io.evil.example')).toBe(false);
    expect(isAllowedOrigin('http://localhost.evil.example')).toBe(false);
    expect(isAllowedOrigin(null)).toBe(false);
    expect(isAllowedOrigin('')).toBe(false);
  });
});

describe('sendViaProxy', () => {
  const msgs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, phone: '0590000001', text: 'رسالة تجريبية' }));

  it('converts local phones to E.164 and rejects invalid / placeholder phones without sending them', () => {
    const { items, rejected } = toProxyItems([
      { id: 'a', phone: '0590000001', text: 't' },
      { id: 'b', phone: '0590000000', text: 't' }, // placeholder
      { id: 'c', phone: 'abc', text: 't' },
    ]);
    expect(items).toEqual([{ id: 'a', phone: '+970590000001', text: 't' }]);
    expect(rejected.map(r => [r.id, r.error])).toEqual([['b', 'invalid_phone'], ['c', 'invalid_phone']]);
  });

  it('caps batches at 50 and returns a per-recipient result', async () => {
    const invoke = vi.fn(async (body: any) => ({ ok: true as const, results: body.messages.map((m: any) => ({ id: m.id, ok: m.id !== 'm3' })) }));
    const { results, fatalError } = await sendViaProxy(invoke, msgs(120), undefined, { batchSize: 500 });
    expect(invoke.mock.calls.map(c => (c[0] as any).messages.length)).toEqual([50, 50, 20]);
    expect(fatalError).toBeUndefined();
    expect(results).toHaveLength(120);
    expect(results.filter(r => !r.ok).map(r => r.id)).toEqual(['m3']);
  });

  it('stops on a request-level error (gateway not configured) and marks the rest failed', async () => {
    const invoke = vi.fn(async () => ({ ok: false as const, error: 'sms_gateway_not_configured' }));
    const { results, fatalError } = await sendViaProxy(invoke, msgs(120));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(fatalError).toBe('sms_gateway_not_configured');
    expect(results).toHaveLength(120);
    expect(results.every(r => !r.ok && r.error === 'sms_gateway_not_configured')).toBe(true);
    expect(proxyErrorMessage(fatalError)).toContain('غير مهيأة');
  });

  it('network exceptions become offline', async () => {
    const invoke = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    const { fatalError } = await sendViaProxy(invoke, msgs(2));
    expect(fatalError).toBe('offline');
  });

  it('sends nothing when there are no valid recipients', async () => {
    const invoke = vi.fn();
    const { results } = await sendViaProxy(invoke as any, [{ id: 'x', phone: '', text: 't' }]);
    expect(invoke).not.toHaveBeenCalled();
    expect(results[0].ok).toBe(false);
  });
});
