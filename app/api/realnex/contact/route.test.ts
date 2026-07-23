import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/flags', () => ({ isRealnexCreateEnabled: vi.fn() }));
vi.mock('@/lib/external/realnex/safe', () => ({ createContact: vi.fn() }));
vi.mock('@/lib/realnex/create-mirror', () => ({ upsertCreatedContact: vi.fn() }));
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn(async () => {}) }));

import { POST } from './route';
import { getSession } from '@/lib/auth/session';
import { isRealnexCreateEnabled } from '@/lib/flags';
import { createContact } from '@/lib/external/realnex/safe';
import { upsertCreatedContact } from '@/lib/realnex/create-mirror';
import { logActivity } from '@/lib/activity';
import { RealNexValidationError } from '@/lib/external/realnex/client';

/* eslint-disable @typescript-eslint/no-explicit-any */
const mkReq = (body: unknown) => new Request('http://test/api/realnex/contact', { method: 'POST', body: JSON.stringify(body) }) as any;
const authed = () => (getSession as any).mockResolvedValue({ user: { id: 'user-1' } });

beforeEach(() => {
  vi.clearAllMocks();
  (isRealnexCreateEnabled as any).mockReturnValue(true); // flag ON for the create tests
  (createContact as any).mockResolvedValue({ key: 'CT-NEW-1', warnings: [] });
  (upsertCreatedContact as any).mockResolvedValue(undefined);
});

describe('feature flag', () => {
  it('404 when OFF — before auth AND before the wrapper', async () => {
    (isRealnexCreateEnabled as any).mockReturnValue(false);
    const res = await POST(mkReq({ fullName: 'A B' }));
    expect(res.status).toBe(404);
    expect(getSession).not.toHaveBeenCalled();
    expect(createContact).not.toHaveBeenCalled();
  });
});

describe('POST /api/realnex/contact', () => {
  it('401 unauthenticated; nothing created', async () => {
    (getSession as any).mockResolvedValue({ user: null });
    const res = await POST(mkReq({ firstName: 'A', lastName: 'B' }));
    expect(res.status).toBe(401);
    expect(createContact).not.toHaveBeenCalled();
  });

  it('400 on malformed payload before the wrapper is called', async () => {
    authed();
    const res = await POST(mkReq({ useCompanyAddress: 'yes' }));
    expect(res.status).toBe(400);
    expect(createContact).not.toHaveBeenCalled();
  });

  it('happy path: wrapper once with companyKey inline, mirror upserted, contact.create logged, 200', async () => {
    authed();
    const res = await POST(mkReq({ firstName: 'Britni', lastName: 'Stone', companyKey: 'CO1', work: '619' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ key: 'CT-NEW-1', warnings: [] });
    expect(createContact).toHaveBeenCalledTimes(1);
    expect(createContact).toHaveBeenCalledWith(expect.objectContaining({ firstName: 'Britni', lastName: 'Stone', companyKey: 'CO1' }));
    expect(upsertCreatedContact).toHaveBeenCalledWith('CT-NEW-1', expect.objectContaining({ companyKey: 'CO1' }), 'user-1');
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ action: 'contact.create', entityId: 'CT-NEW-1', status: 'ok' }));
  });

  it('wrapper business-guard (name/useCompanyAddress) → 400; no mirror write', async () => {
    authed();
    (createContact as any).mockRejectedValue(new RealNexValidationError('createContact: a name is required', 'name'));
    const res = await POST(mkReq({ companyKey: 'CO1' }));
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe('name');
    expect(upsertCreatedContact).not.toHaveBeenCalled();
  });

  it('partial failure: create OK but mirror-upsert throws → 200 + warning, wrapper NOT re-invoked', async () => {
    authed();
    (upsertCreatedContact as any).mockRejectedValue(new Error('db down'));
    const res = await POST(mkReq({ fullName: 'A B' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.key).toBe('CT-NEW-1');
    expect(body.warnings.length).toBeGreaterThan(0);
    expect(createContact).toHaveBeenCalledTimes(1);
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ status: 'warn' }));
  });
});
