import { describe, expect, it } from 'vitest';
import { InMemorySchoolRepository } from './memoryRepo';
import type { MessageLog } from '../../types';

const log = (over: Partial<MessageLog>): MessageLog => ({
  id: 'x', studentId: '1', studentName: 'طالب تجريبي', parentName: 'ولي أمر', phone: '0590000001',
  grade: '1', section: 'أ', messageContent: 'نص', sentTime: new Date().toISOString(), status: 'pending',
  channel: 'gateway', gatewayMessageId: 'gw1', gatewayState: 'Pending', ...over,
} as MessageLog);

describe('updateGatewayStates', () => {
  it('updates forward, is idempotent and never downgrades', async () => {
    const repo = new InMemorySchoolRepository();
    const [stored] = await repo.addLogs([log({})]);
    expect(await repo.updateGatewayStates([{ logId: stored.id, gatewayState: 'Delivered', status: 'delivered' }])).toEqual([stored.id]);
    expect(await repo.updateGatewayStates([{ logId: stored.id, gatewayState: 'Delivered', status: 'delivered' }])).toEqual([]);
    expect(await repo.updateGatewayStates([{ logId: stored.id, gatewayState: 'Sent', status: 'sent' }])).toEqual([]);
    expect(await repo.updateGatewayStates([{ logId: 'unknown', gatewayState: 'Sent', status: 'sent' }])).toEqual([]);
    const data = await repo.loadAll();
    expect(data.logs[0].status).toBe('delivered');
    expect(data.logs[0].gatewayState).toBe('Delivered');
  });
});
