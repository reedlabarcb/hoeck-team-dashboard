import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/external/realnex/safe', () => ({ listUsers: vi.fn() }));

import {
  normalizeHistoryItem,
  normalizeHistoryPage,
  usersToNameMap,
  getUserNameMap,
  __resetUsersCacheForTest,
} from './history';
import { listUsers } from '@/lib/external/realnex/safe';

const users = new Map([['25d56bf5-aa26-4517-a404-fd524e83a98b', 'Jack Chapman']]);

describe('normalizeHistoryItem', () => {
  it('extracts nested eventType {key,name}, note fields, and resolves userKey (case-insensitive)', () => {
    const raw = {
      key: 'H1',
      userKey: '25D56BF5-AA26-4517-A404-FD524E83A98B', // uppercase — must still resolve
      startDate: '2027-04-30T00:00:00',
      eventType: { key: 15, name: 'Email' },
      subject: 'Received eblast',
      notes: 'body text',
    };
    expect(normalizeHistoryItem(raw, users)).toEqual({
      historyKey: 'H1',
      eventTypeKey: 15,
      eventTypeName: 'Email',
      subject: 'Received eblast',
      notes: 'body text',
      date: '2027-04-30T00:00:00',
      userKey: '25D56BF5-AA26-4517-A404-FD524E83A98B',
      userName: 'Jack Chapman',
    });
  });
  it('userName null when unresolved; missing fields degrade to null; eventTypeName falls back to key', () => {
    const n = normalizeHistoryItem({ userKey: 'nobody', eventType: { key: 18 } }, users);
    expect(n.userName).toBeNull();
    expect(n.notes).toBeNull();
    expect(n.eventTypeName).toBe('18');
  });
});

describe('normalizeHistoryPage', () => {
  it('sorts newest-first and passes through totals', () => {
    const raw = {
      totalCount: 2,
      pageNumber: 1,
      items: [
        { key: 'a', startDate: '2024-01-01T00:00:00', eventType: { key: 18, name: 'Note' } },
        { key: 'b', startDate: '2027-06-01T00:00:00', eventType: { key: 18, name: 'Note' } },
      ],
    };
    const p = normalizeHistoryPage(raw, 25, users);
    expect(p.totalCount).toBe(2);
    expect(p.pageNumber).toBe(1);
    expect(p.pageSize).toBe(25);
    expect(p.items.map((i) => i.historyKey)).toEqual(['b', 'a']); // newest first
  });
  it('empty items → empty page', () => {
    const p = normalizeHistoryPage({ totalCount: 0, pageNumber: 1, items: [] }, 25, users);
    expect(p.items).toEqual([]);
    expect(p.totalCount).toBe(0);
  });
});

describe('usersToNameMap', () => {
  it('array of {key,name}', () => {
    const m = usersToNameMap([{ key: 'K1', name: 'Alice' }, { key: 'K2', name: 'Bob' }]);
    expect(m.get('k1')).toBe('Alice');
    expect(m.get('k2')).toBe('Bob');
  });
  it('{value:[...]} envelope + PascalCase', () => {
    const m = usersToNameMap({ value: [{ Key: 'K3', Name: 'Carol' }] });
    expect(m.get('k3')).toBe('Carol');
  });
  it('object map key→name', () => {
    const m = usersToNameMap({ 'GUID-1': 'Dave' });
    expect(m.get('guid-1')).toBe('Dave');
  });
  it('real /Crm/users shape names the user in `userName` (not `name`)', () => {
    const m = usersToNameMap([{ key: '71412d25', userId: 'x', userName: 'Mike Hoeck', loginName: 'mike', active: true }]);
    expect(m.get('71412d25')).toBe('Mike Hoeck');
  });
});

describe('getUserNameMap caching', () => {
  beforeEach(() => {
    __resetUsersCacheForTest();
    vi.clearAllMocks();
    (listUsers as ReturnType<typeof vi.fn>).mockResolvedValue([{ key: 'K1', name: 'Alice' }]);
  });
  it('caches within the TTL, refreshes after it', async () => {
    const m1 = await getUserNameMap(1_000);
    expect(m1.get('k1')).toBe('Alice');
    await getUserNameMap(1_000 + 60_000); // within 10 min
    expect(listUsers).toHaveBeenCalledTimes(1); // served from cache
    await getUserNameMap(1_000 + 11 * 60_000); // past TTL
    expect(listUsers).toHaveBeenCalledTimes(2); // refreshed
  });
  it('swallows listUsers errors → empty map', async () => {
    __resetUsersCacheForTest();
    (listUsers as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    const m = await getUserNameMap(50_000);
    expect(m.size).toBe(0);
  });
});
