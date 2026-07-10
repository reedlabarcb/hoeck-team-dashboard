import { describe, it, expect } from 'vitest';
import {
  clampLimit,
  clampOffset,
  escapeLike,
  contactDisplayName,
  isPrefixMatch,
  rankEntities,
  type EntityResult,
} from './queries';

describe('clampLimit', () => {
  it('defaults when absent/invalid', () => {
    expect(clampLimit(undefined)).toBe(25);
    expect(clampLimit('abc')).toBe(25);
    expect(clampLimit(null)).toBe(25);
    expect(clampLimit(undefined, 10)).toBe(10);
  });
  it('clamps to [1, 100]', () => {
    expect(clampLimit(0)).toBe(25); // <=0 -> default
    expect(clampLimit(-5)).toBe(25);
    expect(clampLimit(50)).toBe(50);
    expect(clampLimit(500)).toBe(100);
    expect(clampLimit('30')).toBe(30);
  });
});

describe('clampOffset', () => {
  it('non-negative integer, else 0', () => {
    expect(clampOffset(undefined)).toBe(0);
    expect(clampOffset(-3)).toBe(0);
    expect(clampOffset('abc')).toBe(0);
    expect(clampOffset('40')).toBe(40);
    expect(clampOffset(12)).toBe(12);
  });
});

describe('escapeLike', () => {
  it('escapes LIKE wildcards so typed % and _ are literal', () => {
    expect(escapeLike('50%')).toBe('50\\%');
    expect(escapeLike('a_b')).toBe('a\\_b');
    expect(escapeLike('back\\slash')).toBe('back\\\\slash');
    expect(escapeLike('plain')).toBe('plain');
  });
});

describe('contactDisplayName', () => {
  it('prefers full_name', () => {
    expect(contactDisplayName({ fullName: 'Maria Alvarez', firstName: 'Maria', lastName: 'Alvarez' })).toBe('Maria Alvarez');
  });
  it('falls back to first + last', () => {
    expect(contactDisplayName({ fullName: '', firstName: 'Maria', lastName: 'Alvarez' })).toBe('Maria Alvarez');
    expect(contactDisplayName({ fullName: null, firstName: 'Maria', lastName: null })).toBe('Maria');
  });
  it('placeholder when nameless', () => {
    expect(contactDisplayName({ fullName: null, firstName: null, lastName: null })).toBe('(no name)');
    expect(contactDisplayName({ fullName: '   ', firstName: '', lastName: '' })).toBe('(no name)');
  });
});

describe('isPrefixMatch', () => {
  it('true only when name starts with term (case-insensitive)', () => {
    expect(isPrefixMatch('Maria Alvarez', 'mar')).toBe(true);
    expect(isPrefixMatch('Maria Alvarez', 'MARIA')).toBe(true);
    expect(isPrefixMatch('Ana Maria', 'maria')).toBe(false); // contains, not prefix
    expect(isPrefixMatch(null, 'mar')).toBe(false);
    expect(isPrefixMatch('Maria', '')).toBe(false);
  });
});

describe('rankEntities', () => {
  const mk = (displayName: string, type: EntityResult['type'] = 'contact'): EntityResult => ({
    type,
    key: displayName.toLowerCase().replace(/\s/g, '-'),
    displayName,
    companyName: null,
    email: null,
  });

  it('prefix matches first, then alphabetical', () => {
    const input = [mk('Ana Maria'), mk('Maria Alvarez'), mk('Marina Bay'), mk('Bob Marino')];
    const ranked = rankEntities(input, 'mar');
    // prefix matches (Maria..., Marina...) lead, alpha within group; then the rest alpha
    expect(ranked.map((r) => r.displayName)).toEqual([
      'Maria Alvarez',
      'Marina Bay',
      'Ana Maria',
      'Bob Marino',
    ]);
  });

  it('does not mutate the input array', () => {
    const input = [mk('Zeta'), mk('Alpha')];
    const copy = [...input];
    rankEntities(input, 'a');
    expect(input).toEqual(copy);
  });
});
