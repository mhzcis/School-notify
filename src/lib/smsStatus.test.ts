import { afterEach, describe, expect, it, vi } from 'vitest';
import { GATEWAY_ID_RE, MAX_STATUS_IDS, validateProxyRequest } from '../../supabase/functions/school-notify-sms/validate';
import { parseMessageState, sendOne, statusMany, SMSGATE_STATUS_URL } from '../../supabase/functions/school-notify-sms/gateway';
import {
  countGatewayStates, gatewayCountsText, pollMessageStatus, sendViaProxy, sleep, DEFAULT_BATCH_SIZE,
} from './smsProxy';
import { statusFromGatewayState } from './logStatus';
import { logToRow, rowToLog } from './repo/mapping';

const msgs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, phone: '0590000001', text: 'رسالة تجريبية' }));
const okInvoke = () =>
  vi.fn(async (body: any) => ({ ok: true as const, results: body.messages.map((m: any) => ({ id: m.id, ok: true, gatewayMessageId: `g${m.id}` })) }));

afterEach(() => vi.useRealTimers());

describe('validate messageStatus', () => {
  it('accepts a list of gateway ids', () => {
    expect(validateProxyRequest({ action: 'messageStatus', ids: ['PyDmBQZZXYmyxMwED8Fzy'] })).toEqual({
      ok: true, value: { action: 'messageStatus', ids: ['PyDmBQZZXYmyxMwED8Fzy'] },
    });
  });
  it.each([
    [{ action: 'messageStatus' }, 'no_ids'],
    [{ action: 'messageStatus', ids: [] }, 'no_ids'],
    [{ action: 'messageStatus', ids: Array.from({ length: MAX_STATUS_IDS + 1 }, (_, i) => `id${i}`) }, 'too_many_ids'],
    [{ action: 'messageStatus', ids: ['../etc'] }, 'invalid_id'],
    [{ action: 'messageStatus', ids: ['a'.repeat(37)] }, 'invalid_id'],
    [{ action: 'messageStatus', ids: ['a', 'a'] }, 'invalid_id'],
    [{ action: 'messageStatus', ids: [5] }, 'invalid_id'],
  ])('rejects %j with %s', (body, code) => {
    expect((validateProxyRequest(body) as any).error).toBe(code);
  });
  it('id regex blocks path characters', () => {
    expect(GATEWAY_ID_RE.test('abc/def')).toBe(false);
    expect(GATEWAY_ID_RE.test('abc-DEF_1')).toBe(true);
  });
});

describe('edge gateway helpers (mock fetch)', () => {
  const res = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status });

  it('parses state and per-recipient error without phone numbers', () => {
    const r = parseMessageState('g1', {
      id: 'g1', state: 'Failed', recipients: [{ phoneNumber: '+970590000001', state: 'Failed', error: 'RESULT_ERROR_GENERIC_FAILURE +970590000001' }],
    });
    expect(r.state).toBe('Failed');
    expect(r.error).toContain('RESULT_ERROR');
    expect(JSON.stringify(r)).not.toContain('0590000001');
    expect(parseMessageState('g2', { state: 'Weird' }).state).toBe('Unknown');
  });

  it('GETs /3rdparty/v1/messages/{id} with Basic auth and stops after auth failure', async () => {
    const f = vi.fn(async (url: string, _init?: RequestInit) => (url.endsWith('/g1') ? res(200, { id: 'g1', state: 'Sent', recipients: [] }) : res(401)));
    const out = await statusMany(['g1', 'g2', 'g3'], 'Basic x', f as any);
    expect(f.mock.calls[0][0]).toBe(SMSGATE_STATUS_URL('g1'));
    expect(f.mock.calls[0][0]).toBe('https://api.sms-gate.app/3rdparty/v1/messages/g1');
    expect((f.mock.calls[0][1] as any).headers.Authorization).toBe('Basic x');
    expect(f).toHaveBeenCalledTimes(2);
    expect(out.map(o => [o.id, o.state, o.error])).toEqual([
      ['g1', 'Sent', undefined], ['g2', 'Unknown', 'gateway_auth_failed'], ['g3', 'Unknown', 'gateway_auth_failed'],
    ]);
  });

  it('maps 404 / network errors', async () => {
    const f = vi.fn(async (url: string) => {
      if (url.endsWith('/a')) return res(404);
      throw new TypeError('net');
    });
    const out = await statusMany(['a', 'b'], 'Basic x', f as any);
    expect(out.map(o => o.error)).toEqual(['not_found', 'gateway_unreachable']);
  });

  it('sendOne returns the gateway message id', async () => {
    const f = vi.fn(async () => res(202, { id: 'g9', state: 'Pending', recipients: [] }));
    const r = await sendOne({ id: 'm1', phone: '+970590000001', text: 't' }, 'Basic x', f as any);
    expect(r).toEqual({ id: 'm1', ok: true, gatewayMessageId: 'g9' });
  });
});

describe('sendViaProxy batching', () => {
  it('defaults to batches of 5 in order, waiting the delay between batches (fake timers)', async () => {
    vi.useFakeTimers();
    const invoke = okInvoke();
    const p = sendViaProxy(invoke, msgs(12), undefined, { delayMs: 10_000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(invoke).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(invoke).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(invoke).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10_000);
    const { results } = await p;
    expect(DEFAULT_BATCH_SIZE).toBe(5);
    expect(invoke.mock.calls.map(c => (c[0] as any).messages.map((m: any) => m.id))).toEqual([
      ['m0', 'm1', 'm2', 'm3', 'm4'], ['m5', 'm6', 'm7', 'm8', 'm9'], ['m10', 'm11'],
    ]);
    expect(results.map(r => r.id)).toEqual(msgs(12).map(m => m.id));
  });

  it('abort stops before the next batch and reports the rest as aborted', async () => {
    vi.useFakeTimers();
    const invoke = okInvoke();
    const ctrl = new AbortController();
    const progress = vi.fn();
    const p = sendViaProxy(invoke, msgs(12), progress, { delayMs: 10_000, signal: ctrl.signal });
    await vi.advanceTimersByTimeAsync(1_000);
    ctrl.abort();
    const { results, aborted } = await p;
    expect(aborted).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(results.filter(r => r.ok)).toHaveLength(5);
    expect(results.filter(r => r.error === 'aborted')).toHaveLength(7);
    expect(progress).toHaveBeenCalledTimes(2);
  });

  it('partial failures in a batch keep going', async () => {
    const invoke = vi.fn(async (body: any) => ({
      ok: true as const, results: body.messages.map((m: any) => ({ id: m.id, ok: m.id !== 'm6', error: m.id === 'm6' ? 'gateway_rejected' : undefined })),
    }));
    const { results } = await sendViaProxy(invoke, msgs(7), undefined, { sleep: async () => {} });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(results.filter(r => !r.ok).map(r => r.id)).toEqual(['m6']);
  });

  it('sleep resolves early on abort', async () => {
    vi.useFakeTimers();
    const c = new AbortController();
    const p = sleep(60_000, c.signal);
    c.abort();
    await expect(p).resolves.toBeUndefined();
  });
});

describe('pollMessageStatus', () => {
  it('polls only open ids until all are final', async () => {
    vi.useFakeTimers();
    const seq: Record<string, string[]> = { g1: ['Processed', 'Sent'], g2: ['Failed'], g3: ['Pending', 'Processed', 'Delivered'] };
    const invoke = vi.fn(async (body: any) => ({
      ok: true as const,
      statuses: body.ids.map((id: string) => {
        const st = seq[id].shift() ?? 'Delivered';
        return st === 'Failed' ? { id, state: st, error: 'timeout' } : { id, state: st };
      }),
    }));
    const onUpdate = vi.fn();
    const p = pollMessageStatus(invoke as any, ['g1', 'g2', 'g3'], { intervalMs: 5_000, timeoutMs: 120_000, onUpdate });
    await vi.advanceTimersByTimeAsync(20_000);
    const map = await p;
    expect(invoke.mock.calls.map(c => (c[0] as any).ids)).toEqual([['g1', 'g2', 'g3'], ['g1', 'g3'], ['g3']]);
    expect([...map.values()].map(s => s.state)).toEqual(['Sent', 'Failed', 'Delivered']);
    expect(map.get('g2')!.error).toBe('timeout');
    expect(onUpdate).toHaveBeenCalledTimes(3);
    const c = countGatewayStates(map.values());
    expect(c).toEqual({ accepted: 3, pending: 0, sent: 1, delivered: 1, failed: 1 });
    expect(gatewayCountsText(c)).toContain('قبلتها البوابة: 3');
  });

  it('is bounded by timeout and leaves still-open messages pending', async () => {
    vi.useFakeTimers();
    const invoke = vi.fn(async (body: any) => ({ ok: true as const, statuses: body.ids.map((id: string) => ({ id, state: 'Pending' })) }));
    const p = pollMessageStatus(invoke as any, ['g1'], { intervalMs: 10_000, timeoutMs: 30_000 });
    await vi.advanceTimersByTimeAsync(60_000);
    const map = await p;
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(map.get('g1')!.state).toBe('Pending');
  });

  it('stops on unauthorized and never overwrites with Unknown', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ ok: true, statuses: [{ id: 'g1', state: 'Processed' }, { id: 'g2', state: 'Unknown', error: 'gateway_timeout' }] })
      .mockResolvedValueOnce({ ok: false, error: 'unauthorized' });
    const map = await pollMessageStatus(invoke, ['g1', 'g2'], { sleep: async () => {}, intervalMs: 1, timeoutMs: 100 });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(map.get('g1')!.state).toBe('Processed');
    expect(map.get('g2')!.state).toBe('Pending');
  });

  it('chunks more than 50 ids per request', async () => {
    const ids = Array.from({ length: 60 }, (_, i) => `g${i}`);
    const invoke = vi.fn(async (body: any) => ({ ok: true as const, statuses: body.ids.map((id: string) => ({ id, state: 'Sent' })) }));
    await pollMessageStatus(invoke as any, ids, { sleep: async () => {} });
    expect(invoke.mock.calls.map(c => (c[0] as any).ids.length)).toEqual([50, 10]);
  });
});

describe('log status from gateway state', () => {
  it('marks sent only for Sent/Delivered', () => {
    expect(statusFromGatewayState('Sent')).toBe('sent');
    expect(statusFromGatewayState('Delivered')).toBe('delivered');
    expect(statusFromGatewayState('Failed')).toBe('failed');
    expect(statusFromGatewayState('Pending')).toBe('pending');
    expect(statusFromGatewayState('Processed')).toBe('pending');
    expect(statusFromGatewayState(undefined)).toBe('pending');
  });

  it('round-trips gateway meta and reads old rows without it', () => {
    const log = {
      id: '00000000-0000-4000-8000-000000000001', studentId: 's1', studentName: 'طالب تجريبي', parentName: 'ولي أمر تجريبي',
      phone: '0590000001', grade: 'g', section: 'a', messageContent: 'x', sentTime: '2026-01-01T00:00:00Z',
      status: 'pending' as const, channel: 'gateway' as const, gatewayMessageId: 'g1', gatewayState: 'Processed',
    };
    const row = logToRow(log as any, 'o', 'c', null);
    expect(row.meta).toMatchObject({ gatewayMessageId: 'g1', gatewayState: 'Processed' });
    expect(rowToLog(row)).toMatchObject({ gatewayMessageId: 'g1', gatewayState: 'Processed', status: 'pending' });
    const old = rowToLog({ ...row, meta: { appStudentId: 's1' } });
    expect(old.gatewayState).toBeUndefined();
  });
});
