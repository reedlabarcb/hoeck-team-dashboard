/**
 * realnex_contacts - read-only MIRROR of RealNex CRM contacts (Phase 3).
 *
 * Source of truth is RealNex; refreshed by the nightly sync, UPSERT by realnex_key.
 *
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 * !! CONTACT -> COMPANY LINK is MATERIALIZED, not native.                            !!
 * !! RealNex does NOT expose a contact's company on contact reads: ContactListItem   !!
 * !! and contact/{key}/full have NO company field/navigation. The link only exists   !!
 * !! (a) at create time (CreateContact.companyKey), and (b) read-side by INVERSION - !!
 * !! walking every company's `GET /api/v1/Crm/company/{key}/contacts`. The sync's     !!
 * !! "linking" phase performs that inversion and writes `company_key` (+ a denormal-  !!
 * !! ized `company_name` for convenient W4 export) here. A contact with no resolved   !!
 * !! company has company_key = NULL.                                                  !!
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 *
 * NO optimistic-locking `version` column - RealNex is source of truth.
 */

import { pgTable, uuid, text, boolean, jsonb, timestamp, integer, date, index, uniqueIndex } from 'drizzle-orm/pg-core';

export const realnexContacts = pgTable(
  'realnex_contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    realnexKey: text('realnex_key').notNull(), // ContactListItem.Key (GUID string)

    // MATERIALIZED company link (see banner). company_key is the parent company's
    // RealNex Key, resolved by the inversion walk; company_name denormalized from the
    // parent (its OrganizationId) so W4 export needs no extra join for the name.
    companyKey: text('company_key'),
    companyName: text('company_name'),
    // join key to Master Excel - BEST-EFFORT only: the normalized name may not exactly
    // match the Excel client name even after cleanup (see realnex-companies.ts for the
    // full caveat). W4 resolves the misses; do NOT assume a clean 1:1 join here.
    companyNameNormalized: text('company_name_normalized'),

    // Name
    fullName: text('full_name'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    salutation: text('salutation'),
    greeting: text('greeting'),
    title: text('title'),

    // Classification flags
    investor: boolean('investor'),
    tenant: boolean('tenant'),
    agent: boolean('agent'),
    vendor: boolean('vendor'),
    personal: boolean('personal'),
    prospect: boolean('prospect'),

    // Contact info
    work: text('work'),
    fax: text('fax'),
    mobile: text('mobile'),
    home: text('home'),
    email: text('email'),
    website: text('website'),
    doNotCall: boolean('do_not_call'),
    doNotEmail: boolean('do_not_email'),
    doNotFax: boolean('do_not_fax'),
    doNotMail: boolean('do_not_mail'),

    address: jsonb('address').$type<Record<string, unknown>>(),
    mailingAddress: jsonb('mailing_address').$type<Record<string, unknown>>(),

    // Lease/space attributes — populated by the per-record /full DETAILS WALK (P3.6), NOT the
    // /CrmOData/ list feed. Sources on /Crm/contact/{key}/full (named, reliable fields):
    //   lease_expiry <- tenantData.space.leaseExpiry
    //   sq_ft        <- tenantData.space.sqFt
    // Nullable: only ~30% of contacts have a space. See reference_realnex_lxd_sf_custom_fields.
    leaseExpiry: date('lease_expiry'),
    sqFt: integer('sq_ft'),

    objectGroups: jsonb('object_groups').$type<unknown[]>().default([]),

    lastActivity: jsonb('last_activity').$type<Record<string, unknown>>(),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),

    userKey: text('user_key'),
    teamKey: text('team_key'),

    raw: jsonb('raw').$type<Record<string, unknown>>(),

    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }).notNull().defaultNow(),
    lastSyncRunId: uuid('last_sync_run_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: text('created_by').notNull().default('realnex_sync'),
    updatedBy: text('updated_by').notNull().default('realnex_sync'),
  },
  (t) => [
    uniqueIndex('realnex_contacts_key_unique').on(t.realnexKey),
    index('realnex_contacts_company_key_idx').on(t.companyKey), // the materialized link
    index('realnex_contacts_company_norm_idx').on(t.companyNameNormalized),
    index('realnex_contacts_email_idx').on(t.email),
    index('realnex_contacts_tenant_idx').on(t.tenant),
    index('realnex_contacts_prospect_idx').on(t.prospect),
    index('realnex_contacts_deleted_idx').on(t.deletedAt),
  ],
);

export type RealnexContactRow = typeof realnexContacts.$inferSelect;
export type NewRealnexContactRow = typeof realnexContacts.$inferInsert;
