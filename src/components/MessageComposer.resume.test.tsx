// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();
vi.mock('../lib/supabase', () => ({ invokeSmsFunction: (body: unknown) => invokeMock(body) }));
vi.mock('../lib/smsProxy', async (orig) => {
  const real = await orig<typeof import('../lib/smsProxy')>();
  return { ...real, pollMessageStatus: vi.fn(async () => new Map()) };
});

import MessageComposer from './MessageComposer';
import { applyResults, BULK_JOB_KEY, createJob, markInflight, readJob, writeJob } from '../lib/bulkSendJob';
import { buildDispatchItems } from '../lib/recipients';
import type { Student } from '../types';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Fake fixtures only.
const fake = (n: number): Student =>
  ({ id: `s${n}`, name: `طالب تجريبي ${n}`, parentName: 'ولي', phone: `05900000${String(n).padStart(2, '0')}`, phone2: '', grade: 'العاشر', section: 'أ' }) as Student;
const students = [1, 2, 3, 4, 5].map(fake);
const TPL = 'تجربة {{اسم_الطالب}}';

let container: HTMLDivElement;
let root: Root;
const onSendImmediate = vi.fn();

function seedPausedJob() {
  const { items } = buildDispatchItems(students, 'primary', TPL);
  let { job } = createJob(items, { id: 'job-test', title: 'حملة تجريبية', contentTemplate: TPL, phoneTarget: 'primary' });
  job = markInflight(job, ['m0', 'm1']);
  job = applyResults(job, [
    { id: 'm0', ok: true, gatewayMessageId: 'g0' },
    { id: 'm1', ok: true, gatewayMessageId: 'g1' },
    { id: 'm2', ok: false, error: 'aborted' },
    { id: 'm3', ok: false, error: 'aborted' },
    { id: 'm4', ok: false, error: 'aborted' },
  ], { pauseReason: 'manual' });
  writeJob(job);
}

function render(props: Partial<React.ComponentProps<typeof MessageComposer>> = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(
    <MessageComposer
      students={students}
      templates={[]}
      onSendImmediate={onSendImmediate}
      onScheduleMessage={() => {}}
      schoolName="مدرسة تجريبية"
      onUpdateSchoolName={() => {}}
      {...props}
    />
  ));
}
const $ = (sel: string) => container.querySelector(sel) as HTMLElement | null;
const click = (sel: string) => act(() => { ($(sel) as HTMLButtonElement).click(); });
const flush = () => act(async () => { for (let i = 0; i < 30; i++) await new Promise(r => setTimeout(r, 2)); });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-22T08:00:00Z')); // 10:00 Asia/Jerusalem (outside quiet hours)
  localStorage.setItem('sn_use_cloud_gateway', 'true');
  localStorage.setItem('sn_sms_batch_delay_sec', '0');
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (body: any) => ({
    ok: true,
    results: (body.messages ?? []).map((m: any) => ({ id: m.id, ok: true, gatewayMessageId: `gw-${m.id}` })),
  }));
  onSendImmediate.mockReset();
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  localStorage.clear();
  vi.useRealTimers();
});

describe('MessageComposer durable pause/resume', () => {
  it('shows a paused job after a reload and resumes ONLY the not-yet-sent recipients', async () => {
    seedPausedJob();
    render();
    expect($('#paused-bulk-send-banner')).not.toBeNull();
    expect($('#paused-bulk-send-counts')!.textContent).toContain('3');
    click('#btn-resume-bulk-send');
    await flush();
    // the normal confirmation (counts, quiet hours, typed count >= 30) is shown again
    expect($('#confirm-send-dialog')).not.toBeNull();
    expect($('#confirm-message-count')!.textContent).toBe('3');
    expect(invokeMock).not.toHaveBeenCalled();
    click('#confirm-send-button');
    await flush();
    const sent = invokeMock.mock.calls.filter(c => c[0].action === 'send').flatMap(c => c[0].messages);
    expect(sent.map((m: any) => m.id).sort()).toEqual(['m2', 'm3', 'm4']);
    expect(sent.map((m: any) => m.phone)).not.toContain('+970590000001');
    expect(sent.map((m: any) => m.phone)).not.toContain('+970590000002');
    expect(readJob()).toBeNull(); // finished → cleared
    expect(onSendImmediate).toHaveBeenCalledTimes(1);
    expect(onSendImmediate.mock.calls[0][0]).toHaveLength(3);
  });

  it('skips numbers added to the do-not-send list while paused', async () => {
    seedPausedJob();
    render({ suppressedPhones: new Set(['0590000003']) });
    click('#btn-resume-bulk-send');
    await flush();
    expect($('#confirm-message-count')!.textContent).toBe('2');
    click('#confirm-send-button');
    await flush();
    const sent = invokeMock.mock.calls.flatMap(c => c[0].messages ?? []);
    expect(sent.map((m: any) => m.id).sort()).toEqual(['m3', 'm4']);
  });

  it('needs the quiet-hours override to resume between 22:00 and 07:00', async () => {
    vi.setSystemTime(new Date('2026-11-22T21:30:00Z')); // 23:30 Jerusalem
    seedPausedJob();
    render();
    click('#btn-resume-bulk-send');
    await flush();
    expect($('#confirm-quiet-hours')).not.toBeNull();
    expect(($('#confirm-send-button') as HTMLButtonElement).disabled).toBe(true);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('blocks starting a new gateway send while a paused job exists, and discard needs an inline confirm', async () => {
    seedPausedJob();
    render();
    click('#btn-discard-bulk-send');
    expect($('#discard-bulk-send-confirm')).not.toBeNull();
    expect(localStorage.getItem(BULK_JOB_KEY)).not.toBeNull();
    click('#btn-discard-bulk-send-cancel');
    expect(localStorage.getItem(BULK_JOB_KEY)).not.toBeNull();
    click('#btn-discard-bulk-send');
    click('#btn-discard-bulk-send-confirm');
    expect(localStorage.getItem(BULK_JOB_KEY)).toBeNull();
    expect($('#paused-bulk-send-banner')).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('a job interrupted mid-batch (reload) never re-sends the in-flight messages', async () => {
    const { items } = buildDispatchItems(students, 'primary', TPL);
    let { job } = createJob(items, { id: 'job-crash', title: 'حملة', contentTemplate: TPL, phoneTarget: 'primary' });
    job = markInflight(job, ['m0', 'm1']); // status running, request sent, page reloaded before the answer
    writeJob(job);
    render();
    expect($('#paused-bulk-send-unknown')).not.toBeNull();
    click('#btn-resume-bulk-send');
    await flush();
    click('#confirm-send-button');
    await flush();
    const sent = invokeMock.mock.calls.flatMap(c => c[0].messages ?? []);
    expect(sent.map((m: any) => m.id).sort()).toEqual(['m2', 'm3', 'm4']);
    // the unknown ones stay visible for the teacher to check
    expect(readJob()?.entries.filter(e => e.state === 'unknown').map(e => e.key)).toEqual(['m0', 'm1']);
  });
});
