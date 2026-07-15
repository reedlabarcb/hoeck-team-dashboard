import { describe, it, expect } from 'vitest';
import {
  emptyFilters,
  filtersToParams,
  parseQueryFilters,
  filtersToChips,
  clearChip,
  leaseWindow,
  type QueryFilters,
} from './query-filters';

const FULL: QueryFilters = {
  entity: 'contacts',
  q: 'acme',
  lxdFrom: '2026-07-15',
  lxdTo: '2027-07-15',
  sfMin: 10000,
  sfMax: 50000,
  city: 'San Diego',
  state: 'CA',
  address: 'Broadway',
  flags: ['tenant', 'prospect'],
  group: 'Regus Space',
};

describe('parseQueryFilters', () => {
  it('extracts EVERY dimension (nothing dropped)', () => {
    const parsed = parseQueryFilters(filtersToParams(FULL));
    expect(parsed).toEqual(FULL); // round-trips losslessly through the URL
  });
  it('defaults entity to companies; drops unknown flags and bad numbers', () => {
    const sp = new URLSearchParams('entity=bogus&flags=tenant,notaflag,prospect&sfMin=abc&sfMax=50000');
    const parsed = parseQueryFilters(sp);
    expect(parsed.entity).toBe('companies');
    expect(parsed.flags).toEqual(['tenant', 'prospect']); // 'notaflag' dropped
    expect(parsed.sfMin).toBeUndefined(); // 'abc' → undefined
    expect(parsed.sfMax).toBe(50000);
  });
  it('empty params → just the entity', () => {
    expect(parseQueryFilters(new URLSearchParams('entity=contacts'))).toEqual({ entity: 'contacts' });
  });
});

describe('filtersToParams', () => {
  it('serializes only non-empty values; flags comma-joined', () => {
    const p = filtersToParams({ entity: 'companies', city: 'San Diego', flags: ['tenant'] });
    expect(p.get('entity')).toBe('companies');
    expect(p.get('city')).toBe('San Diego');
    expect(p.get('flags')).toBe('tenant');
    expect(p.get('q')).toBeNull(); // absent stays absent
  });
});

describe('filtersToChips', () => {
  it('one chip per applied filter, with readable labels', () => {
    const chips = filtersToChips(FULL);
    const byKey = Object.fromEntries(chips.map((c) => [c.key, c.label]));
    expect(byKey.flags).toBe('Tenant/Prospect');
    expect(byKey.city).toBe('San Diego');
    expect(byKey.state).toBe('CA');
    expect(byKey.sf).toBe('SF 10,000–50,000');
    expect(byKey.lease).toBe('LXD 07/15/2026–07/15/2027');
    expect(byKey.group).toBe('Regus Space');
    expect(byKey.q).toContain('acme');
    expect(byKey.address).toContain('Broadway');
  });
  it('no chips when nothing is applied', () => {
    expect(filtersToChips(emptyFilters('companies'))).toEqual([]);
  });
  it('one-sided ranges read naturally', () => {
    expect(filtersToChips({ entity: 'companies', sfMin: 10000 })[0].label).toBe('SF ≥ 10,000');
    expect(filtersToChips({ entity: 'companies', lxdTo: '2027-07-15' })[0].label).toBe('LXD ≤ 07/15/2027');
  });
});

describe('clearChip', () => {
  it('removes exactly the chip’s filter(s); lease/sf clear both bounds; siblings + entity preserved', () => {
    const lease = clearChip(FULL, 'lease');
    expect(lease.lxdFrom).toBeUndefined();
    expect(lease.lxdTo).toBeUndefined();
    expect(lease.city).toBe('San Diego'); // sibling untouched

    const sf = clearChip(FULL, 'sf');
    expect(sf.sfMin).toBeUndefined();
    expect(sf.sfMax).toBeUndefined();

    expect(clearChip(FULL, 'flags').flags).toBeUndefined();

    const city = clearChip(FULL, 'city');
    expect(city.city).toBeUndefined();
    expect(city.state).toBe('CA'); // sibling untouched
    expect(city.entity).toBe('contacts'); // entity always preserved
  });
});

describe('leaseWindow', () => {
  it('rolls [today, today + N months] as YYYY-MM-DD', () => {
    const today = new Date(2026, 6, 15); // 2026-07-15 (local)
    expect(leaseWindow(12, today)).toEqual({ lxdFrom: '2026-07-15', lxdTo: '2027-07-15' });
    expect(leaseWindow(6, today)).toEqual({ lxdFrom: '2026-07-15', lxdTo: '2027-01-15' });
  });
});
