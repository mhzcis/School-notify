// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import App from './App';
import { InMemorySchoolRepository } from './lib/repo/memoryRepo';
import { RepoError } from './lib/repo/types';
import { fakeStudents } from './test/fixtures';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const USER = { id: '00000000-0000-4000-8000-000000000001', email: 'teacher@example.test' };
let container: HTMLDivElement;
let root: Root;

async function render(el: any) {
  await act(async () => { root.render(el); });
  // let the async load settle
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('App with cloud repository', () => {
  it('loads from the repository and never reads or deletes legacy resal_* keys', async () => {
    const legacy = JSON.stringify([{ id: '1000000099', name: 'طالب تجريبي قديم' }]);
    localStorage.setItem('resal_students', legacy);
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem');
    const repo = new InMemorySchoolRepository({ students: fakeStudents(3) });
    const load = vi.spyOn(repo, 'loadAll');
    await render(<App repo={repo} user={USER} onSignOut={() => {}} checkGateway={async () => ({ ok: false, error: 'sms_gateway_not_configured' })} />);
    expect(container.querySelector('#resal-app-root')).not.toBeNull();
    expect(load).toHaveBeenCalled();
    expect(getItem.mock.calls.length).toBeGreaterThan(0);
    expect(getItem.mock.calls.some(([k]) => String(k).startsWith('resal_'))).toBe(false);
    expect(removeItem.mock.calls.some(([k]) => String(k).startsWith('resal_'))).toBe(false);
    expect(localStorage.getItem('resal_students')).toBe(legacy);
    // default templates seeded into the cloud once
    expect((await repo.loadAll()).templates.length).toBeGreaterThan(0);
    expect(container.textContent).toContain('teacher@example.test');
  });

  it('shows the real gateway status and logs out', async () => {
    const onSignOut = vi.fn();
    await render(<App repo={new InMemorySchoolRepository()} user={USER} onSignOut={onSignOut} checkGateway={async () => ({ ok: false, error: 'sms_gateway_not_configured' })} />);
    const status = container.querySelector('#sidebar-gateway-status') as HTMLElement;
    expect(status.dataset.status).toBe('not_configured');
    expect((container.querySelector('#sidebar-cloud-status') as HTMLElement).dataset.status).toBe('online');
    await act(async () => { (container.querySelector('#logout-button') as HTMLButtonElement).click(); });
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('gateway status configured when the function reports it', async () => {
    await render(<App repo={new InMemorySchoolRepository()} user={USER} onSignOut={() => {}} checkGateway={async () => ({ ok: true, configured: true } as any)} />);
    expect((container.querySelector('#sidebar-gateway-status') as HTMLElement).dataset.status).toBe('configured');
  });

  it('shows a load error with retry, and reports auth failures', async () => {
    const repo = new InMemorySchoolRepository();
    repo.failNext = 'auth';
    const onAuthFailure = vi.fn();
    await render(<App repo={repo} user={USER} onSignOut={() => {}} onAuthFailure={onAuthFailure} checkGateway={async () => ({ ok: true } as any)} />);
    expect(container.querySelector('#app-load-error')).not.toBeNull();
    expect(onAuthFailure).toHaveBeenCalled();
    expect(container.querySelector('#resal-app-root')).toBeNull();
    expect(new RepoError('auth', 'x').kind).toBe('auth');
  });
});
