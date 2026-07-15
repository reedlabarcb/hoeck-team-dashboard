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
  queryRowsQuery,
  queryExportRowsQuery,
  QUERY_EXPORT_MAX,
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

// P3.11 Master Query — composable stackable AND filters. Rendered via toSQL() (no DB). PascalCase
// assertions read the RAW sql (NOT lowercased) so `->>'City'` casing is actually verified — the whole
// point after this session's address/group casing bugs.
describe('Master Query — query layer (P3.11)', () => {
  it('no filters ⇒ just not-deleted; no lease/sf clauses; ordered by name', () => {
    const { sql, params } = queryRowsQuery({ entity: 'companies' }).toSQL();
    const low = sql.toLowerCase();
    expect(low).toContain('"deleted_at" is null');
    // NULL-LXD/SF rule: no lease/sf COMPARISON in the WHERE unless that filter is active. (The columns
    // themselves are in the SELECT list, so assert on the comparison operators, not the bare names.)
    expect(low).not.toContain('"lease_expiry" >=');
    expect(low).not.toContain('"lease_expiry" <=');
    expect(low).not.toContain('"sq_ft" >=');
    expect(low).not.toContain('"sq_ft" <=');
    expect(low).toContain('order by "realnex_companies"."company_name"');
    expect(params).toContain(100); // view default page = MAX_LIMIT
  });

  it('lease window adds lease_expiry >= / <= (NULL excluded ONLY when active)', () => {
    const { sql, params } = queryRowsQuery({ entity: 'companies', lxdFrom: '2026-07-15', lxdTo: '2027-07-15' }).toSQL();
    const low = sql.toLowerCase();
    expect(low).toContain('"lease_expiry" >=');
    expect(low).toContain('"lease_expiry" <=');
    expect(params).toEqual(expect.arrayContaining(['2026-07-15', '2027-07-15']));
  });

  it('SF range adds sq_ft >= / <= (NULL excluded ONLY when active)', () => {
    const { sql, params } = queryRowsQuery({ entity: 'companies', sfMin: 10000, sfMax: 50000 }).toSQL();
    const low = sql.toLowerCase();
    expect(low).toContain('"sq_ft" >=');
    expect(low).toContain('"sq_ft" <=');
    expect(params).toEqual(expect.arrayContaining([10000, 50000]));
  });

  it('COMPANY location uses the flat city/state columns (no jsonb)', () => {
    const { sql, params } = queryRowsQuery({ entity: 'companies', city: 'San Diego', state: 'CA' }).toSQL();
    expect(sql).toContain('"realnex_companies"."city"');
    expect(sql).toContain('"realnex_companies"."state"');
    expect(sql).not.toContain("->>'City'"); // companies do NOT read city from jsonb
    expect(params).toEqual(expect.arrayContaining(['%San Diego%', '%CA%']));
  });

  it('CONTACT location reads address->>\'City\'/\'State\' (PascalCase jsonb, no flat column)', () => {
    const { sql, params } = queryRowsQuery({ entity: 'contacts', city: 'San Diego', state: 'CA' }).toSQL();
    expect(sql).toContain(`"realnex_contacts"."address"->>'City'`);
    expect(sql).toContain(`"realnex_contacts"."address"->>'State'`);
    expect(params).toEqual(expect.arrayContaining(['%San Diego%', '%CA%']));
  });

  it('address-contains searches PascalCase ->> keys (Address1/Address2/City/State/ZipCode)', () => {
    const { sql, params } = queryRowsQuery({ entity: 'companies', address: 'Broadway' }).toSQL();
    expect(sql).toContain(`->>'Address1'`);
    expect(sql).toContain(`->>'Address2'`);
    expect(sql).toContain(`->>'City'`);
    expect(sql).toContain(`->>'ZipCode'`);
    expect(params.filter((p) => p === '%Broadway%').length).toBeGreaterThanOrEqual(1);
  });

  it('flags are OR-within-dimension; unknown flags ignored', () => {
    const two = queryRowsQuery({ entity: 'companies', flags: ['tenant', 'prospect'] }).toSQL().sql.toLowerCase();
    expect(two).toContain('"tenant" =');
    expect(two).toContain('"prospect" =');
    expect(two).toContain(' or '); // unioned within the dimension
    const one = queryRowsQuery({ entity: 'companies', flags: ['tenant'] }).toSQL().sql.toLowerCase();
    expect(one).toContain('"tenant" =');
    expect(one).not.toContain(' or '); // single flag ⇒ no union
    const bogus = queryRowsQuery({ entity: 'companies', flags: ['tenant', 'bogus' as never] }).toSQL().sql.toLowerCase();
    expect(bogus).toContain('"tenant" =');
    expect(bogus).not.toContain('bogus'); // whitelisted to the 6 real flags
  });

  it('group filter matches PascalCase {Name}', () => {
    const { sql, params } = queryRowsQuery({ entity: 'contacts', group: 'Regus Space' }).toSQL();
    expect(sql.toLowerCase()).toContain('"object_groups" @>');
    expect(params).toContain(JSON.stringify([{ Name: 'Regus Space' }]));
  });

  it('q searches company_name (companies) vs full/first/last/email OR (contacts)', () => {
    const co = queryRowsQuery({ entity: 'companies', q: 'gen' }).toSQL();
    expect(co.sql.toLowerCase()).toContain('"company_name" ilike');
    expect(co.params).toContain('%gen%');
    const ct = queryRowsQuery({ entity: 'contacts', q: 'mar' }).toSQL().sql.toLowerCase();
    expect(ct).toContain('"full_name" ilike');
    expect(ct).toContain('"email" ilike');
    expect(ct).toContain(' or '); // name fields unioned
  });

  it('STACKS multiple dimensions with AND (contacts + Tenant/Prospect + city + SF range + lease window)', () => {
    const { sql, params } = queryRowsQuery({
      entity: 'contacts',
      flags: ['tenant', 'prospect'],
      city: 'San Diego',
      sfMin: 10000,
      sfMax: 50000,
      lxdFrom: '2026-07-15',
      lxdTo: '2027-07-15',
    }).toSQL();
    const low = sql.toLowerCase();
    expect(low).toContain('"deleted_at" is null');
    expect(sql).toContain(`"realnex_contacts"."address"->>'City'`); // PascalCase contact city
    expect(low).toContain('"sq_ft" >=');
    expect(low).toContain('"sq_ft" <=');
    expect(low).toContain('"lease_expiry" >=');
    expect(low).toContain('"lease_expiry" <=');
    expect(low).toContain('"tenant" =');
    expect(low).toContain('"prospect" =');
    expect(low).toContain(' and '); // dimensions ANDed
    expect(low).toContain(' or '); // flags OR'd within their dimension
    expect(params).toEqual(expect.arrayContaining(['%San Diego%', 10000, 50000, '2026-07-15', '2027-07-15']));
  });

  it('export query is uncapped (QUERY_EXPORT_MAX), view is capped at 100; backstop is unreachable', () => {
    const asText = (b: { sql: string; params: unknown[] }) => `${b.sql} ${JSON.stringify(b.params)}`;
    expect(asText(queryExportRowsQuery({ entity: 'companies' }).toSQL())).toContain('50000');
    expect(asText(queryRowsQuery({ entity: 'companies' }).toSQL())).toContain('100');
    expect(QUERY_EXPORT_MAX).toBeGreaterThanOrEqual(50_000); // dataset is ~3,150 total → never truncates
  });
});
