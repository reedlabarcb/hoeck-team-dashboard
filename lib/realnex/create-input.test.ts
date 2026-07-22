import { describe, it, expect } from 'vitest';
import { validateCreateCompanyInput, validateCreateContactInput } from './create-input';

describe('validateCreateCompanyInput (HTTP shape)', () => {
  it('accepts a well-typed body, returns the camelCase subset, drops unknown fields', () => {
    const r = validateCreateCompanyInput({
      organization: 'Acme',
      tenant: true,
      webSite: 'acme.com',
      address: { address1: '1 Main', city: 'SD', state: 'CA', zipCode: '92101' },
      objectGroups: ['G'],
      unknownField: 'x',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.organization).toBe('Acme');
      expect(r.value.tenant).toBe(true);
      expect(r.value.webSite).toBe('acme.com');
      expect(r.value.address).toEqual({ address1: '1 Main', city: 'SD', state: 'CA', zipCode: '92101' });
      expect(r.value.objectGroups).toEqual(['G']);
      expect((r.value as unknown as Record<string, unknown>).unknownField).toBeUndefined();
    }
  });
  it('is shape-only — does NOT enforce non-empty organization (that is the wrapper guard)', () => {
    expect(validateCreateCompanyInput({ tenant: true }).ok).toBe(true);
  });
  it('400s on wrong types with a field name', () => {
    expect(validateCreateCompanyInput({ organization: 123 })).toMatchObject({ ok: false, field: 'organization' });
    expect(validateCreateCompanyInput({ tenant: 'yes' })).toMatchObject({ ok: false, field: 'tenant' });
    expect(validateCreateCompanyInput({ address: 'nope' })).toMatchObject({ ok: false, field: 'address' });
    expect(validateCreateCompanyInput({ address: { city: 5 } })).toMatchObject({ ok: false, field: 'address.city' });
    expect(validateCreateCompanyInput({ objectGroups: [1, 2] })).toMatchObject({ ok: false, field: 'objectGroups' });
    expect(validateCreateCompanyInput('nope')).toMatchObject({ ok: false, field: 'body' });
  });
});

describe('validateCreateContactInput (HTTP shape)', () => {
  it('accepts work/mobile/home + companyKey + useCompanyAddress (no `phone` field)', () => {
    const r = validateCreateContactInput({ firstName: 'A', lastName: 'B', companyKey: 'CO1', work: '619', useCompanyAddress: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.firstName).toBe('A');
      expect(r.value.companyKey).toBe('CO1');
      expect(r.value.work).toBe('619');
      expect(r.value.useCompanyAddress).toBe(true);
    }
  });
  it('400s on wrong types', () => {
    expect(validateCreateContactInput({ useCompanyAddress: 'true' })).toMatchObject({ ok: false, field: 'useCompanyAddress' });
    expect(validateCreateContactInput({ work: 123 })).toMatchObject({ ok: false, field: 'work' });
    expect(validateCreateContactInput({ investor: 1 })).toMatchObject({ ok: false, field: 'investor' });
  });
  it('is shape-only — does NOT enforce name / useCompanyAddress+companyKey (wrapper guards)', () => {
    expect(validateCreateContactInput({}).ok).toBe(true);
    expect(validateCreateContactInput({ useCompanyAddress: true }).ok).toBe(true);
  });
});
