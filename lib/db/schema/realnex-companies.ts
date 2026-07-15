/**
 * realnex_companies - read-only MIRROR of RealNex CRM companies (Phase 3).
 *
 * Source of truth is RealNex; this table is a queryable local copy refreshed by the
 * nightly sync (lib/external/realnex/sync.ts). UPSERT by realnex_key. The dashboard
 * READS from this mirror; create-only writes go live to RealNex then re-sync the record.
 *
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 * !! GOTCHA: the COMPANY NAME comes from RealNex's `OrganizationId` field.          !!
 * !! RealNex's OData CompanyListItem has NO `Name` property. The field LITERALLY    !!
 * !! NAMED `OrganizationId` (typed String, not Guid) HOLDS THE COMPANY NAME         !!
 * !! ("Full Swing Golf", "Burns & McDonnell", "Whitney Skala, APC", ...). On the    !!
 * !! create side the same value is the `organization` field. `$select=Name` returns !!
 * !! HTTP 400 because no Name property exists. So: company_name <- OrganizationId.   !!
 * !! Do NOT "fix" this thinking it's a bug or an ID. See docs/RealNex_API_Discovery. !!
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 *
 * NO optimistic-locking `version` column: RealNex is the source of truth for mirrored
 * data, so sync overwrites freely. (Optimistic locking applies only to dashboard-native
 * data like notes/tags, a later phase.)
 *
 * Lease Expiration / Space Size ARE columns here now (`lease_expiry`, `sq_ft`) — populated by the
 * per-record /full DETAILS WALK (P3.6); see those columns below. (Historically they were absent from
 * the /CrmOData list feed and Workflow 4 was going to source them from the Master Excel — that plan
 * is OBSOLETE; they're mirrored directly. `company_name_normalized` remains a best-effort Master-Excel
 * join key for OTHER Excel data, not for LXD/SF.)
 */

import { pgTable, uuid, text, boolean, jsonb, timestamp, integer, date, index, uniqueIndex } from 'drizzle-orm/pg-core';

export const realnexCompanies = pgTable(
  'realnex_companies',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // RealNex identity
    realnexKey: text('realnex_key').notNull(), // CompanyListItem.Key (GUID string)

    // Company NAME <- RealNex `OrganizationId` (see gotcha banner above).
    // NULLABLE ON PURPOSE: some RealNex companies have a blank OrganizationId (CRM
    // data-entry gaps). A NOT NULL here would crash the sync on those rows, so we keep
    // it nullable - the sync STORES null-name companies (UI flags them via
    // `company_name IS NULL`) instead of dropping or failing on them.
    companyName: text('company_name'),
    // Lowercased/trimmed company name - the JOIN KEY to the Master Excel client list
    // (W4 lease/SF). Indexed. Likewise nullable (null when company_name is null).
    //
    // BEST-EFFORT, NOT GUARANTEED: this is the join ATTEMPT, not a promise of a match.
    // RealNex's OrganizationId ("Procopio") often will NOT exactly equal the Master
    // Excel client name ("Procopio, Cory, Hargreaves & Savitch") even after
    // normalization. Exact-match-after-cleanup hits some rows and misses others.
    // Resolving the misses (fuzzy match or a manual mapping table) is a Workflow 4
    // problem for later - do NOT assume a clean 1:1 join off this column.
    companyNameNormalized: text('company_name_normalized'),
    subsidiaryId: text('subsidiary_id'),

    // Classification flags (RealNex booleans)
    investor: boolean('investor'),
    tenant: boolean('tenant'),
    agent: boolean('agent'),
    vendor: boolean('vendor'),
    personal: boolean('personal'),
    prospect: boolean('prospect'),

    // Contact info
    phone: text('phone'),
    fax: text('fax'),
    email: text('email'),
    website: text('website'),
    doNotCall: boolean('do_not_call'),
    doNotEmail: boolean('do_not_email'),
    doNotFax: boolean('do_not_fax'),
    doNotMail: boolean('do_not_mail'),

    // Address: full nested object as jsonb + city/state flattened for filtering/display.
    address: jsonb('address').$type<Record<string, unknown>>(),
    city: text('city'),
    state: text('state'),

    // Lease/space attributes — populated by the per-record /full DETAILS WALK (P3.6), NOT the
    // /CrmOData/ list feed (which omits them). Sources on /Crm/company/{key}/full:
    //   lease_expiry <- details.userDataFields.userDate1  (VERIFIED = Lease Expiration 2026-07-13:
    //                   100% match vs contacts' named leaseExpiry on a 35-company spread sample)
    //   sq_ft        <- details.currentSf
    // Nullable on purpose: only ~30-50% of companies have them. See docs +
    // reference_realnex_lxd_sf_custom_fields. Display-only; RealNex stays source of truth.
    leaseExpiry: date('lease_expiry'),
    sqFt: integer('sq_ft'),

    // ObjectGroups (the RealNex "Group" memberships) as jsonb; groups are also mirrored
    // in realnex_groups for the Workflow-2 dropdown.
    objectGroups: jsonb('object_groups').$type<unknown[]>().default([]),

    // LastActivity (a History object) - kept raw + an extracted timestamp for sorting.
    lastActivity: jsonb('last_activity').$type<Record<string, unknown>>(),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),

    userKey: text('user_key'),
    teamKey: text('team_key'),

    // Full OData record verbatim - never lose a field the columns don't capture.
    raw: jsonb('raw').$type<Record<string, unknown>>(),

    // Sync bookkeeping
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }).notNull().defaultNow(),
    lastSyncRunId: uuid('last_sync_run_id'), // -> realnex_sync_jobs.id

    // Housekeeping (NO version column - RealNex is source of truth)
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: text('created_by').notNull().default('realnex_sync'),
    updatedBy: text('updated_by').notNull().default('realnex_sync'),
  },
  (t) => [
    uniqueIndex('realnex_companies_key_unique').on(t.realnexKey),
    index('realnex_companies_name_norm_idx').on(t.companyNameNormalized), // Master-Excel join
    index('realnex_companies_tenant_idx').on(t.tenant),
    index('realnex_companies_prospect_idx').on(t.prospect),
    index('realnex_companies_deleted_idx').on(t.deletedAt),
  ],
);

export type RealnexCompanyRow = typeof realnexCompanies.$inferSelect;
export type NewRealnexCompanyRow = typeof realnexCompanies.$inferInsert;
