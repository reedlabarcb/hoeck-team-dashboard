import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock auth, the safe wrapper's write, and the audit log — so NO live RealNex write happens and
// we can drive success/failure. RealNexApiError is the REAL class (for the instanceof branch).
vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/external/realnex/safe', () => ({ appendActivity: vi.fn() }));
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }));

import { POST } from './route';
import { getSession } from '@/lib/auth/session';
import { appendActivity } from '@/lib/external/realnex/safe';
import { logActivity } from '@/lib/activity';
import { RealNexApiError, RealNexNotConfiguredError } from '@/lib/external/realnex/client';

/* eslint-disable @typescript-eslint/no-explicit-any */
const mkReq = (body: unknown) =>
  new Request('http://test/api/realnex/activity', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as any;

const good = { objectKey: 'C66BA083', objectType: 'company', eventTypeKey: 18, subject: 'Lunch', notes: 'had lunch with Maria' };
const authed = () => (getSession as any).mockResolvedValue({ user: { id: 'u1', email: 'reed@x' } });

beforeEach(() => {
  vi.clearAllMocks();
  (logActivity as any).mockResolvedValue(undefined);
});

describe('POST /api/realnex/activity — auth', () => {
  it('401 when unauthenticated; no write, no audit', async () => {
    (getSession as any).mockResolvedValue({ user: null });
    const res = await POST(mkReq(good));
    expect(res.status).toBe(401);
    expect(appendActivity).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
  });
});

describe('POST /api/realnex/activity — validation (authed, never writes)', () => {
  beforeEach(authed);

  it('rejects missing objectKey (400)', async () => {
    const res = await POST(mkReq({ ...good, objectKey: '' }));
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe('objectKey');
    expect(appendActivity).not.toHaveBeenCalled();
  });

  it('rejects a non-note eventTypeKey (400) — e.g. 3 Follow-Up / 999 / 0', async () => {
    for (const bad of [3, 999, 0, 'nope']) {
      const res = await POST(mkReq({ ...good, eventTypeKey: bad }));
      expect(res.status).toBe(400);
      expect((await res.json()).field).toBe('eventTypeKey');
    }
    expect(appendActivity).not.toHaveBeenCalled();
  });

  it('rejects empty notes (400)', async () => {
    const res = await POST(mkReq({ ...good, notes: '   ' }));
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe('notes');
    expect(appendActivity).not.toHaveBeenCalled();
  });

  it('rejects bad objectType (400)', async () => {
    const res = await POST(mkReq({ ...good, objectType: 'deal' }));
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe('objectType');
  });
});

describe('POST /api/realnex/activity — success + audit', () => {
  beforeEach(() => {
    authed();
    (appendActivity as any).mockResolvedValue({});
  });

  it('appends with the validated body and logs status ok', async () => {
    const res = await POST(mkReq(good));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(appendActivity).toHaveBeenCalledWith('C66BA083', expect.objectContaining({ eventTypeKey: 18, subject: 'Lunch', notes: 'had lunch with Maria' }));
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ok', action: 'realnex.activity.append', entityId: 'C66BA083', entityType: 'realnex_company' }),
    );
  });

  it('accepts each of the 6 allowed eventTypeKeys', async () => {
    for (const k of [18, 1, 101, 15, 2, 11]) {
      const res = await POST(mkReq({ ...good, eventTypeKey: k }));
      expect(res.status).toBe(200);
    }
    expect(appendActivity).toHaveBeenCalledTimes(6);
  });
});

describe('POST /api/realnex/activity — failure audits the attempt', () => {
  beforeEach(authed);

  it('RealNex write error -> 502 and logActivity status=error', async () => {
    (appendActivity as any).mockRejectedValue(new RealNexApiError(400, 'bad body', 'POST /Crm/object/x/history'));
    const res = await POST(mkReq(good));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('realnex_write_failed');
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ status: 'error', entityId: 'C66BA083' }));
  });

  it('not-configured -> 503 and logActivity status=error', async () => {
    (appendActivity as any).mockRejectedValue(new RealNexNotConfiguredError());
    const res = await POST(mkReq(good));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('realnex_not_configured');
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
  });

  it('unexpected error -> 500 and logActivity status=error', async () => {
    (appendActivity as any).mockRejectedValue(new Error('boom'));
    const res = await POST(mkReq(good));
    expect(res.status).toBe(500);
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
  });
});
