import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/realnex/queries', () => ({ runQueryExport: vi.fn() }));
vi.mock('@/lib/realnex/query-export', () => ({
  buildExportRows: vi.fn(() => [{ name: 'X' }]),
  generateQueryWorkbook: vi.fn(async () => Buffer.from('PK-fake-xlsx')),
}));

import { GET } from './route';
import { getSession } from '@/lib/auth/session';
import { runQueryExport } from '@/lib/realnex/queries';
import { generateQueryWorkbook } from '@/lib/realnex/query-export';

/* eslint-disable @typescript-eslint/no-explicit-any */
const mkReq = (qs: string) => new Request(`http://test/api/realnex/query/export${qs}`) as any;
const authed = () => (getSession as any).mockResolvedValue({ user: { id: 'u1' } });

beforeEach(() => {
  vi.clearAllMocks();
  (runQueryExport as any).mockResolvedValue({ rows: [], total: 0 });
});

describe('GET /api/realnex/query/export', () => {
  it('401 when unauthenticated; nothing generated', async () => {
    (getSession as any).mockResolvedValue({ user: null });
    const res = await GET(mkReq('?entity=contacts'));
    expect(res.status).toBe(401);
    expect(runQueryExport).not.toHaveBeenCalled();
    expect(generateQueryWorkbook).not.toHaveBeenCalled();
  });

  it('forwards EVERY filter param to runQueryExport (same guard as the view route)', async () => {
    authed();
    const qs =
      '?entity=contacts&q=acme&lxdFrom=2026-07-15&lxdTo=2027-07-15&sfMin=10000&sfMax=50000' +
      '&city=San%20Diego&state=CA&address=Broadway&flags=tenant,prospect&group=Regus%20Space';
    await GET(mkReq(qs));
    expect(runQueryExport).toHaveBeenCalledWith({
      entity: 'contacts', q: 'acme', lxdFrom: '2026-07-15', lxdTo: '2027-07-15',
      sfMin: 10000, sfMax: 50000, city: 'San Diego', state: 'CA', address: 'Broadway',
      flags: ['tenant', 'prospect'], group: 'Regus Space',
    });
  });

  it('streams an .xlsx with an attachment filename reflecting the entity + date', async () => {
    authed();
    const res = await GET(mkReq('?entity=contacts'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('spreadsheetml.sheet');
    expect(res.headers.get('Content-Disposition')).toMatch(/attachment; filename="master-query-contacts-\d{4}-\d{2}-\d{2}\.xlsx"/);
    expect(generateQueryWorkbook).toHaveBeenCalledWith(expect.objectContaining({ entity: 'contacts' }));
  });
});
