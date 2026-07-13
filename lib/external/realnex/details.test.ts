import { describe, it, expect } from 'vitest';
import { parseLeaseExpiry, parseSqFt, extractCompanyDetail, extractContactDetail } from './details';

describe('parseLeaseExpiry', () => {
  it('takes the date part of an ISO-naive datetime without timezone drift', () => {
    expect(parseLeaseExpiry('2027-04-30T00:00:00')).toBe('2027-04-30');
    expect(parseLeaseExpiry('2024-02-29T00:00:00')).toBe('2024-02-29');
    expect(parseLeaseExpiry('2027-12-31')).toBe('2027-12-31');
  });
  it('tolerates US-style dates', () => {
    expect(parseLeaseExpiry('4/30/2027')).toBe('2027-04-30');
  });
  it('returns null for empty/invalid', () => {
    expect(parseLeaseExpiry(null)).toBeNull();
    expect(parseLeaseExpiry(undefined)).toBeNull();
    expect(parseLeaseExpiry('')).toBeNull();
    expect(parseLeaseExpiry('   ')).toBeNull();
    expect(parseLeaseExpiry('not a date')).toBeNull();
    expect(parseLeaseExpiry(42)).toBeNull();
  });
});

describe('parseSqFt', () => {
  it('accepts positive numbers, rounds', () => {
    expect(parseSqFt(21347)).toBe(21347);
    expect(parseSqFt(21347.6)).toBe(21348);
  });
  it('parses comma strings', () => {
    expect(parseSqFt('21,347')).toBe(21347);
    expect(parseSqFt('21 347')).toBe(21347);
  });
  it('null for zero / negative / blank / non-numeric', () => {
    expect(parseSqFt(0)).toBeNull();
    expect(parseSqFt(-5)).toBeNull();
    expect(parseSqFt('')).toBeNull();
    expect(parseSqFt(null)).toBeNull();
    expect(parseSqFt('abc')).toBeNull();
  });
});

describe('extractCompanyDetail', () => {
  it('pulls sqFt + leaseExpiry from the live company /full shape', () => {
    const full = {
      key: 'C66BA083',
      details: {
        currentSf: 21347,
        userFields: {},
        userDataFields: { userDate1: '2027-04-30T00:00:00' },
        logicalFields: { logical1: false },
      },
    };
    expect(extractCompanyDetail(full)).toEqual({ sqFt: 21347, leaseExpiry: '2027-04-30' });
  });
  it('graceful when details / userDataFields absent', () => {
    expect(extractCompanyDetail({ key: 'x' })).toEqual({ sqFt: null, leaseExpiry: null });
    expect(extractCompanyDetail({ details: {} })).toEqual({ sqFt: null, leaseExpiry: null });
    expect(extractCompanyDetail(null)).toEqual({ sqFt: null, leaseExpiry: null });
  });
});

describe('extractContactDetail', () => {
  it('pulls sqFt + leaseExpiry from the live contact /full shape', () => {
    const full = {
      key: '1865253F',
      tenantData: {
        space: { spaceKey: '8355', sqFt: 21347, leaseExpiry: '2027-04-30T00:00:00' },
        office: false,
      },
    };
    expect(extractContactDetail(full)).toEqual({ sqFt: 21347, leaseExpiry: '2027-04-30' });
  });
  it('graceful when tenantData / space absent (the ~70% with no lease)', () => {
    expect(extractContactDetail({ key: 'x' })).toEqual({ sqFt: null, leaseExpiry: null });
    expect(extractContactDetail({ tenantData: {} })).toEqual({ sqFt: null, leaseExpiry: null });
    expect(extractContactDetail(null)).toEqual({ sqFt: null, leaseExpiry: null });
  });
});
