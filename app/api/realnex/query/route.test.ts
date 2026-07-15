import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/realnex/queries', () => ({ runQuery: vi.fn() }));

import { GET } from './route';
import { getSession } from '@/lib/auth/session';
import { runQuery } from '@/lib/realnex/queries';

/* eslint-disable @typescript-eslint/no-explicit-any */
const mkReq = (qs: string) => new Request(`http://test/api/realnex/query${qs}`) as any;
const authed = () => (getSession as any).mockResolvedValue({ user: { id: 'u1' } });

beforeEach(() => {
  vi.clearAllMocks();
  (runQuery as any).mockResolvedValue({ rows: [], total: 0 });
});

describe('GET /api/realnex/query', () => {
  it('401 when unauthenticated; no query run', async () => {
    (getSession as any).mockResolvedValue({ user: null });
    const res = await GET(mkReq('?entity=contacts&city=San%20Diego'));
    expect(res.status).toBe(401);
    expect(runQuery).not.toHaveBeenCalled();
  });

  it('forwards EVERY filter param to runQuery (guards the param-drift class of bug)', async () => {
    authed();
    const qs =
      '?entity=contacts&q=acme&lxdFrom=2026-07-15&lxdTo=2027-07-15&sfMin=10000&sfMax=50000' +
      '&city=San%20Diego&state=CA&address=Broadway&flags=tenant,prospect&group=Regus%20Space';
    const res = await GET(mkReq(qs));
    expect(res.status).toBe(200);
    expect(runQuery).toHaveBeenCalledTimes(1);
    expect(runQuery).toHaveBeenCalledWith({
      entity: 'contacts',
      q: 'acme',
      lxdFrom: '2026-07-15',
      lxdTo: '2027-07-15',
      sfMin: 10000,
      sfMax: 50000,
      city: 'San Diego',
      state: 'CA',
      address: 'Broadway',
      flags: ['tenant', 'prospect'],
      group: 'Regus Space',
    });
  });

  it('defaults entity to companies and returns the entity in the payload', async () => {
    authed();
    (runQuery as any).mockResolvedValue({ rows: [{ key: 'CO1' }], total: 1 });
    const res = await GET(mkReq(''));
    const body = await res.json();
    expect(runQuery).toHaveBeenCalledWith(expect.objectContaining({ entity: 'companies' }));
    expect(body).toMatchObject({ total: 1, entity: 'companies' });
  });
});
