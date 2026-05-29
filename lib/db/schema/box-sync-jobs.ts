/**
 * box_sync_jobs — async background-job state for Box folder-tree walks.
 *
 * Architecture (locked 2026-05-26):
 *   - In-process worker (same Next.js runtime as the web routes)
 *   - Postgres-backed state (this table) — no Redis, no BullMQ
 *   - Orphan recovery: on app startup, any row with status='running'
 *     and updated_at < NOW() - INTERVAL '10 min' is marked failed
 *     ('orphaned by process restart'). No resume-from-checkpoint.
 *   - Progress writes batched at 5s cadence (in-memory counters update
 *     on every item; UPDATE box_sync_jobs only when 5s elapsed since last write).
 *
 * Sync modes:
 *   - 'full'        — walk the entire tree from root, upsert everything.
 *   - 'incremental' — walk the tree but skip subtrees where the folder's
 *                     modified_at is older than the last full sync's started_at.
 *                     Catches additions and modifications; misses deletions
 *                     (caught by the weekly full walk).
 *
 * delta_cursor reserved for a future Events-API implementation. Always
 * null in v1 (modified_at-filter path) — the column exists so we can wire
 * Events API later without a migration.
 *
 * Triggered by:
 *   - User clicking "Refresh from Box" on /files  → triggered_by = user.email
 *   - Daily Railway cron 4am Pacific              → triggered_by = 'cron'
 *
 * Linked to: box_folder_index.last_walk_run_id == box_sync_jobs.walk_id
 * for any items touched by this walk.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  index,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const boxSyncJobStatusEnum = pgEnum('box_sync_job_status', [
  'queued',
  'running',
  'completed',
  'failed',
]);

export const boxSyncJobModeEnum = pgEnum('box_sync_job_mode', ['full', 'incremental']);

export const boxSyncJobs = pgTable(
  'box_sync_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Correlates with box_folder_index.last_walk_run_id for rows touched by this walk.
    walkId: uuid('walk_id').notNull().defaultRandom(),

    // Lifecycle
    status: boxSyncJobStatusEnum('status').notNull().default('queued'),
    syncMode: boxSyncJobModeEnum('sync_mode').notNull().default('full'),
    // True when triggered via ?force=true or ?mode=full (helps debug surprise walks).
    isForceFull: boolean('is_force_full').notNull().default(false),

    // Timing
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),

    // Live progress (written by walker at ≤5s cadence)
    progressFoldersWalked: integer('progress_folders_walked').notNull().default(0),
    progressFilesIndexed: integer('progress_files_indexed').notNull().default(0),
    apiCallsMade: integer('api_calls_made').notNull().default(0),
    currentPath: text('current_path'),

    // Completion summary
    totalFoldersInIndex: integer('total_folders_in_index'),

    // Failure detail
    errorMessage: text('error_message'),

    // Audit / debug
    triggeredBy: text('triggered_by').notNull(),
    // Reserved for future Events API cursor; null in v1.
    deltaCursor: text('delta_cursor'),
    // Escape hatch for fields we don't anticipate yet.
    metadata: jsonb('metadata').notNull().default({}),

    // Standard housekeeping
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    version: integer('version').notNull().default(1),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: text('created_by').notNull().default(sql`'box_walker'`),
    updatedBy: text('updated_by').notNull().default(sql`'box_walker'`),
  },
  (table) => [
    // Composite index for orphan recovery query:
    //   SELECT * FROM box_sync_jobs
    //   WHERE status = 'running' AND updated_at < NOW() - INTERVAL '10 minutes'
    // Lets the startup hook run sub-millisecond even at scale.
    index('box_sync_jobs_status_updated_at_idx').on(table.status, table.updatedAt),
    // For "what's the latest job?" / "current status" queries.
    index('box_sync_jobs_started_at_idx').on(table.startedAt),
    // For "is there an active job right now?" — fast filter to queued+running.
    index('box_sync_jobs_status_idx').on(table.status),
  ],
);

export type BoxSyncJob = typeof boxSyncJobs.$inferSelect;
export type NewBoxSyncJob = typeof boxSyncJobs.$inferInsert;
