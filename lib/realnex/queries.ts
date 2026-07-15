/**
 * Dashboard-side READ queries over the RealNex mirror (Phase 3.5).
 *
 * These read our local Postgres mirror (`realnex_companies` / `realnex_contacts`) — NOT the
 * live RealNex API. That's the whole point of the P3.4 sync: pages + autocomplete resolve
 * instantly against the mirror with no per-keystroke network call. (The live RealNex wrapper
 * lives in lib/external/realnex; nothing here touches it.)
 *
 * `resolveEntities` is the SHARED resolver: it powers both the P3.5 list-page search AND the
 * P3.6 note-logging autocomplete. That autocomplete is the highest-consequence step in the
 * whole app — picking the wrong entity means logging a history note to the WRONG record. So
 * every result carries `key` = the RealNex object key (`realnex_key`), which is EXACTLY the
 * key that P3.6 `appendActivity` (POST /api/v1/Crm/object/{key}/history) and `getObjectHistory`
 * target. The P3.5.1 review gate proves that key round-trips to the right record.
 */

import { and, asc, eq, gte, ilike, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { realnexCompanies, realnexContacts, realnexGroups } from '@/lib/db/schema';
import { contactDisplayName, type EntityResult } from './format';

// Re-exported so server callers + tests keep importing them from '@/lib/realnex/queries',
// while the pure implementation/shape lives in the client-safe format module (single source).
export { contactDisplayName };
export type { EntityResult };

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const AUTOCOMPLETE_LIMIT = 10;

/** Clamp a caller-supplied limit into [1, MAX_LIMIT], defaulting when absent/invalid. */
export function clampLimit(raw: unknown, fallback = DEFAULT_LIMIT): number {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

/** Clamp an offset to a non-negative integer. */
export function clampOffset(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

/**
 * Escape LIKE/ILIKE wildcards in user input so a typed `%` or `_` is matched literally, not
 * as a wildcard. We build patterns with these escaped values + our own `%`.
 */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// ---- curated row shapes for the list UIs (not the raw jsonb-heavy rows) ----

const companyCols = {
  key: realnexCompanies.realnexKey,
  name: realnexCompanies.companyName,
  city: realnexCompanies.city,
  state: realnexCompanies.state,
  address: realnexCompanies.address, // full street address jsonb — the /companies list shows this (P3.13 follow-up)
  phone: realnexCompanies.phone,
  email: realnexCompanies.email,
  website: realnexCompanies.website,
  leaseExpiry: realnexCompanies.leaseExpiry,
  sqFt: realnexCompanies.sqFt,
  tenant: realnexCompanies.tenant,
  prospect: realnexCompanies.prospect,
};

const contactCols = {
  key: realnexContacts.realnexKey,
  fullName: realnexContacts.fullName,
  firstName: realnexContacts.firstName,
  lastName: realnexContacts.lastName,
  title: realnexContacts.title,
  email: realnexContacts.email,
  work: realnexContacts.work,
  mobile: realnexContacts.mobile,
  companyKey: realnexContacts.companyKey,
  companyName: realnexContacts.companyName,
  leaseExpiry: realnexContacts.leaseExpiry,
  sqFt: realnexContacts.sqFt,
  tenant: realnexContacts.tenant,
  prospect: realnexContacts.prospect,
};

export type CompanyListRow = { key: string; name: string | null; city: string | null; state: string | null; address: Record<string, unknown> | null; phone: string | null; email: string | null; website: string | null; leaseExpiry: string | null; sqFt: number | null; tenant: boolean | null; prospect: boolean | null };
export type ContactListRow = { key: string; fullName: string | null; firstName: string | null; lastName: string | null; title: string | null; email: string | null; work: string | null; mobile: string | null; companyKey: string | null; companyName: string | null; leaseExpiry: string | null; sqFt: number | null; tenant: boolean | null; prospect: boolean | null };

/**
 * Companies from the mirror, name-searched (ILIKE contains) and prefix-ranked (names that
 * START with the term sort first, then alphabetical). deleted rows excluded.
 */
/** WHERE for companies (shared by row query + count): not-deleted, optional name ILIKE, optional group. */
function companiesWhere(term: string, group?: string) {
  const filters = [isNull(realnexCompanies.deletedAt)];
  if (term) filters.push(ilike(realnexCompanies.companyName, `%${escapeLike(term)}%`));
  // Group filter: the company's object_groups jsonb ([{Key,Name}, ...]) contains this group.
  // Match by NAME, not Key — objectGroups[].Key is UPPERCASE (OData) while realnex_groups holds
  // the /Crm lowercase key, so a Key match would miss on case; group names are consistent.
  if (group) filters.push(sql`${realnexCompanies.objectGroups} @> ${JSON.stringify([{ Name: group }])}::jsonb`);
  return and(...filters);
}

/**
 * The companies row query — exported for SQL regression tests.
 *
 * CRITICAL (P3.5.2 bug): when there's NO search term, order ONLY by name. Do NOT emit a bare
 * `sql\`0\`` fallback — Postgres reads a standalone integer in ORDER BY as a column ORDINAL, so
 * `ORDER BY 0` throws "position 0 is not in select list" and 500s the empty/default list.
 * Prefix-first ranking applies only when a term is present (a CASE expression, not a bare int).
 */
export function companiesRowsQuery(opts: { q?: string; group?: string; limit?: number | string; offset?: number | string } = {}) {
  const term = (opts.q ?? '').trim();
  const prefix = `${escapeLike(term)}%`;
  const orderBy = term
    ? [sql`CASE WHEN ${realnexCompanies.companyName} ILIKE ${prefix} THEN 0 ELSE 1 END`, asc(realnexCompanies.companyName)]
    : [asc(realnexCompanies.companyName)];
  return db
    .select(companyCols)
    .from(realnexCompanies)
    .where(companiesWhere(term, opts.group))
    .orderBy(...orderBy)
    .limit(clampLimit(opts.limit))
    .offset(clampOffset(opts.offset));
}

export async function searchCompanies(opts: { q?: string; group?: string; limit?: number | string; offset?: number | string } = {}): Promise<{ companies: CompanyListRow[]; total: number }> {
  const rows = await companiesRowsQuery(opts);
  const term = (opts.q ?? '').trim();
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(realnexCompanies).where(companiesWhere(term, opts.group));
  return { companies: rows as CompanyListRow[], total: count };
}

/**
 * Contacts from the mirror, searched across name + email (ILIKE contains) and prefix-ranked on
 * name. Optional `companyKey` filter (the materialized link). deleted rows excluded.
 */
/** WHERE for contacts (shared by row query + count): not-deleted, optional companyKey, optional group, optional name/email ILIKE. */
function contactsWhere(term: string, companyKey?: string, group?: string) {
  const filters = [isNull(realnexContacts.deletedAt)];
  if (companyKey) filters.push(eq(realnexContacts.companyKey, companyKey));
  // Group filter: the contact's own object_groups jsonb ([{Key,Name}, ...]) contains this
  // group. Match by NAME (not Key) — same case caveat as companiesWhere: objectGroups[].Key is
  // UPPERCASE (OData) while realnex_groups holds the /Crm lowercase key, so a Key match misses.
  if (group) filters.push(sql`${realnexContacts.objectGroups} @> ${JSON.stringify([{ Name: group }])}::jsonb`);
  if (term) {
    const like = `%${escapeLike(term)}%`;
    filters.push(
      sql`(${realnexContacts.fullName} ILIKE ${like} OR ${realnexContacts.firstName} ILIKE ${like} OR ${realnexContacts.lastName} ILIKE ${like} OR ${realnexContacts.email} ILIKE ${like})`,
    );
  }
  return and(...filters);
}

/**
 * The contacts row query — exported for SQL regression tests. Same ORDER BY safety as
 * companiesRowsQuery: no bare `sql\`0\`` on the empty-term path (that 500s as ORDER BY ordinal 0).
 */
export function contactsRowsQuery(opts: { q?: string; companyKey?: string; group?: string; limit?: number | string; offset?: number | string } = {}) {
  const term = (opts.q ?? '').trim();
  const prefix = `${escapeLike(term)}%`;
  const orderBy = term
    ? [sql`CASE WHEN (${realnexContacts.fullName} ILIKE ${prefix} OR ${realnexContacts.lastName} ILIKE ${prefix}) THEN 0 ELSE 1 END`, asc(realnexContacts.fullName)]
    : [asc(realnexContacts.fullName)];
  return db
    .select(contactCols)
    .from(realnexContacts)
    .where(contactsWhere(term, opts.companyKey, opts.group))
    .orderBy(...orderBy)
    .limit(clampLimit(opts.limit))
    .offset(clampOffset(opts.offset));
}

export async function searchContacts(opts: { q?: string; companyKey?: string; group?: string; limit?: number | string; offset?: number | string } = {}): Promise<{ contacts: ContactListRow[]; total: number }> {
  const rows = await contactsRowsQuery(opts);
  const term = (opts.q ?? '').trim();
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(realnexContacts).where(contactsWhere(term, opts.companyKey, opts.group));
  return { contacts: rows as ContactListRow[], total: count };
}

/** True if `name` starts with `term` (case-insensitive). Pure — used to rank merged results. */
export function isPrefixMatch(name: string | null | undefined, term: string): boolean {
  if (!name || !term) return false;
  return name.trim().toLowerCase().startsWith(term.trim().toLowerCase());
}

/**
 * Rank merged autocomplete results: prefix matches first, then alphabetical by displayName.
 * Pure + exported so the ranking is unit-testable without a DB.
 */
export function rankEntities(results: EntityResult[], term: string): EntityResult[] {
  return [...results].sort((a, b) => {
    const ap = isPrefixMatch(a.displayName, term) ? 0 : 1;
    const bp = isPrefixMatch(b.displayName, term) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return a.displayName.localeCompare(b.displayName);
  });
}

/**
 * THE SHARED RESOLVER — powers list-page search and (P3.6) the note-logging autocomplete.
 *
 * Returns ranked {type, key, displayName, companyName, email}. `key` is the RealNex object key
 * (`realnex_key`) — the exact key P3.6 appendActivity / getObjectHistory target. Resolving the
 * correct key here is the app's highest-consequence step (wrong key = note on the wrong record),
 * so P3.5.1's review gate round-trips this key against the live /Crm object endpoints.
 */
export async function resolveEntities(opts: { q: string; type?: 'contact' | 'company' | 'both'; limit?: number | string }): Promise<EntityResult[]> {
  const term = (opts.q ?? '').trim();
  if (!term) return [];
  const type = opts.type ?? 'both';
  const limit = clampLimit(opts.limit, AUTOCOMPLETE_LIMIT);

  const results: EntityResult[] = [];

  if (type === 'contact' || type === 'both') {
    const { contacts } = await searchContacts({ q: term, limit });
    for (const c of contacts) {
      results.push({
        type: 'contact',
        key: c.key,
        displayName: contactDisplayName(c),
        companyName: c.companyName ?? null,
        email: c.email ?? null,
      });
    }
  }
  if (type === 'company' || type === 'both') {
    const { companies } = await searchCompanies({ q: term, limit });
    for (const co of companies) {
      results.push({
        type: 'company',
        key: co.key,
        displayName: co.name ?? '(unnamed company)',
        companyName: co.name ?? null,
        email: co.email ?? null,
      });
    }
  }

  return rankEntities(results, term).slice(0, limit);
}

/** Groups from the mirror ({key, name}), for the list-page filter dropdown. Ordered by name. */
export async function listGroups(): Promise<{ key: string; name: string | null }[]> {
  return db
    .select({ key: realnexGroups.realnexKey, name: realnexGroups.name })
    .from(realnexGroups)
    .where(isNull(realnexGroups.deletedAt))
    .orderBy(asc(realnexGroups.name));
}

// ---- single-record detail reads (P3.13 Record View) — mirror only, by realnex_key ----
// Fuller field sets than the list cols (address, all flags, groups) for the profile pages. Still
// curated (no `raw` jsonb). History/notes are NOT here — those are fetched LIVE per view.

const companyDetailCols = {
  key: realnexCompanies.realnexKey,
  name: realnexCompanies.companyName,
  phone: realnexCompanies.phone,
  fax: realnexCompanies.fax,
  email: realnexCompanies.email,
  website: realnexCompanies.website,
  address: realnexCompanies.address,
  city: realnexCompanies.city,
  state: realnexCompanies.state,
  leaseExpiry: realnexCompanies.leaseExpiry,
  sqFt: realnexCompanies.sqFt,
  tenant: realnexCompanies.tenant,
  prospect: realnexCompanies.prospect,
  investor: realnexCompanies.investor,
  agent: realnexCompanies.agent,
  vendor: realnexCompanies.vendor,
  personal: realnexCompanies.personal,
  objectGroups: realnexCompanies.objectGroups,
  lastActivityAt: realnexCompanies.lastActivityAt,
};

const contactDetailCols = {
  key: realnexContacts.realnexKey,
  fullName: realnexContacts.fullName,
  firstName: realnexContacts.firstName,
  lastName: realnexContacts.lastName,
  title: realnexContacts.title,
  email: realnexContacts.email,
  work: realnexContacts.work,
  mobile: realnexContacts.mobile,
  home: realnexContacts.home,
  fax: realnexContacts.fax,
  website: realnexContacts.website,
  companyKey: realnexContacts.companyKey,
  companyName: realnexContacts.companyName,
  address: realnexContacts.address,
  leaseExpiry: realnexContacts.leaseExpiry,
  sqFt: realnexContacts.sqFt,
  tenant: realnexContacts.tenant,
  prospect: realnexContacts.prospect,
  investor: realnexContacts.investor,
  agent: realnexContacts.agent,
  vendor: realnexContacts.vendor,
  personal: realnexContacts.personal,
  objectGroups: realnexContacts.objectGroups,
  lastActivityAt: realnexContacts.lastActivityAt,
};

/** One company from the mirror by realnex_key (not-deleted), or null. Detail-page profile read. */
export async function getCompanyByKey(key: string) {
  const rows = await db
    .select(companyDetailCols)
    .from(realnexCompanies)
    .where(and(eq(realnexCompanies.realnexKey, key), isNull(realnexCompanies.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

/** One contact from the mirror by realnex_key (not-deleted), or null. Detail-page profile read. */
export async function getContactByKey(key: string) {
  const rows = await db
    .select(contactDetailCols)
    .from(realnexContacts)
    .where(and(eq(realnexContacts.realnexKey, key), isNull(realnexContacts.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

/** The by-key row query builders, exported for SQL regression tests (toSQL, no DB execution). */
export function companyByKeyQuery(key: string) {
  return db.select(companyDetailCols).from(realnexCompanies).where(and(eq(realnexCompanies.realnexKey, key), isNull(realnexCompanies.deletedAt))).limit(1);
}
export function contactByKeyQuery(key: string) {
  return db.select(contactDetailCols).from(realnexContacts).where(and(eq(realnexContacts.realnexKey, key), isNull(realnexContacts.deletedAt))).limit(1);
}

export type CompanyDetail = NonNullable<Awaited<ReturnType<typeof getCompanyByKey>>>;
export type ContactDetail = NonNullable<Awaited<ReturnType<typeof getContactByKey>>>;

// ============================================================================
// Master Query (P3.11 / Workflow 4) — stackable AND filters over the mirror. ONE composed WHERE
// feeds two consumers: the paginated VIEW and the uncapped EXPORT. READ-ONLY (mirror columns +
// jsonb; no RealNex calls). Per-entity casing discipline lives in queryCols():
//   • company city/state = flat columns; contact city/state = address->>'City'/'State' (PascalCase)
//   • address-contains = PascalCase ->> keys (Address1/Address2/City/State/ZipCode)
//   • group = object_groups @> [{"Name": …}] (PascalCase, shape verified live); flags = boolean cols
// NULL lease_expiry / sq_ft are excluded ONLY when that filter is active — a comparison against NULL
// is NULL (≠ true), so with no lease/SF filter those records still appear (this isn't a lease-only tool).
// ============================================================================

export type QueryFlag = 'tenant' | 'prospect' | 'investor' | 'agent' | 'vendor' | 'personal';
const QUERY_FLAGS: readonly QueryFlag[] = ['tenant', 'prospect', 'investor', 'agent', 'vendor', 'personal'];

export interface QueryFilters {
  entity: 'companies' | 'contacts';
  q?: string; // name / company / email contains
  lxdFrom?: string; // 'YYYY-MM-DD' inclusive
  lxdTo?: string; // 'YYYY-MM-DD' inclusive
  sfMin?: number;
  sfMax?: number;
  city?: string;
  state?: string;
  address?: string; // address text contains
  flags?: QueryFlag[]; // OR within this dimension
  group?: string; // group NAME
}

/**
 * Export backstop: the largest single entity is ~1,872 rows (~3,150 total across both), so this is
 * unreachable at any realistic mirror size. It exists to bound a runaway export, NOT to truncate real
 * data — at current scale the export always returns the complete filtered set.
 */
export const QUERY_EXPORT_MAX = 50_000;

/** Per-entity column/expression resolver — the ONE place the company/contact casing asymmetry lives. */
function queryCols(entity: QueryFilters['entity']) {
  if (entity === 'companies') {
    return {
      deletedAt: realnexCompanies.deletedAt,
      leaseExpiry: realnexCompanies.leaseExpiry,
      sqFt: realnexCompanies.sqFt,
      objectGroups: realnexCompanies.objectGroups,
      address: realnexCompanies.address,
      city: sql`${realnexCompanies.city}`, // flat column
      state: sql`${realnexCompanies.state}`, // flat column
      nameFields: [realnexCompanies.companyName],
      flags: {
        tenant: realnexCompanies.tenant, prospect: realnexCompanies.prospect, investor: realnexCompanies.investor,
        agent: realnexCompanies.agent, vendor: realnexCompanies.vendor, personal: realnexCompanies.personal,
      },
    };
  }
  return {
    deletedAt: realnexContacts.deletedAt,
    leaseExpiry: realnexContacts.leaseExpiry,
    sqFt: realnexContacts.sqFt,
    objectGroups: realnexContacts.objectGroups,
    address: realnexContacts.address,
    city: sql`${realnexContacts.address}->>'City'`, // contacts have NO flat city column — read the jsonb (PascalCase)
    state: sql`${realnexContacts.address}->>'State'`,
    nameFields: [realnexContacts.fullName, realnexContacts.firstName, realnexContacts.lastName, realnexContacts.email],
    flags: {
      tenant: realnexContacts.tenant, prospect: realnexContacts.prospect, investor: realnexContacts.investor,
      agent: realnexContacts.agent, vendor: realnexContacts.vendor, personal: realnexContacts.personal,
    },
  };
}

/** Compose the WHERE: not-deleted AND (only the active filters). Empty filters ⇒ just not-deleted. */
export function buildQueryWhere(f: QueryFilters) {
  const c = queryCols(f.entity);
  const clauses = [isNull(c.deletedAt)];

  const term = (f.q ?? '').trim();
  if (term) {
    const like = `%${escapeLike(term)}%`;
    clauses.push(or(...c.nameFields.map((field) => ilike(field, like)))!);
  }

  // Lease window — NULL lease_expiry drops automatically (NULL >= X is NULL), so records with no LXD
  // are excluded ONLY when a lease bound is set.
  if (f.lxdFrom) clauses.push(gte(c.leaseExpiry, f.lxdFrom));
  if (f.lxdTo) clauses.push(lte(c.leaseExpiry, f.lxdTo));

  // SF range — same NULL semantics as the lease window.
  if (f.sfMin != null) clauses.push(gte(c.sqFt, f.sfMin));
  if (f.sfMax != null) clauses.push(lte(c.sqFt, f.sfMax));

  // Location — city/state resolved per entity (company column vs contact address->>'City'/'State').
  if (f.city?.trim()) clauses.push(sql`${c.city} ILIKE ${`%${escapeLike(f.city.trim())}%`}`);
  if (f.state?.trim()) clauses.push(sql`${c.state} ILIKE ${`%${escapeLike(f.state.trim())}%`}`);
  if (f.address?.trim()) {
    const like = `%${escapeLike(f.address.trim())}%`;
    clauses.push(
      sql`(${c.address}->>'Address1' ILIKE ${like} OR ${c.address}->>'Address2' ILIKE ${like} OR ${c.address}->>'City' ILIKE ${like} OR ${c.address}->>'State' ILIKE ${like} OR ${c.address}->>'ZipCode' ILIKE ${like})`,
    );
  }

  // Type flags — OR WITHIN the dimension (union), ANDed with everything else. Unknown flags ignored.
  const flags = (f.flags ?? []).filter((x): x is QueryFlag => QUERY_FLAGS.includes(x));
  if (flags.length) clauses.push(or(...flags.map((name) => eq(c.flags[name], true)))!);

  // Group membership — object_groups @> [{"Name": …}] (PascalCase; jsonb payload bound as a param).
  if (f.group?.trim()) {
    clauses.push(sql`${c.objectGroups} @> ${JSON.stringify([{ Name: f.group.trim() }])}::jsonb`);
  }

  return and(...clauses);
}

/** VIEW rows — paginated (limit ≤ 100, default 100; offset), curated detail columns. For toSQL tests + runQuery. */
export function queryRowsQuery(f: QueryFilters, opts: { limit?: number | string; offset?: number | string } = {}) {
  const where = buildQueryWhere(f);
  const limit = clampLimit(opts.limit, MAX_LIMIT);
  const offset = clampOffset(opts.offset);
  return f.entity === 'companies'
    ? db.select(companyDetailCols).from(realnexCompanies).where(where).orderBy(asc(realnexCompanies.companyName)).limit(limit).offset(offset)
    : db.select(contactDetailCols).from(realnexContacts).where(where).orderBy(asc(realnexContacts.fullName)).limit(limit).offset(offset);
}

/** EXPORT rows — the SAME where, uncapped (bounded only by the unreachable QUERY_EXPORT_MAX). For toSQL tests + runQueryExport. */
export function queryExportRowsQuery(f: QueryFilters) {
  const where = buildQueryWhere(f);
  return f.entity === 'companies'
    ? db.select(companyDetailCols).from(realnexCompanies).where(where).orderBy(asc(realnexCompanies.companyName)).limit(QUERY_EXPORT_MAX)
    : db.select(contactDetailCols).from(realnexContacts).where(where).orderBy(asc(realnexContacts.fullName)).limit(QUERY_EXPORT_MAX);
}

/** Count of ALL rows matching the filters (ignores pagination). */
export async function queryCount(f: QueryFilters): Promise<number> {
  const where = buildQueryWhere(f);
  const table = f.entity === 'companies' ? realnexCompanies : realnexContacts;
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(table).where(where);
  return count;
}

/** VIEW: one page of results + the total match count. */
export async function runQuery(f: QueryFilters, opts: { limit?: number | string; offset?: number | string } = {}) {
  const [rows, total] = await Promise.all([queryRowsQuery(f, opts), queryCount(f)]);
  return { rows, total };
}

/** EXPORT: every matching row (up to the unreachable backstop) + the total. */
export async function runQueryExport(f: QueryFilters) {
  const [rows, total] = await Promise.all([queryExportRowsQuery(f), queryCount(f)]);
  if (rows.length >= QUERY_EXPORT_MAX) {
    console.warn(`[master-query] export hit the ${QUERY_EXPORT_MAX}-row backstop — unexpected at current scale; result truncated.`);
  }
  return { rows, total };
}
