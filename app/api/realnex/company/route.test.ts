import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/flags', () => ({ isRealnexCreateEnabled: vi.fn() }));
vi.mock('@/lib/external/realnex/safe', () => ({ createCompany: vi.fn() }));
vi.mock('@/lib/realnex/create-mirror', () => ({ upsertCreatedCompany: vi.fn() }));
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn(async () => {}) }));

import { POST } from './route';
import { getSession } from '@/lib/auth/session';
import { isRealnexCreateEnabled } from '@/lib/flags';
import { createCompany } from '@/lib/external/realnex/safe';
import { upsertCreatedCompany } from '@/lib/realnex/create-mirror';
import { logActivity } from '@/lib/activity';
import { RealNexApiError, RealNexValidationError } from '@/lib/external/realnex/client';

/* eslint-disable @typescript-eslint/no-explicit-any */
const mkReq = (body: unknown) => new Request('http://test/api/realnex/company', { method: 'POST', body: JSON.stringify(body) }) as any;
const authed = () => (getSession as any).mockResolvedValue({ user: { id: 'user-1' } });

beforeEach(() => {
  vi.clearAllMocks();
  (isRealnexCreateEnabled as any).mockReturnValue(true); // flag ON for the create tests
  (createCompany as any).mockResolvedValue({ key: 'CO-NEW-1', warnings: [] });
  (upsertCreatedCompany as any).mockResolvedValue(undefined);
});

describe('feature flag', () => {
  it('404 when OFF — before auth AND before the wrapper (no reachable write path)', async () => {
    (isRealnexCreateEnabled as any).mockReturnValue(false);
    const res = await POST(mkReq({ organization: 'Acme' }));
    expect(res.status).toBe(404);
    expect(getSession).not.toHaveBeenCalled();
    expect(createCompany).not.toHaveBeenCalled();
  });
});

describe('POST /api/realnex/company', () => {
  it('401 unauthenticated; nothing created', async () => {
    (getSession as any).mockResolvedValue({ user: null });
    const res = await POST(mkReq({ organization: 'Acme' }));
    expect(res.status).toBe(401);
    expect(createCompany).not.toHaveBeenCalled();
  });

  it('400 on malformed payload BEFORE the wrapper is called', async () => {
    authed();
    const res = await POST(mkReq({ organization: 123 }));
    expect(res.status).toBe(400);
    expect(createCompany).not.toHaveBeenCalled();
  });

  it('happy path: wrapper once, mirror upserted, activity logged, 200 { key, warnings }', async () => {
    authed();
    const res = await POST(mkReq({ organization: 'Acme', tenant: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ key: 'CO-NEW-1', warnings: [] });
    expect(createCompany).toHaveBeenCalledTimes(1);
    expect(createCompany).toHaveBeenCalledWith(expect.objectContaining({ organization: 'Acme', tenant: true }));
    expect(upsertCreatedCompany).toHaveBeenCalledWith('CO-NEW-1', expect.objectContaining({ organization: 'Acme' }), 'user-1');
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ action: 'company.create', entityId: 'CO-NEW-1', status: 'ok' }));
  });

  it('wrapper business-guard (RealNexValidationError) → 400; no mirror write', async () => {
    authed();
    (createCompany as any).mockRejectedValue(new RealNexValidationError('createCompany: organization is required', 'organization'));
    const res = await POST(mkReq({ organization: 'x' })); // shape-ok; wrapper rejects
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe('organization');
    expect(upsertCreatedCompany).not.toHaveBeenCalled();
  });

  it('RealNex 4xx passes through (with .problem); 5xx → 502; never a bare 500', async () => {
    authed();
    (createCompany as any).mockRejectedValue(new RealNexApiError(409, '{}', 'POST /company', { title: 'Conflict', status: 409 }));
    let res = await POST(mkReq({ organization: 'Acme' }));
    expect(res.status).toBe(409);
    expect((await res.json()).problem).toMatchObject({ title: 'Conflict' });

    (createCompany as any).mockRejectedValue(new RealNexApiError(500, 'boom', 'POST /company'));
    res = await POST(mkReq({ organization: 'Acme' }));
    expect(res.status).toBe(502);
  });

  it('partial failure: create OK but mirror-upsert throws → 200 + warning, wrapper NOT re-invoked', async () => {
    authed();
    (upsertCreatedCompany as any).mockRejectedValue(new Error('db down'));
    const res = await POST(mkReq({ organization: 'Acme' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.key).toBe('CO-NEW-1');
    expect(body.warnings.length).toBeGreaterThan(0);
    expect(createCompany).toHaveBeenCalledTimes(1); // no RealNex retry after a local failure
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ status: 'warn' }));
  });
});
