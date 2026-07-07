/**
 * RealNex -> Postgres mirror sync worker (P3.4). READ-ONLY: reads RealNex via the safe
 * wrapper (GET only) and writes to OUR mirror tables. Never writes to RealNex.
 *
 * Four phases (current_phase):
 *   1. companies — page /CrmOData/Companies ($skip/$top, raw array, length-terminated),
 *      UPSERT by realnex_key; company_name <- organizationId; compute normalized name.
 *   2. contacts  — page /CrmOData/Contacts the same way; UPSERT. company_key is NOT set
 *      here (left null / untouched); it is materialized in phase 4.
 *   3. groups    — listGroups() (PageNumber/PageSize) -> UPSERT realnex_groups.
 *   4. linking   — the inversion walk: for each company GET company/{key}/contacts and
 *      batch-write company_key + denormalized name onto those contacts. RealNex exposes
 *      no contact->company link on reads, so this is the only way. ~1,275 calls, run at
 *      bounded concurrency with backoff; a company that keeps failing is logged-and-skipped
 *      (its key recorded in job metadata), never aborting the whole sync.
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

// RealNex OData feeds HARD-CAP $top at 100 (else HTTP 400 "The limit of '100' for Top query
// has been exceeded"). The Crm PageNumber/PageSize endpoints (groups, inversion) have no
// confirmed higher cap, so we conservatively page EVERYTHING at 100.
const ODATA_PAGE = 100; // $top for the Companies/Contacts OData feeds (server max = 100)
const CRM_PAGE = 100; // PageSize for the Crm endpoints (groups + inversion)

// ----- small coercion helpers (the API items are loosely typed) -----
function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}
function bool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}
function tryDate(obj: unknown, keys: string[]): Date | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  return null;
}
const ACTIVITY_DATE_KEYS = ['date', 'eventDate', 'timestamp', 'occurredAt', 'lastActivityDate'];

// ----- row builders -----
function companyRow(c: RealNexCompanyListItem, jobId: string) {
  const addr = (c.address ?? null) as Record<string, unknown> | null;
  const name = str(c.organizationId); // <- the company NAME lives in organizationId
  return {
    realnexKey: c.key as string,
    companyName: name,
    companyNameNormalized: normalizeCompanyName(name),
    subsidiaryId: str(c.subsidiaryId),
    investor: bool(c.investor),
    tenant: bool(c.tenant),
    agent: bool(c.agent),
    vendor: bool(c.vendor),
    personal: bool(c.personal),
    prospect: bool(c.prospect),
    phone: str(c.phone),
    fax: str(c.fax),
    email: str(c.email),
    website: str(c.webSite),
    doNotCall: bool(c.doNotCall),
    doNotEmail: bool(c.doNotEmail),
    doNotFax: bool(c.doNotFax),
    doNotMail: bool(c.doNotMail),
    address: addr,
    city: str(addr?.city),
    state: str(addr?.state),
    objectGroups: (c.objectGroups ?? []) as unknown[],
    lastActivity: (c.lastActivity ?? null) as Record<string, unknown> | null,
    lastActivityAt: tryDate(c.lastActivity, ACTIVITY_DATE_KEYS),
    userKey: str(c.userKey),
    teamKey: str(c.teamKey),
    raw: c as Record<string, unknown>,
    lastSyncRunId: jobId,
  };
}

function contactRow(c: RealNexContactListItem, jobId: string) {
  // company_key / company_name / company_name_normalized are MATERIALIZED by the linking
  // phase — deliberately absent here so re-syncs never clobber a resolved link with null.
  return {
    realnexKey: c.key as string,
    fullName: str(c.fullName),
    firstName: str(c.firstName),
    lastName: str(c.lastName),
    salutation: str(c.salutation),
    greeting: str(c.greeting),
    title: str(c.title),
    investor: bool(c.investor),
    tenant: bool(c.tenant),
    agent: bool(c.agent),
    vendor: bool(c.vendor),
    personal: bool(c.personal),
    prospect: bool(c.prospect),
    work: str(c.work),
    fax: str(c.fax),
    mobile: str(c.mobile),
    home: str(c.home),
    email: str(c.email),
    website: str(c.webSite),
    doNotCall: bool(c.doNotCall),
    doNotEmail: bool(c.doNotEmail),
    doNotFax: bool(c.doNotFax),
    doNotMail: bool(c.doNotMail),
    address: (c.address ?? null) as Record<string, unknown> | null,
    mailingAddress: (c.mailingAddress ?? null) as Record<string, unknown> | null,
    objectGroups: (c.objectGroups ?? []) as unknown[],
    lastActivity: (c.lastActivity ?? null) as Record<string, unknown> | null,
    lastActivityAt: tryDate(c.lastActivity, ACTIVITY_DATE_KEYS),
    userKey: str(c.userKey),
    teamKey: str(c.teamKey),
    raw: c as Record<string, unknown>,
    lastSyncRunId: jobId,
  };
}

function groupRow(g: RealNexGroup, jobId: string) {
  return {
    realnexKey: g.key as string,
    name: str(g.name),
    raw: g as Record<string, unknown>,
    lastSyncRunId: jobId,
  };
}

// ----- UPSERT helpers (batch per page; dedupe within a page so ON CONFLICT can't hit the
//        same row twice in one statement) -----
async function upsertCompanies(items: RealNexCompanyListItem[], jobId: string): Promise<void> {
  const byKey = new Map<string, ReturnType<typeof companyRow>>();
  for (const c of items) if (typeof c.key === 'string' && c.key) byKey.set(c.key, companyRow(c, jobId));
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
  for (const c of items) if (typeof c.key === 'string' && c.key) byKey.set(c.key, contactRow(c, jobId));
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
  for (const g of items) if (typeof g.key === 'string' && g.key) byKey.set(g.key, groupRow(g, jobId));
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

  // ---- Phase 1: companies ----
  counters.phase = 'companies';
  for (let skip = 0; ; skip += ODATA_PAGE) {
    const page = await withRetry(
      () => {
        counters.apiCalls += 1;
        return listCompanies(skip, ODATA_PAGE);
      },
      { onRetry },
    );
    if (page.length === 0) break;
    await upsertCompanies(page, ctx.jobId);
    counters.companiesSynced += page.length;
    await report();
    if (page.length < ODATA_PAGE) break;
  }
  counters.totalCompanies = counters.companiesSynced;
  await report();
  console.log(`[realnex-sync] phase companies done: ${counters.companiesSynced}`);

  // ---- Phase 2: contacts ----
  counters.phase = 'contacts';
  for (let skip = 0; ; skip += ODATA_PAGE) {
    const page = await withRetry(
      () => {
        counters.apiCalls += 1;
        return listContacts(skip, ODATA_PAGE);
      },
      { onRetry },
    );
    if (page.length === 0) break;
    await upsertContacts(page, ctx.jobId);
    counters.contactsSynced += page.length;
    await report();
    if (page.length < ODATA_PAGE) break;
  }
  counters.totalContacts = counters.contactsSynced;
  await report();
  console.log(`[realnex-sync] phase contacts done: ${counters.contactsSynced}`);

  // ---- Phase 3: groups ----
  counters.phase = 'groups';
  for (let pageNumber = 1; ; pageNumber++) {
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
    const total = gp.totalCount ?? counters.groupsSynced;
    if (items.length < CRM_PAGE || counters.groupsSynced >= total) break;
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
      for (let pageNumber = 1; ; pageNumber++) {
        const resp = await withRetry(
          () => {
            counters.apiCalls += 1;
            return getCompanyContacts(co.key, { pageNumber, pageSize: CRM_PAGE });
          },
          { onRetry },
        );
        const items = resp.items ?? [];
        for (const it of items) if (typeof it.key === 'string' && it.key) contactKeys.push(it.key);
        const total = resp.totalCount ?? contactKeys.length;
        if (items.length < CRM_PAGE || contactKeys.length >= total) break;
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
