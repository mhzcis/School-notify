import { describe, expect, it, vi } from 'vitest';
import {
  applyResults, applySkips, BULK_JOB_KEY, clearJob, createJob, hashPhone, jobCounts, jobHasRemaining, jobNeedsAttention,
  markInflight, planResume, readJob, recoverAfterReload, writeJob,
} from './bulkSendJob';
import { buildDispatchItems } from './recipients';
import { sendViaProxy } from './smsProxy';
import type { Student } from '../types';

// Fake fixtures only.
const fake = (n: number, phone = `05900000${String(n).padStart(2, '0')}`): Student =>
  ({ id: `s${n}`, name: `طالب تجريبي ${n}`, parentName: 'ولي', phone, phone2: '', grade: 'العاشر', section: 'أ' }) as Student;
const students = [fake(1), fake(2), fake(3), fake(4)];
const TPL = 'مرحبا {{اسم_الطالب}}';

function newJob(list = students) {
  const { items } = buildDispatchItems(list, 'primary', TPL);
  return createJob(items, { id: 'job1', title: 'حملة تجريبية', contentTemplate: TPL, phoneTarget: 'primary' });
}

describe('bulk send job state', () => {
  it('stores no message bodies and no raw phone numbers', () => {
    const { job } = newJob();
    const json = JSON.stringify(job);
    expect(json).not.toContain('0590000001');
    expect(json).not.toContain('طالب تجريبي 1');
    expect(job.entries[0].phoneHash).toBe(hashPhone('0590000001'));
    expect(hashPhone('+970590000001')).toBe(hashPhone('0590000001'));
  });

  it('accepted are final, aborted go back to queued, per-item errors fail', () => {
    let { job } = newJob();
    job = markInflight(job, ['m0', 'm1']);
    job = applyResults(job, [
      { id: 'm0', ok: true, gatewayMessageId: 'g0' },
      { id: 'm1', ok: false, error: 'gateway_rejected' },
      { id: 'm2', ok: false, error: 'aborted' },
      { id: 'm3', ok: false, error: 'aborted' },
    ], { pauseReason: 'manual' });
    expect(job.entries.map(e => e.state)).toEqual(['accepted', 'failed', 'queued', 'queued']);
    expect(job.status).toBe('paused');
    expect(job.pauseReason).toBe('manual');
    expect(jobHasRemaining(job)).toBe(true);
  });

  it('a network drop while a batch is in flight marks it unknown (never auto-resent)', () => {
    let { job } = newJob();
    job = markInflight(job, ['m0', 'm1']);
    job = applyResults(job, ['m0', 'm1', 'm2', 'm3'].map(id => ({ id, ok: false, error: 'offline' })), { fatalError: 'offline' });
    expect(job.entries.map(e => e.state)).toEqual(['unknown', 'unknown', 'queued', 'queued']);
    expect(job.pauseReason).toBe('error');
  });

  it('a request refused before sending (e.g. not configured / wrong gateway password) keeps items queued', () => {
    let { job } = newJob();
    job = markInflight(job, ['m0', 'm1']);
    job = applyResults(job, [
      { id: 'm0', ok: false, error: 'gateway_auth_failed' },
      { id: 'm1', ok: false, error: 'gateway_auth_failed' },
      { id: 'm2', ok: false, error: 'aborted' },
      { id: 'm3', ok: false, error: 'aborted' },
    ]);
    expect(jobCounts(job).queued).toBe(4);
    expect(job.lastError).toBe('gateway_auth_failed');
    let { job: j2 } = newJob();
    j2 = markInflight(j2, ['m0']);
    j2 = applyResults(j2, j2.entries.map(e => ({ id: e.key, ok: false, error: 'sms_gateway_not_configured' })), { fatalError: 'sms_gateway_not_configured' });
    expect(jobCounts(j2).queued).toBe(4);
  });

  it('after a reload a running job is paused and in-flight entries become unknown', () => {
    let { job } = newJob();
    job = applyResults(markInflight(job, ['m0']), [{ id: 'm0', ok: true, gatewayMessageId: 'g0' }]);
    job = markInflight({ ...job, status: 'running' }, ['m1']);
    const rec = recoverAfterReload(job);
    expect(rec.status).toBe('paused');
    expect(rec.pauseReason).toBe('reload');
    expect(rec.entries.map(e => e.state)).toEqual(['accepted', 'unknown', 'queued', 'queued']);
  });

  it('finishes when nothing is left; unknowns still need attention', () => {
    let { job } = newJob([fake(1)]);
    job = applyResults(markInflight(job, ['m0']), [{ id: 'm0', ok: true }]);
    expect(job.status).toBe('finished');
    expect(jobNeedsAttention(job)).toBe(false);
    let { job: j2 } = newJob([fake(1)]);
    j2 = recoverAfterReload(markInflight(j2, ['m0']));
    expect(j2.status).toBe('finished');
    expect(jobNeedsAttention(j2)).toBe(true);
  });

  it('resume plans only queued entries, from current data, skipping suppressed / removed / changed numbers', () => {
    let { job } = newJob();
    job = applyResults(markInflight(job, ['m0']), [{ id: 'm0', ok: true }, { id: 'm1', ok: false, error: 'aborted' }, { id: 'm2', ok: false, error: 'aborted' }, { id: 'm3', ok: false, error: 'aborted' }]);
    const current = [fake(1), fake(2), fake(3, '0590000099')]; // s4 deleted, s3 number changed
    const plan = planResume(job, current, undefined as never, new Set(['0590000002'])); // s2 now suppressed
    expect(plan.keyed).toEqual([]);
    expect(plan.skipped.map(s => [s.key, s.reason])).toEqual([['m1', 'suppressed'], ['m2', 'phone_changed'], ['m3', 'student_missing']]);
    const after = applySkips(job, plan.skipped);
    expect(jobCounts(after)).toMatchObject({ accepted: 1, skipped: 3, queued: 0 });

    const plan2 = planResume(job, students, (tpl, s) => tpl.replace('{{اسم_الطالب}}', s.name));
    expect(plan2.keyed.map(k => k.key)).toEqual(['m1', 'm2', 'm3']);
    expect(plan2.keyed[0].item.content).toBe('مرحبا طالب تجريبي 2');
  });

  it('persists to localStorage and ignores malformed data', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    const { job } = newJob();
    writeJob(job, storage);
    expect(readJob(storage)?.entries.length).toBe(4);
    store.set(BULK_JOB_KEY, '{"v":1,"entries":"x"}');
    expect(readJob(storage)).toBeNull();
    clearJob(storage);
    expect(store.has(BULK_JOB_KEY)).toBe(false);
  });
});

describe('sendViaProxy hooks used by pause/resume', () => {
  it('calls onBatchStart before each request and stops before the next batch when shouldStop is true', async () => {
    const order: string[] = [];
    const invoke = vi.fn(async (body: any) => {
      order.push(`send:${body.messages.map((m: any) => m.id).join(',')}`);
      return { ok: true as const, results: body.messages.map((m: any) => ({ id: m.id, ok: true, gatewayMessageId: `g-${m.id}` })) };
    });
    let batches = 0;
    const msgs = Array.from({ length: 7 }, (_, i) => ({ id: `m${i}`, phone: `05900000${String(i + 10)}`, text: 'نص تجريبي' }));
    const res = await sendViaProxy(invoke, msgs, undefined, {
      batchSize: 3,
      onBatchStart: ids => { order.push(`start:${ids.join(',')}`); batches += 1; },
      shouldStop: () => batches >= 2,
    });
    expect(order).toEqual(['start:m0,m1,m2', 'send:m0,m1,m2', 'start:m3,m4,m5', 'send:m3,m4,m5']);
    expect(res.aborted).toBe(true);
    expect(res.results.filter(r => r.error === 'aborted').map(r => r.id)).toEqual(['m6']);
  });
});
