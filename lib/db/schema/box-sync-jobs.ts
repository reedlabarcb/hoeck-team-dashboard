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

// Phase 2.5a: what kind of work this job represents.
// 'folder_walk'     — the Box folder-tree BFS walker (Phase 2's original purpose)
// 'text_extraction' — the PDF text-extraction worker (Phase 2.5a)
// Existing rows are backfilled to 'folder_walk' by migration 0005.
export const boxSyncJobTypeEnum = pgEnum('box_sync_job_type', [
  'folder_walk',
  'text_extraction',
]);

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
    // Phase 2.5a: type of work this job represents. Default 'folder_walk' keeps
    // existing walker code paths unchanged. Text-extraction worker writes 'text_extraction'.
    jobType: boxSyncJobTypeEnum('job_type').notNull().default('folder_walk'),

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

    // Phase 2.5a: live progress for text_extraction jobs (written at ≤5s cadence,
    // same throttling pattern as the walker fields above). Always 0 / null for
    // folder_walk jobs — the column union exists because both job kinds share
    // this table per the "one job_runner, one orphan_recovery" architecture.
    //   processed = succeeded + failed + skipped (running total)
    //   succeeded = pdf_extract_text.py returned status='ok' AND we wrote extracted_text
    //   failed    = pdf_extract_text.py returned status='error' OR the subprocess crashed
    //   skipped   = status='scanned' or 'too_large' — not an error, just not indexed
    progressFilesProcessed: integer('progress_files_processed').notNull().default(0),
    progressFilesSucceeded: integer('progress_files_succeeded').notNull().default(0),
    progressFilesFailed: integer('progress_files_failed').notNull().default(0),
    progressFilesSkipped: integer('progress_files_skipped').notNull().default(0),

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
    // Phase 2.5a: speed up "latest job of this type" queries used by
    // GET /api/box/sync/status (folder_walk) and GET /api/box/extract-text/status.
    index('box_sync_jobs_job_type_started_at_idx').on(table.jobType, table.startedAt),
  ],
);

export type BoxSyncJob = typeof boxSyncJobs.$inferSelect;
export type NewBoxSyncJob = typeof boxSyncJobs.$inferInsert;
