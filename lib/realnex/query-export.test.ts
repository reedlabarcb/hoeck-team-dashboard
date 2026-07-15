import { describe, it, expect } from 'vitest';
import { buildExportRows } from './query-export';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe('buildExportRows', () => {
  it('companies: city/state from flat columns; one-line address; group Names; flags; LXD/SF passthrough', () => {
    const rows = [
      {
        key: 'CO1', name: 'Gensler', city: 'San Diego', state: 'CA',
        address: { Address1: '225 Broadway', City: 'San Diego', State: 'CA', ZipCode: '92101' },
        leaseExpiry: '2027-04-30', sqFt: 21347,
        tenant: true, prospect: false, investor: true, agent: false, vendor: false, personal: false,
        objectGroups: [{ Key: 'g', Name: 'Architects' }],
      },
    ];
    const [r] = buildExportRows(rows as any, 'companies');
    expect(r.name).toBe('Gensler');
    expect(r.company).toBe(''); // companies have no company/title
    expect(r.city).toBe('San Diego');
    expect(r.state).toBe('CA');
    expect(r.address).toBe('225 Broadway, San Diego, CA 92101'); // formatAddress, PascalCase-safe
    expect(r.leaseExpiry).toBe('2027-04-30');
    expect(r.sqFt).toBe(21347);
    expect(r.groups).toEqual(['Architects']);
    expect(r.flags).toEqual({ tenant: true, prospect: false, investor: true, agent: false, vendor: false, personal: false });
  });

  it('contacts: city/state read from address PascalCase jsonb (no flat columns); company+title present; LXD sliced', () => {
    const rows = [
      {
        key: 'CT1', fullName: 'Britni Stone', firstName: 'Britni', lastName: 'Stone', title: 'VP', companyName: 'Gensler',
        address: { Address1: '525 B Street', City: 'San Diego', State: 'CA', ZipCode: '92101' },
        leaseExpiry: '2027-04-30T00:00:00', sqFt: 5000,
        tenant: true, prospect: true, investor: false, agent: false, vendor: false, personal: false,
        objectGroups: [],
      },
    ];
    const [r] = buildExportRows(rows as any, 'contacts');
    expect(r.name).toBe('Britni Stone');
    expect(r.company).toBe('Gensler');
    expect(r.title).toBe('VP');
    expect(r.city).toBe('San Diego'); // from address.City (PascalCase) — contacts have no flat column
    expect(r.state).toBe('CA');
    expect(r.leaseExpiry).toBe('2027-04-30'); // datetime sliced to the date
  });

  it('null LXD/SF/address pass through cleanly; unnamed company falls back', () => {
    const [r] = buildExportRows([{ key: 'CO2', name: null, address: null, leaseExpiry: null, sqFt: null, objectGroups: null }] as any, 'companies');
    expect(r.name).toBe('(unnamed)');
    expect(r.leaseExpiry).toBeNull();
    expect(r.sqFt).toBeNull();
    expect(r.address).toBe('');
    expect(r.groups).toEqual([]);
  });
});
