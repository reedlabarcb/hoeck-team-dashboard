/**
 * RealNex -> Postgres mirror sync worker (P3.4). READ-ONLY: reads RealNex via the safe
 * wrapper (GET only) and writes to OUR mirror tables. Never writes to RealNex.
 *
 * Four phases (current_phase):
 *   1. companies — page /CrmOData/Companies. The OData feed returns the envelope
 *      { "@odata.context":..., "value":[...] } and does SERVER-DRIVEN paging (a page can be
 *      smaller than the requested $top), so we advance $skip by the ACTUAL returned count and
 *      stop on an empty page. UPSERT by realnex_key; company_name <- OrganizationId.
 *   2. contacts  — page /CrmOData/Contacts the same way; UPSERT. company_key is NOT set here;
 *      it is materialized in phase 4.
 *   3. groups    — listGroups() (PageNumber/PageSize) -> UPSERT realnex_groups.
 *   4. linking   — the inversion walk: for each company GET company/{key}/contacts and
 *      batch-write company_key + denormalized name onto those contacts. RealNex exposes no
 *      contact->company link on reads, so this is the only way. Run at bounded concurrency
 *      with backoff; a company that keeps failing is logged-and-skipped (its key recorded in
 *      job metadata), never aborting the whole sync.
 *
 * FIELD CASING: the /CrmOData/ feeds serialize PascalCase (Key, OrganizationId, WebSite, ...)
 * while the /Crm/ endpoints serialize camelCase. lc() lowercases each item's keys so the row
 * builders are case-insensitive to both (and to future changes). `raw` keeps the original.
 *
 * Idempotent: every write is UPSERT/UPDATE keyed by realnex_key, so re-running is safe.
 */

import { and, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { realnexCompanies, realnexContacts, realnexGroups } from '@/lib/db/schema';
import { listCompanies, listContacts, listGroups, getCompanyContacts } from './safe';
import { normalizeCompanyName } from './normalize';
import { withRetry, mapLimit, resolveConcurrency, isRateLimit } from './retry';
import type { RealNexCompanyListItem, RealNexContactListItem, RealNexGroup } from './types';
import type { RealnexJobContext, RealnexProgress, RealnexSyncResult } from './job-runner';

const ODATA_PAGE = 100; // requested $top (server max = 100; it may return fewer per page)
const CRM_PAGE = 100; // requested PageSize for the Crm endpoints (groups + inversion)
const MAX_PAGES = 1000; // per-feed hard stop; infinite-loop guard (well above any real corpus)

// ----- small coercion helpers (the API items are loosely typed) -----
function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}
function bool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

/**
 * Lowercase an object's top-level keys so field access is case-insensitive to RealNex's
 * serializer (/CrmOData/ = PascalCase, /Crm/ = camelCase). Returns {} for non-objects.
 * `raw` columns still store the untouched original.
 */
function lc(obj: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) out[k.toLowerCase()] = v;
  }
  return out;
}

// tryDate reads keys off an ALREADY-lowercased object (pass lc(...)).
const ACTIVITY_DATE_KEYS = ['date', 'eventdate', 'timestamp', 'occurredat', 'lastactivitydate'];
function tryDate(lcObj: Record<string, unknown>, keys: string[]): Date | null {
  for (const k of keys) {
    const v = lcObj[k];
    if (typeof v === 'string' && v) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  return null;
}

// ----- row builders (case-insensitive via lc) -----
function companyRow(c: RealNexCompanyListItem, jobId: string) {
  const o = lc(c);
  const addr = (o.address ?? null) as Record<string, unknown> | null;
  const a = lc(addr); // address sub-fields are PascalCase too (City, State)
  const name = str(o.organizationid); // <- the company NAME lives in OrganizationId
  return {
    realnexKey: typeof o.key === 'string' ? o.key : '',
    companyName: name,
    companyNameNormalized: normalizeCompanyName(name),
    subsidiaryId: str(o.subsidiaryid),
    investor: bool(o.investor),
    tenant: bool(o.tenant),
    agent: bool(o.agent),
    vendor: bool(o.vendor),
    personal: bool(o.personal),
    prospect: bool(o.prospect),
    phone: str(o.phone),
    fax: str(o.fax),
    email: str(o.email),
    website: str(o.website),
    doNotCall: bool(o.donotcall),
    doNotEmail: bool(o.donotemail),
    doNotFax: bool(o.donotfax),
    doNotMail: bool(o.donotmail),
    address: addr,
    city: str(a.city),
    state: str(a.state),
    objectGroups: (o.objectgroups ?? []) as unknown[],
    lastActivity: (o.lastactivity ?? null) as Record<string, unknown> | null,
    lastActivityAt: tryDate(lc(o.lastactivity), ACTIVITY_DATE_KEYS),
    userKey: str(o.userkey),
    teamKey: str(o.teamkey),
    raw: c as Record<string, unknown>,
    lastSyncRunId: jobId,
  };
}

function contactRow(c: RealNexContactListItem, jobId: string) {
  // company_key / company_name / company_name_normalized are MATERIALIZED by the linking
  // phase — deliberately absent here so re-syncs never clobber a resolved link with null.
  const o = lc(c);
  return {
    realnexKey: typeof o.key === 'string' ? o.key : '',
    fullName: str(o.fullname),
    firstName: str(o.firstname),
    lastName: str(o.lastname),
    salutation: str(o.salutation),
    greeting: str(o.greeting),
    title: str(o.title),
    investor: bool(o.investor),
    tenant: bool(o.tenant),
    agent: bool(o.agent),
    vendor: bool(o.vendor),
    personal: bool(o.personal),
    prospect: bool(o.prospect),
    work: str(o.work),
    fax: str(o.fax),
    mobile: str(o.mobile),
    home: str(o.home),
    email: str(o.email),
    website: str(o.website),
    doNotCall: bool(o.donotcall),
    doNotEmail: bool(o.donotemail),
    doNotFax: bool(o.donotfax),
    doNotMail: bool(o.donotmail),
    address: (o.address ?? null) as Record<string, unknown> | null,
    mailingAddress: (o.mailingaddress ?? null) as Record<string, unknown> | null,
    objectGroups: (o.objectgroups ?? []) as unknown[],
    lastActivity: (o.lastactivity ?? null) as Record<string, unknown> | null,
    lastActivityAt: tryDate(lc(o.lastactivity), ACTIVITY_DATE_KEYS),
    userKey: str(o.userkey),
    teamKey: str(o.teamkey),
    raw: c as Record<string, unknown>,
    lastSyncRunId: jobId,
  };
}

function groupRow(g: RealNexGroup, jobId: string) {
  const o = lc(g);
  return {
    realnexKey: typeof o.key === 'string' ? o.key : '',
    name: str(o.name),
    raw: g as Record<string, unknown>,
    lastSyncRunId: jobId,
  };
}

// ----- UPSERT helpers (batch per page; dedupe within a page by the resolved realnex_key so
//        ON CONFLICT can't hit the same row twice; drop items with no key) -----
async function upsertCompanies(items: RealNexCompanyListItem[], jobId: string): Promise<void> {
  const byKey = new Map<string, ReturnType<typeof companyRow>>();
  for (const c of items) {
    const row = companyRow(c, jobId);
    if (row.realnexKey) byKey.set(row.realnexKey, row);
  }
  const rows = [...byKey.values()];
  if (rows.length === 0) return;
  await db
    .insert(realnexCompanies)
    .values(rows)
    .onConflictDoUpdate({
      target: realnexCompanies.realnexKey,
      set: {
        companyName: sql`excluded.company_name`,
        companyNameNormalized: sql`excluded.company_name_normalized`,
        subsidiaryId: sql`excluded.subsidiary_id`,
        investor: sql`excluded.investor`,
        tenant: sql`excluded.tenant`,
        agent: sql`excluded.agent`,
        vendor: sql`excluded.vendor`,
        personal: sql`excluded.personal`,
        prospect: sql`excluded.prospect`,
        phone: sql`excluded.phone`,
        fax: sql`excluded.fax`,
        email: sql`excluded.email`,
        website: sql`excluded.website`,
        doNotCall: sql`excluded.do_not_call`,
        doNotEmail: sql`excluded.do_not_email`,
        doNotFax: sql`excluded.do_not_fax`,
        doNotMail: sql`excluded.do_not_mail`,
        address: sql`excluded.address`,
        city: sql`excluded.city`,
        state: sql`excluded.state`,
        objectGroups: sql`excluded.object_groups`,
        lastActivity: sql`excluded.last_activity`,
        lastActivityAt: sql`excluded.last_activity_at`,
        userKey: sql`excluded.user_key`,
        teamKey: sql`excluded.team_key`,
        raw: sql`excluded.raw`,
        lastSyncRunId: sql`excluded.last_sync_run_id`,
        lastSyncedAt: sql`NOW()`,
        updatedAt: sql`NOW()`,
        updatedBy: sql`'realnex_sync'`,
      },
    });
}

async function upsertContacts(items: RealNexContactListItem[], jobId: string): Promise<void> {
  const byKey = new Map<string, ReturnType<typeof contactRow>>();
  for (const c of items) {
    const row = contactRow(c, jobId);
    if (row.realnexKey) byKey.set(row.realnexKey, row);
  }
  const rows = [...byKey.values()];
  if (rows.length === 0) return;
  await db
    .insert(realnexContacts)
    .values(rows)
    .onConflictDoUpdate({
      target: realnexContacts.realnexKey,
      // NOTE: company_key / company_name / company_name_normalized intentionally NOT in the
      // update set — the linking phase owns them; overwriting here would blank resolved links.
      set: {
        fullName: sql`excluded.full_name`,
        firstName: sql`excluded.first_name`,
        lastName: sql`excluded.last_name`,
        salutation: sql`excluded.salutation`,
        greeting: sql`excluded.greeting`,
        title: sql`excluded.title`,
        investor: sql`excluded.investor`,
        tenant: sql`excluded.tenant`,
        agent: sql`excluded.agent`,
        vendor: sql`excluded.vendor`,
        personal: sql`excluded.personal`,
        prospect: sql`excluded.prospect`,
        work: sql`excluded.work`,
        fax: sql`excluded.fax`,
        mobile: sql`excluded.mobile`,
        home: sql`excluded.home`,
        email: sql`excluded.email`,
        website: sql`excluded.website`,
        doNotCall: sql`excluded.do_not_call`,
        doNotEmail: sql`excluded.do_not_email`,
        doNotFax: sql`excluded.do_not_fax`,
        doNotMail: sql`excluded.do_not_mail`,
        address: sql`excluded.address`,
        mailingAddress: sql`excluded.mailing_address`,
        objectGroups: sql`excluded.object_groups`,
        lastActivity: sql`excluded.last_activity`,
        lastActivityAt: sql`excluded.last_activity_at`,
        userKey: sql`excluded.user_key`,
        teamKey: sql`excluded.team_key`,
        raw: sql`excluded.raw`,
        lastSyncRunId: sql`excluded.last_sync_run_id`,
        lastSyncedAt: sql`NOW()`,
        updatedAt: sql`NOW()`,
        updatedBy: sql`'realnex_sync'`,
      },
    });
}

async function upsertGroups(items: RealNexGroup[], jobId: string): Promise<void> {
  const byKey = new Map<string, ReturnType<typeof groupRow>>();
  for (const g of items) {
    const row = groupRow(g, jobId);
    if (row.realnexKey) byKey.set(row.realnexKey, row);
  }
  const rows = [...byKey.values()];
  if (rows.length === 0) return;
  await db
    .insert(realnexGroups)
    .values(rows)
    .onConflictDoUpdate({
      target: realnexGroups.realnexKey,
      set: {
        name: sql`excluded.name`,
        raw: sql`excluded.raw`,
        lastSyncRunId: sql`excluded.last_sync_run_id`,
        lastSyncedAt: sql`NOW()`,
        updatedAt: sql`NOW()`,
        updatedBy: sql`'realnex_sync'`,
      },
    });
}

/** Materialize the contact->company link for one company. Returns rows actually updated. */
async function linkContacts(
  contactKeys: string[],
  companyKey: string,
  companyName: string | null,
  companyNameNormalized: string | null,
  jobId: string,
): Promise<number> {
  if (contactKeys.length === 0) return 0;
  const updated = await db
    .update(realnexContacts)
    .set({
      companyKey,
      companyName,
      companyNameNormalized,
      lastSyncRunId: jobId,
      updatedAt: sql`NOW()`,
      updatedBy: sql`'realnex_sync'`,
    })
    .where(and(inArray(realnexContacts.realnexKey, contactKeys), isNull(realnexContacts.deletedAt)))
    .returning({ k: realnexContacts.realnexKey });
  return updated.length;
}

/**
 * Run the full read-only mirror sync. Pushes throttled progress via ctx.reportProgress and
 * returns final counts + the list of companies whose inversion was skipped after retries.
 */
export async function runRealnexSync(opts: { jobContext: RealnexJobContext }): Promise<RealnexSyncResult> {
  const { jobContext: ctx } = opts;
  const startedAt = Date.now();
  const concurrency = resolveConcurrency();

  const counters: RealnexProgress = {
    phase: 'companies',
    companiesSynced: 0,
    contactsSynced: 0,
    groupsSynced: 0,
    linksResolved: 0,
    apiCalls: 0,
    rateLimitHits: 0,
    totalCompanies: null,
    totalContacts: null,
  };
  const skippedCompanyKeys: string[] = [];
  const onRetry = (err: unknown) => {
    if (isRateLimit(err)) counters.rateLimitHits += 1;
  };
  const report = () => ctx.reportProgress({ ...counters });

  console.log(`[realnex-sync] start (concurrency=${concurrency}, odataPage=${ODATA_PAGE})`);

  // ---- Phase 1: companies (OData envelope, server-driven paging via $skip) ----
  counters.phase = 'companies';
  let cSkip = 0;
  for (let pageNo = 0; pageNo < MAX_PAGES; pageNo++) {
    const page = await withRetry(
      () => {
        counters.apiCalls += 1;
        return listCompanies(cSkip, ODATA_PAGE);
      },
      { onRetry },
    );
    if (page.length === 0) break;
    if (pageNo === 0) console.log(`[realnex-sync] companies[0] field keys: ${Object.keys((page[0] ?? {}) as object).join(',')}`);
    await upsertCompanies(page, ctx.jobId);
    counters.companiesSynced += page.length;
    await report();
    cSkip += page.length; // advance by ACTUAL count (server page may be < $top)
  }
  counters.totalCompanies = counters.companiesSynced;
  await report();
  console.log(`[realnex-sync] phase companies done: ${counters.companiesSynced}`);

  // ---- Phase 2: contacts (same server-driven paging) ----
  counters.phase = 'contacts';
  let ctSkip = 0;
  for (let pageNo = 0; pageNo < MAX_PAGES; pageNo++) {
    const page = await withRetry(
      () => {
        counters.apiCalls += 1;
        return listContacts(ctSkip, ODATA_PAGE);
      },
      { onRetry },
    );
    if (page.length === 0) break;
    if (pageNo === 0) console.log(`[realnex-sync] contacts[0] field keys: ${Object.keys((page[0] ?? {}) as object).join(',')}`);
    await upsertContacts(page, ctx.jobId);
    counters.contactsSynced += page.length;
    await report();
    ctSkip += page.length;
  }
  counters.totalContacts = counters.contactsSynced;
  await report();
  console.log(`[realnex-sync] phase contacts done: ${counters.contactsSynced}`);

  // ---- Phase 3: groups (Crm PageNumber paging; stop on empty or once totalCount reached) ----
  counters.phase = 'groups';
  for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
    const gp = await withRetry(
      () => {
        counters.apiCalls += 1;
        return listGroups({ pageNumber, pageSize: CRM_PAGE });
      },
      { onRetry },
    );
    const items = gp.items ?? [];
    if (items.length === 0) break;
    await upsertGroups(items, ctx.jobId);
    counters.groupsSynced += items.length;
    await report();
    const total = gp.totalCount ?? 0;
    if (total > 0 && counters.groupsSynced >= total) break;
  }
  await report();
  console.log(`[realnex-sync] phase groups done: ${counters.groupsSynced}`);

  // ---- Phase 4: linking (inversion walk) ----
  counters.phase = 'linking';
  const companies = await db
    .select({
      key: realnexCompanies.realnexKey,
      name: realnexCompanies.companyName,
      norm: realnexCompanies.companyNameNormalized,
    })
    .from(realnexCompanies)
    .where(isNull(realnexCompanies.deletedAt));

  await mapLimit(companies, concurrency, async (co) => {
    try {
      // Page this company's contacts (usually a single page).
      const contactKeys: string[] = [];
      for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
        const resp = await withRetry(
          () => {
            counters.apiCalls += 1;
            return getCompanyContacts(co.key, { pageNumber, pageSize: CRM_PAGE });
          },
          { onRetry },
        );
        const items = resp.items ?? [];
        if (items.length === 0) break;
        for (const it of items) {
          const k = lc(it).key;
          if (typeof k === 'string' && k) contactKeys.push(k);
        }
        const total = resp.totalCount ?? 0;
        if (total > 0 && contactKeys.length >= total) break;
      }
      if (contactKeys.length > 0) {
        counters.linksResolved += await linkContacts(contactKeys, co.key, co.name, co.norm, ctx.jobId);
      }
    } catch (err) {
      // Log-and-skip: a company whose inversion keeps failing is recorded, never fatal.
      skippedCompanyKeys.push(co.key);
      if (isRateLimit(err)) counters.rateLimitHits += 1;
      console.error(
        `[realnex-sync] linking: skipping company ${co.key} after retries:`,
        err instanceof Error ? err.message : err,
      );
    }
    await report();
  });

  await report();
  const durationMs = Date.now() - startedAt;
  console.log(
    `[realnex-sync] linking done: links=${counters.linksResolved} skipped=${skippedCompanyKeys.length} ` +
      `apiCalls=${counters.apiCalls} rateLimitHits=${counters.rateLimitHits} durationMs=${durationMs}`,
  );

  return {
    companiesSynced: counters.companiesSynced,
    contactsSynced: counters.contactsSynced,
    groupsSynced: counters.groupsSynced,
    linksResolved: counters.linksResolved,
    apiCalls: counters.apiCalls,
    rateLimitHits: counters.rateLimitHits,
    skippedCompanyKeys,
    durationMs,
  };
}
