import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/realnex/queries', () => ({ searchCompanies: vi.fn() }));

import { GET } from './route';
import { getSession } from '@/lib/auth/session';
import { searchCompanies } from '@/lib/realnex/queries';

/* eslint-disable @typescript-eslint/no-explicit-any */
const mkReq = (qs: string) => new Request(`http://test/api/realnex/companies${qs}`) as any;
const authed = () => (getSession as any).mockResolvedValue({ user: { id: 'u1' } });

beforeEach(() => {
  vi.clearAllMocks();
  (searchCompanies as any).mockResolvedValue({ companies: [], total: 0 });
});

describe('GET /api/realnex/companies', () => {
  it('401 when unauthenticated; no read', async () => {
    (getSession as any).mockResolvedValue({ user: null });
    const res = await GET(mkReq('?group=Regus%20Space'));
    expect(res.status).toBe(401);
    expect(searchCompanies).not.toHaveBeenCalled();
  });

  it('forwards the ?group= filter to searchCompanies (regression: the group dropdown was dropped at the route)', async () => {
    authed();
    const res = await GET(mkReq('?group=Regus%20Space'));
    expect(res.status).toBe(200);
    expect(searchCompanies).toHaveBeenCalledWith(expect.objectContaining({ group: 'Regus Space' }));
  });

  it('forwards the ?q= search term too', async () => {
    authed();
    await GET(mkReq('?q=gen'));
    expect(searchCompanies).toHaveBeenCalledWith(expect.objectContaining({ q: 'gen' }));
  });
});
