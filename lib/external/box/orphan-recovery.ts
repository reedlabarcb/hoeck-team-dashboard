/**
 * Box sync job orphan recovery.
 *
 * Background:
 *   The walker runs in-process. If the Next.js process dies mid-walk (Railway redeploy,
 *   OOM, crash, manual restart), the `box_sync_jobs` row stays in `status='running'`
 *   forever — there's no one alive to update it.
 *
 * Strategy (decided 2026-05-27): mark-failed-no-resume.
 *   On every app boot, find any row where:
 *     status = 'running'
 *     AND updated_at < NOW() - INTERVAL '10 minutes'
 *   ... and set them to status='failed' with error_message explaining what happened.
 *
 *   Walker writes progress at <=5s cadence, so 10 minutes of silence is unambiguous
 *   evidence the worker is gone.
 *
 *   No resume-from-checkpoint: the walker is fast enough that retry is cheap, and the
 *   resume complexity isn't earned for a 3-4 user app.
 *
 * Called by: instrumentation.ts (Next.js boot hook), exactly once per server process.
 */

import { and, eq, lt, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { boxSyncJobs } from '@/lib/db/schema';

const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

export interface OrphanRecoveryResult {
  marked: number;
  jobIds: string[];
  /** Phase 2.5a: breakdown by job_type so the boot log surfaces walker vs text-extractor orphans. */
  byType: Record<string, number>;
}

export async function markOrphanedJobsAsFailed(): Promise<OrphanRecoveryResult> {
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);

  // Two-step so we can log which job IDs were orphaned (useful for post-mortem).
  // The composite index (status, updated_at) makes this fast. The query is
  // job_type-agnostic on purpose — Phase 2.5a's text_extraction jobs inherit
  // the same recovery semantics as Phase 2's folder_walk jobs.
  const stale = await db
    .select({ id: boxSyncJobs.id, jobType: boxSyncJobs.jobType })
    .from(boxSyncJobs)
    .where(and(eq(boxSyncJobs.status, 'running'), lt(boxSyncJobs.updatedAt, cutoff)));

  if (stale.length === 0) {
    return { marked: 0, jobIds: [], byType: {} };
  }

  await db
    .update(boxSyncJobs)
    .set({
      status: 'failed',
      errorMessage: 'orphaned by process restart',
      completedAt: sql`NOW()`,
      updatedBy: 'orphan_recovery',
    })
    .where(and(eq(boxSyncJobs.status, 'running'), lt(boxSyncJobs.updatedAt, cutoff)));

  const byType: Record<string, number> = {};
  for (const s of stale) {
    byType[s.jobType] = (byType[s.jobType] ?? 0) + 1;
  }

  return { marked: stale.length, jobIds: stale.map((s) => s.id), byType };
}
