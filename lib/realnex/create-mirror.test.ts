import { describe, it, expect } from 'vitest';
import { buildCompanyMirrorRow, buildContactMirrorRow, toMirrorAddress } from './create-mirror';

describe('toMirrorAddress', () => {
  it('converts camelCase input → PascalCase mirror jsonb (read-consistent with synced rows)', () => {
    expect(toMirrorAddress({ address1: '1 Main', address2: 'Ste 2', city: 'SD', state: 'CA', zipCode: '92101', country: 'US' })).toEqual({
      Address1: '1 Main',
      Address2: 'Ste 2',
      City: 'SD',
      State: 'CA',
      ZipCode: '92101',
      Country: 'US',
    });
  });
  it('null for absent/empty/whitespace-only', () => {
    expect(toMirrorAddress(undefined)).toBeNull();
    expect(toMirrorAddress({})).toBeNull();
    expect(toMirrorAddress({ city: '   ' })).toBeNull();
  });
});

describe('buildCompanyMirrorRow', () => {
  it('maps organization→company_name, flags (unset→false), city/state, PascalCase address, provenance', () => {
    const row = buildCompanyMirrorRow('K1', { organization: 'Acme', tenant: true, webSite: 'acme.com', address: { address1: '1 Main', city: 'SD', state: 'CA' } }, 'user-1');
    expect(row.realnexKey).toBe('K1');
    expect(row.companyName).toBe('Acme');
    expect(row.companyNameNormalized).toBeTruthy();
    expect(row.tenant).toBe(true);
    expect(row.investor).toBe(false); // unset flag → false
    expect(row.website).toBe('acme.com'); // read-side column name
    expect(row.city).toBe('SD');
    expect(row.state).toBe('CA');
    expect(row.address).toEqual({ Address1: '1 Main', City: 'SD', State: 'CA' }); // PascalCase
    expect(row.createdBy).toBe('user-1');
    expect(row.updatedBy).toBe('user-1');
  });
});

describe('buildContactMirrorRow', () => {
  it('derives fullName from first+last, sets company_key + passed company_name, PascalCase address', () => {
    const row = buildContactMirrorRow('K2', { firstName: 'Britni', lastName: 'Stone', companyKey: 'CO1', work: '619', tenant: true, address: { address1: '525 B', city: 'SD' } }, 'user-1', 'Gensler');
    expect(row.realnexKey).toBe('K2');
    expect(row.fullName).toBe('Britni Stone');
    expect(row.companyKey).toBe('CO1');
    expect(row.companyName).toBe('Gensler');
    expect(row.work).toBe('619');
    expect(row.address).toEqual({ Address1: '525 B', City: 'SD' });
  });
  it('prefers an explicit fullName over first+last', () => {
    const row = buildContactMirrorRow('K', { fullName: 'Dr. Britni Stone', firstName: 'Britni', lastName: 'Stone' }, 'u', null);
    expect(row.fullName).toBe('Dr. Britni Stone');
  });
  it('useCompanyAddress=true → no address on the mirror row (inherited from the company)', () => {
    const row = buildContactMirrorRow('K3', { fullName: 'A B', companyKey: 'CO1', useCompanyAddress: true, address: { address1: '1 Main' } }, 'u', 'Co');
    expect(row.address).toBeNull();
  });
});
