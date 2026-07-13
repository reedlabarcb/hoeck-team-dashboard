import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/external/realnex/safe', () => ({ getObjectHistory: vi.fn(), listUsers: vi.fn() }));

import { GET } from './route';
import { getSession } from '@/lib/auth/session';
import { getObjectHistory, listUsers } from '@/lib/external/realnex/safe';
import { __resetUsersCacheForTest } from '@/lib/realnex/history';

/* eslint-disable @typescript-eslint/no-explicit-any */
const mkReq = (qs: string) => new Request(`http://test/api/realnex/history${qs}`) as any;
const authed = () => (getSession as any).mockResolvedValue({ user: { id: 'u1' } });

beforeEach(() => {
  vi.clearAllMocks();
  __resetUsersCacheForTest();
  (listUsers as any).mockResolvedValue([{ key: '25d56bf5', name: 'Jack Chapman' }]);
});

describe('GET /api/realnex/history', () => {
  it('401 when unauthenticated; no read', async () => {
    (getSession as any).mockResolvedValue({ user: null });
    const res = await GET(mkReq('?key=X'));
    expect(res.status).toBe(401);
    expect(getObjectHistory).not.toHaveBeenCalled();
  });

  it('400 when key is missing', async () => {
    authed();
    const res = await GET(mkReq(''));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('missing_key');
    expect(getObjectHistory).not.toHaveBeenCalled();
  });

  it('200 returns the normalized page with userKey resolved to a name', async () => {
    authed();
    (getObjectHistory as any).mockResolvedValue({
      totalCount: 1,
      pageNumber: 1,
      items: [
        { key: 'H1', userKey: '25D56BF5', startDate: '2027-04-30T00:00:00', eventType: { key: 18, name: 'Note' }, subject: 's', notes: 'the note body' },
      ],
    });
    const res = await GET(mkReq('?key=ABC-KEY'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ totalCount: 1, pageNumber: 1, pageSize: 25 });
    expect(body.items[0]).toMatchObject({
      historyKey: 'H1',
      eventTypeName: 'Note',
      notes: 'the note body',
      date: '2027-04-30T00:00:00',
      userName: 'Jack Chapman', // resolved from userKey via listUsers
    });
    expect(getObjectHistory).toHaveBeenCalledWith('ABC-KEY', { pageNumber: 1, pageSize: 25 });
  });

  it('page param drives pageNumber', async () => {
    authed();
    (getObjectHistory as any).mockResolvedValue({ totalCount: 0, pageNumber: 3, items: [] });
    await GET(mkReq('?key=ABC&page=3'));
    expect(getObjectHistory).toHaveBeenCalledWith('ABC', { pageNumber: 3, pageSize: 25 });
  });
});
