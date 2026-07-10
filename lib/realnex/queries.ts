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

import { and, asc, eq, ilike, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { realnexCompanies, realnexContacts, realnexGroups } from '@/lib/db/schema';

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

/** A contact's best display name: full_name, else "first last", else a placeholder. */
export function contactDisplayName(row: { fullName?: string | null; firstName?: string | null; lastName?: string | null }): string {
  if (row.fullName && row.fullName.trim()) return row.fullName.trim();
  const joined = [row.firstName, row.lastName].filter((s) => s && s.trim()).join(' ').trim();
  return joined || '(no name)';
}

/** Shared autocomplete result shape — `key` is the RealNex object key (see file header). */
export interface EntityResult {
  type: 'contact' | 'company';
  key: string;
  displayName: string;
  companyName: string | null;
  email: string | null;
}

// ---- curated row shapes for the list UIs (not the raw jsonb-heavy rows) ----

const companyCols = {
  key: realnexCompanies.realnexKey,
  name: realnexCompanies.companyName,
  city: realnexCompanies.city,
  state: realnexCompanies.state,
  phone: realnexCompanies.phone,
  email: realnexCompanies.email,
  website: realnexCompanies.website,
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
  tenant: realnexContacts.tenant,
  prospect: realnexContacts.prospect,
};

export type CompanyListRow = { key: string; name: string | null; city: string | null; state: string | null; phone: string | null; email: string | null; website: string | null; tenant: boolean | null; prospect: boolean | null };
export type ContactListRow = { key: string; fullName: string | null; firstName: string | null; lastName: string | null; title: string | null; email: string | null; work: string | null; mobile: string | null; companyKey: string | null; companyName: string | null; tenant: boolean | null; prospect: boolean | null };

/**
 * Companies from the mirror, name-searched (ILIKE contains) and prefix-ranked (names that
 * START with the term sort first, then alphabetical). deleted rows excluded.
 */
export async function searchCompanies(opts: { q?: string; group?: string; limit?: number | string; offset?: number | string } = {}): Promise<{ companies: CompanyListRow[]; total: number }> {
  const term = (opts.q ?? '').trim();
  const limit = clampLimit(opts.limit);
  const offset = clampOffset(opts.offset);

  const filters = [isNull(realnexCompanies.deletedAt)];
  if (term) filters.push(ilike(realnexCompanies.companyName, `%${escapeLike(term)}%`));
  // Group filter: the company's object_groups jsonb ([{Key,Name}, ...]) contains this group.
  // Match by NAME, not Key — objectGroups[].Key is UPPERCASE (OData) while realnex_groups holds
  // the /Crm lowercase key, so a Key match would miss on case; group names are consistent.
  if (opts.group) filters.push(sql`${realnexCompanies.objectGroups} @> ${JSON.stringify([{ Name: opts.group }])}::jsonb`);
  const where = and(...filters);

  const prefix = `${escapeLike(term)}%`;
  const rows = await db
    .select(companyCols)
    .from(realnexCompanies)
    .where(where)
    .orderBy(
      term ? sql`CASE WHEN ${realnexCompanies.companyName} ILIKE ${prefix} THEN 0 ELSE 1 END` : sql`0`,
      asc(realnexCompanies.companyName),
    )
    .limit(limit)
    .offset(offset);

  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(realnexCompanies).where(where);
  return { companies: rows as CompanyListRow[], total: count };
}

/**
 * Contacts from the mirror, searched across name + email (ILIKE contains) and prefix-ranked on
 * name. Optional `companyKey` filter (the materialized link). deleted rows excluded.
 */
export async function searchContacts(opts: { q?: string; companyKey?: string; limit?: number | string; offset?: number | string } = {}): Promise<{ contacts: ContactListRow[]; total: number }> {
  const term = (opts.q ?? '').trim();
  const limit = clampLimit(opts.limit);
  const offset = clampOffset(opts.offset);

  const filters = [isNull(realnexContacts.deletedAt)];
  if (opts.companyKey) filters.push(eq(realnexContacts.companyKey, opts.companyKey));
  if (term) {
    const like = `%${escapeLike(term)}%`;
    filters.push(
      sql`(${realnexContacts.fullName} ILIKE ${like} OR ${realnexContacts.firstName} ILIKE ${like} OR ${realnexContacts.lastName} ILIKE ${like} OR ${realnexContacts.email} ILIKE ${like})`,
    );
  }
  const where = and(...filters);

  const prefix = `${escapeLike(term)}%`;
  const rows = await db
    .select(contactCols)
    .from(realnexContacts)
    .where(where)
    .orderBy(
      term
        ? sql`CASE WHEN (${realnexContacts.fullName} ILIKE ${prefix} OR ${realnexContacts.lastName} ILIKE ${prefix}) THEN 0 ELSE 1 END`
        : sql`0`,
      asc(realnexContacts.fullName),
    )
    .limit(limit)
    .offset(offset);

  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(realnexContacts).where(where);
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
