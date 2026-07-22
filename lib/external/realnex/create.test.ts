import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createCompany, createContact } from './safe';
import { RealNexApiError } from './client';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Fetch is MOCKED — NO live RealNex create in these tests.
let calls: { url: string; method: string; body: any }[];
let prevKey: string | undefined;

function mockFetch(status = 202, respBody: unknown = { key: 'NEW-KEY-1' }, ok = true) {
  return vi.fn(async (url: string, init: any) => {
    calls.push({ url: String(url), method: init?.method, body: init?.body ? JSON.parse(init.body) : undefined });
    return { ok, status, text: async () => (typeof respBody === 'string' ? respBody : JSON.stringify(respBody)) };
  });
}

beforeEach(() => {
  prevKey = process.env.REALNEX_API_KEY;
  process.env.REALNEX_API_KEY = 'x'.repeat(40);
  calls = [];
  vi.stubGlobal('fetch', mockFetch());
});
afterEach(() => {
  if (prevKey === undefined) delete process.env.REALNEX_API_KEY;
  else process.env.REALNEX_API_KEY = prevKey;
  vi.unstubAllGlobals();
});

/** Recursive guard: EVERY key in a create body must be camelCase (create side); a PascalCase key
 *  (read side) would be silently ignored by RealNex → a blank record. */
function assertAllCamelCase(obj: any, path = ''): void {
  if (Array.isArray(obj)) return obj.forEach((x, i) => assertAllCamelCase(x, `${path}[${i}]`));
  if (obj && typeof obj === 'object') {
    for (const k of Object.keys(obj)) {
      expect(/^[a-z][A-Za-z0-9]*$/.test(k), `body key "${path}${k}" must be camelCase`).toBe(true);
      assertAllCamelCase(obj[k], `${path}${k}.`);
    }
  }
}

describe('createCompany', () => {
  it('POSTs a camelCase body to the company endpoint and returns the new key', async () => {
    const res = await createCompany({
      organization: 'Full Swing Golf',
      tenant: true,
      webSite: 'fullswing.com',
      address: { address1: '225 Broadway', city: 'San Diego', state: 'CA', zipCode: '92101' },
      objectGroups: ['Prospects'],
    });
    expect(res).toEqual({ key: 'NEW-KEY-1', warnings: [] });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toContain('/api/v1/Crm/company');
    expect(calls[0].url).not.toContain('$'); // POST create — no OData query string
    const b = calls[0].body;
    expect(b.organization).toBe('Full Swing Golf'); // name → organization (NOT OrganizationId)
    expect(b.tenant).toBe(true);
    expect(b.webSite).toBe('fullswing.com'); // camelCase webSite
    expect(b.address).toEqual({ address1: '225 Broadway', city: 'San Diego', state: 'CA', zipCode: '92101' });
    expect(b.objectGroups).toEqual(['Prospects']); // inline groups, no /members call
    expect('Organization' in b).toBe(false); // no PascalCase leak
    assertAllCamelCase(b);
  });

  it('sets only flags turned on; omits the rest for the server to default', async () => {
    await createCompany({ organization: 'X', tenant: true });
    const b = calls[0].body;
    expect(b.tenant).toBe(true);
    expect('investor' in b).toBe(false);
    expect('prospect' in b).toBe(false);
  });

  it('throws on empty/whitespace organization WITHOUT hitting the network', async () => {
    await expect(createCompany({ organization: '   ' })).rejects.toThrow(/organization.*required/i);
    expect(calls).toHaveLength(0);
  });

  it('surfaces ProblemDetails on a 4xx', async () => {
    vi.stubGlobal('fetch', mockFetch(400, { type: 't', title: 'Bad Request', status: 400, detail: 'organization invalid' }, false));
    calls = [];
    await expect(createCompany({ organization: 'X' })).rejects.toBeInstanceOf(RealNexApiError);
    try {
      await createCompany({ organization: 'X' });
    } catch (e) {
      const err = e as RealNexApiError;
      expect(err.status).toBe(400);
      expect(err.problem).toMatchObject({ title: 'Bad Request', detail: 'organization invalid' });
    }
  });
});

describe('createContact', () => {
  it('POSTs camelCase with work/mobile/home + inline companyKey; NO `phone` key', async () => {
    const res = await createContact({
      firstName: 'Britni',
      lastName: 'Stone',
      title: 'VP',
      companyKey: 'CO1',
      work: '619-555-0100',
      mobile: '619-555-0199',
      home: '619-555-0000',
      tenant: true,
    });
    expect(res.key).toBe('NEW-KEY-1');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/api/v1/Crm/contact');
    const b = calls[0].body;
    expect(b.firstName).toBe('Britni');
    expect(b.companyKey).toBe('CO1'); // parent link set INLINE (no separate call)
    expect(b.work).toBe('619-555-0100');
    expect(b.mobile).toBe('619-555-0199');
    expect(b.home).toBe('619-555-0000');
    expect('phone' in b).toBe(false); // a contact has NO `phone` field
    assertAllCamelCase(b);
  });

  it('throws when no name is provided (no network)', async () => {
    await expect(createContact({ companyKey: 'CO1' })).rejects.toThrow(/name is required/i);
    expect(calls).toHaveLength(0);
  });

  it('useCompanyAddress=true OMITS the inline address entirely (single POST, no attach call)', async () => {
    await createContact({ fullName: 'A B', companyKey: 'CO1', useCompanyAddress: true, address: { address1: '1 Main', city: 'SD' } });
    const b = calls[0].body;
    expect(b.useCompanyAddress).toBe(true);
    expect('address' in b).toBe(false); // inherited from the company — not sent
    expect(calls).toHaveLength(1); // exactly one POST, no address sub-resource
  });

  it('useCompanyAddress=true WITHOUT a companyKey is contradictory → throws, no network', async () => {
    await expect(createContact({ fullName: 'A B', useCompanyAddress: true })).rejects.toThrow(/useCompanyAddress requires a companyKey/i);
    expect(calls).toHaveLength(0);
  });

  it('inline address (no useCompanyAddress) sends a camelCase address object', async () => {
    await createContact({ fullName: 'A B', address: { address1: '525 B Street', city: 'San Diego', state: 'CA', zipCode: '92101' } });
    expect(calls[0].body.address).toEqual({ address1: '525 B Street', city: 'San Diego', state: 'CA', zipCode: '92101' });
    assertAllCamelCase(calls[0].body);
  });
});
