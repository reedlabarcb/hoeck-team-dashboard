/**
 * realnex_sync_jobs - async job state for the RealNex -> Postgres mirror sync (Phase 3).
 *
 * Mirrors the box_sync_jobs pattern (in-process worker, Postgres-backed state, orphan
 * recovery on stale 'running' rows via the shared instrumentation hook). Separate table
 * from box_sync_jobs because the progress shape differs (companies/contacts/groups/links
 * vs folders/files).
 *
 * Sync phases (current_phase): 'companies' (OData page) -> 'contacts' (OData page) ->
 * 'groups' (listGroups) -> 'linking' (the inversion walk: GET company/{key}/contacts for
 * every company, to materialize realnex_contacts.company_key). The linking phase is the
 * expensive one (~1 call per company, ~1,275).
 *
 * This table DOES carry a `version` column (like box_sync_jobs) - that's the job row's own
 * optimistic-lock for concurrent status updates; it is unrelated to the "no optimistic
 * locking on the MIRROR" rule (which is about realnex_companies/contacts/groups).
 */

import { pgTable, uuid, text, integer, timestamp, jsonb, index, pgEnum } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const realnexSyncJobStatusEnum = pgEnum('realnex_sync_job_status', [
  'queued',
  'running',
  'completed',
  'failed',
]);

export const realnexSyncJobs = pgTable(
  'realnex_sync_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    status: realnexSyncJobStatusEnum('status').notNull().default('queued'),

    // Timing
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),

    // Live progress (written at <=5s cadence, same throttle as the box walker)
    currentPhase: text('current_phase'), // companies | contacts | groups | linking
    companiesSynced: integer('companies_synced').notNull().default(0),
    contactsSynced: integer('contacts_synced').notNull().default(0),
    groupsSynced: integer('groups_synced').notNull().default(0),
    linksResolved: integer('links_resolved').notNull().default(0),
    apiCallsMade: integer('api_calls_made').notNull().default(0),

    // Totals from OData $count (so the UI can show "N of M")
    totalCompanies: integer('total_companies'),
    totalContacts: integer('total_contacts'),

    errorMessage: text('error_message'),
    triggeredBy: text('triggered_by').notNull(), // user.email or 'cron'
    metadata: jsonb('metadata').notNull().default({}),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    version: integer('version').notNull().default(1),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: text('created_by').notNull().default('realnex_sync'),
    updatedBy: text('updated_by').notNull().default('realnex_sync'),
  },
  (t) => [
    // Orphan-recovery scan: status='running' AND updated_at < now()-10min
    index('realnex_sync_jobs_status_updated_at_idx').on(t.status, t.updatedAt),
    index('realnex_sync_jobs_started_at_idx').on(t.startedAt),
    index('realnex_sync_jobs_status_idx').on(t.status),
  ],
);

// CHECK (triggered_by <> '') is added in the hand-finished migration (matches box_sync_jobs).
export const REALNEX_SYNC_JOBS_TRIGGERED_BY_CHECK = sql`triggered_by <> ''`;

export type RealnexSyncJobRow = typeof realnexSyncJobs.$inferSelect;
export type NewRealnexSyncJobRow = typeof realnexSyncJobs.$inferInsert;
