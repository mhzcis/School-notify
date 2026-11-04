import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { MAX_AGE_SEC, mergeState, parseEvent, verifySignature, logStatusForState } from '../../supabase/functions/school-notify-sms-webhook/webhook';

const KEY = 'test-signing-key';
const sign = (body: string, ts: string, key = KEY) => createHmac('sha256', key).update(body + ts).digest('hex');
const NOW = 1_800_000_000;
const body = JSON.stringify({
  deviceId: 'dev1', event: 'sms:delivered', id: 'evt1', webhookId: 'wh1',
  payload: { messageId: 'gwMsg_123', sender: '+970590000001', recipient: '+970590000001', simNumber: 1, deliveredAt: '2026-11-04T10:00:00Z' },
});

describe('verifySignature', () => {
  it('accepts a valid signature (raw body + timestamp)', async () => {
    const ts = String(NOW - 10);
    expect(await verifySignature(KEY, body, ts, sign(body, ts), NOW)).toBe('ok');
    expect(await verifySignature(KEY, body, ts, sign(body, ts).toUpperCase(), NOW)).toBe('ok');
  });
  it('rejects a wrong key, tampered body or garbage signature', async () => {
    const ts = String(NOW);
    expect(await verifySignature(KEY, body, ts, sign(body, ts, 'other'), NOW)).toBe('bad_signature');
    expect(await verifySignature(KEY, body + ' ', ts, sign(body, ts), NOW)).toBe('bad_signature');
    expect(await verifySignature(KEY, body, ts, 'abc', NOW)).toBe('bad_signature');
    // timestamp is part of the signed message
    expect(await verifySignature(KEY, body, String(NOW - 1), sign(body, ts), NOW)).toBe('bad_signature');
  });
  it('rejects stale or future timestamps', async () => {
    const old = String(NOW - MAX_AGE_SEC - 1);
    expect(await verifySignature(KEY, body, old, sign(body, old), NOW)).toBe('stale');
    const fut = String(NOW + 3600);
    expect(await verifySignature(KEY, body, fut, sign(body, fut), NOW)).toBe('stale');
    expect(await verifySignature(KEY, body, 'x1', sign(body, 'x1'), NOW)).toBe('stale');
  });
  it('rejects unsigned requests and a missing key', async () => {
    const ts = String(NOW);
    expect(await verifySignature(KEY, body, null, sign(body, ts), NOW)).toBe('missing');
    expect(await verifySignature(KEY, body, ts, null, NOW)).toBe('missing');
    expect(await verifySignature('', body, ts, sign(body, ts, ''), NOW)).toBe('missing');
  });
});

describe('mergeState (idempotent, never downgrade)', () => {
  it('moves forward only', () => {
    expect(mergeState(undefined, 'Sent')).toBe('Sent');
    expect(mergeState('Pending', 'Processed')).toBe('Processed');
    expect(mergeState('Sent', 'Delivered')).toBe('Delivered');
    expect(mergeState('Sent', 'Failed')).toBe('Failed');
  });
  it('is idempotent and never downgrades', () => {
    expect(mergeState('Sent', 'Sent')).toBeNull();
    expect(mergeState('Delivered', 'Delivered')).toBeNull();
    expect(mergeState('Delivered', 'Sent')).toBeNull();
    expect(mergeState('Delivered', 'Failed')).toBeNull();
    expect(mergeState('Failed', 'Delivered')).toBeNull();
    expect(mergeState('Sent', 'Processed')).toBeNull();
    expect(mergeState('Sent', 'Bogus')).toBeNull();
  });
  it('maps to app log statuses', () => {
    expect(logStatusForState('Delivered')).toBe('delivered');
    expect(logStatusForState('Cancelled')).toBe('failed');
    expect(logStatusForState('Processed')).toBe('pending');
  });
});

describe('parseEvent', () => {
  it('extracts gateway id + state only (no phones)', () => {
    const ev = parseEvent(JSON.parse(body));
    expect(ev).toEqual({ gatewayId: 'gwMsg_123', state: 'Delivered' });
    expect(JSON.stringify(ev)).not.toContain('0590000001');
  });
  it('masks digits in failure reasons', () => {
    const ev = parseEvent({ event: 'sms:failed', payload: { messageId: 'a1', reason: 'RESULT_RIL_MODEM_ERR to 0590000001' } });
    expect(ev).toEqual({ gatewayId: 'a1', state: 'Failed', error: 'RESULT_RIL_MODEM_ERR to ***' });
  });
  it('ignores untracked events and invalid ids', () => {
    expect(parseEvent({ event: 'system:ping', payload: {} })).toBeNull();
    expect(parseEvent({ event: 'sms:received', payload: { messageId: 'a1' } })).toBeNull();
    expect(parseEvent({ event: 'sms:sent', payload: { messageId: '../x' } })).toBeNull();
    expect(parseEvent(null)).toBeNull();
  });
});
