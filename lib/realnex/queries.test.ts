import { describe, it, expect } from 'vitest';
import {
  clampLimit,
  clampOffset,
  escapeLike,
  contactDisplayName,
  isPrefixMatch,
  rankEntities,
  companiesRowsQuery,
  contactsRowsQuery,
  companyByKeyQuery,
  contactByKeyQuery,
  type EntityResult,
} from './queries';

// companiesRowsQuery/contactsRowsQuery touch the lazy db pool (getPool throws without
// DATABASE_URL). toSQL() never connects, so a dummy URL is enough to render SQL for the
// ORDER BY regression assertions below.
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';

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

// Regression for the P3.5.2 bug: an empty search 500'd because the ORDER BY fell back to a bare
// `sql`0``, which Postgres reads as column-ordinal 0 ("position 0 is not in select list").
// These render the generated SQL via toSQL() (no DB execution) and assert the empty-q path
// orders by name and NEVER emits "ORDER BY 0". Covers companies + contacts (both fed 5.3 + P3.6).
describe('rows query ORDER BY — empty q must not emit "ORDER BY 0"', () => {
  it('companies empty q: orders by name, no bare ORDER BY 0', () => {
    const s = companiesRowsQuery({}).toSQL().sql.toLowerCase();
    expect(s).not.toMatch(/order by 0\b/);
    expect(s).toContain('order by "realnex_companies"."company_name"');
  });
  it('companies q=proc: prefix-rank CASE, still no ORDER BY 0', () => {
    const s = companiesRowsQuery({ q: 'proc' }).toSQL().sql.toLowerCase();
    expect(s).toContain('case when');
    expect(s).not.toMatch(/order by 0\b/);
  });
  it('contacts empty q: orders by name, no bare ORDER BY 0', () => {
    const s = contactsRowsQuery({}).toSQL().sql.toLowerCase();
    expect(s).not.toMatch(/order by 0\b/);
    expect(s).toContain('order by "realnex_contacts"."full_name"');
  });
  it('contacts q=mar: prefix-rank CASE, still no ORDER BY 0', () => {
    const s = contactsRowsQuery({ q: 'mar' }).toSQL().sql.toLowerCase();
    expect(s).toContain('case when');
    expect(s).not.toMatch(/order by 0\b/);
  });
});

// P3.13 Record View: single-record detail reads by realnex_key (mirror only).
describe('by-key detail queries', () => {
  it('companyByKeyQuery: WHERE realnex_key = <param> AND not deleted, LIMIT 1', () => {
    const b = companyByKeyQuery('ABC-123').toSQL();
    const sql = b.sql.toLowerCase();
    expect(sql).toContain('"realnex_companies"."realnex_key" =');
    expect(sql).toContain('"realnex_companies"."deleted_at" is null');
    expect(sql).toContain('limit');
    expect(b.params).toContain('ABC-123');
  });
  it('contactByKeyQuery: WHERE realnex_key = <param> AND not deleted, LIMIT 1', () => {
    const b = contactByKeyQuery('XYZ-9').toSQL();
    const sql = b.sql.toLowerCase();
    expect(sql).toContain('"realnex_contacts"."realnex_key" =');
    expect(sql).toContain('"realnex_contacts"."deleted_at" is null');
    expect(sql).toContain('limit');
    expect(b.params).toContain('XYZ-9');
  });
});

// P3.5.3: /contacts adds a group filter (the contact's own object_groups @> [{Name}]) and a
// company filter (exact company_key). Assert the generated SQL wires each correctly, that the
// jsonb payload is a bound param (not inlined), and that adding a group never reintroduces the
// empty-q ORDER BY 0 bug.
describe('contactsRowsQuery — P3.5.3 group + company filters', () => {
  it('group filter: emits object_groups @> jsonb, group name bound as a param', () => {
    const built = contactsRowsQuery({ group: 'Tenant Rep' }).toSQL();
    expect(built.sql.toLowerCase()).toContain('"realnex_contacts"."object_groups" @>');
    expect(built.params).toContain(JSON.stringify([{ Name: 'Tenant Rep' }]));
  });
  it('company filter: emits company_key = <param>', () => {
    const built = contactsRowsQuery({ companyKey: 'ABC-123' }).toSQL();
    expect(built.sql.toLowerCase()).toContain('"realnex_contacts"."company_key" =');
    expect(built.params).toContain('ABC-123');
  });
  it('empty q WITH a group: orders by name, still no ORDER BY 0', () => {
    const s = contactsRowsQuery({ group: 'Tenant Rep' }).toSQL().sql.toLowerCase();
    expect(s).not.toMatch(/order by 0\b/);
    expect(s).toContain('order by "realnex_contacts"."full_name"');
  });
});

// P3.5.2: /companies group filter. The mirror's object_groups jsonb is the REAL RealNex/OData shape
// — an array of PascalCase {Key, Name}, e.g. [{"Key":"31968254-...","Name":"Regus Space"}] (verified
// against the live API). So the containment MUST match on the PascalCase "Name" key. This also guards
// the wiring the group-filter bug exposed: the /companies API route had dropped ?group= entirely
// (searchCompanies never saw it) — see app/api/realnex/companies/route.test.ts.
describe('companiesRowsQuery — group filter (P3.5.2)', () => {
  it('emits object_groups @> jsonb with the group name bound as a PascalCase {Name} param', () => {
    const built = companiesRowsQuery({ group: 'Regus Space' }).toSQL();
    expect(built.sql.toLowerCase()).toContain('"realnex_companies"."object_groups" @>');
    expect(built.params).toContain(JSON.stringify([{ Name: 'Regus Space' }])); // matches [{"Key":..,"Name":..}]
  });
  it('empty q WITH a group: orders by name, still no ORDER BY 0', () => {
    const s = companiesRowsQuery({ group: 'Regus Space' }).toSQL().sql.toLowerCase();
    expect(s).not.toMatch(/order by 0\b/);
    expect(s).toContain('order by "realnex_companies"."company_name"');
  });
});
