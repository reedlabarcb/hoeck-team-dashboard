/**
 * RealNex sync-job orphan recovery.
 *
 * Same problem + strategy as the Box walker's orphan recovery (see
 * lib/external/box/orphan-recovery.ts): the sync runs in-process, so a Railway redeploy /
 * crash / restart mid-sync leaves the realnex_sync_jobs row stuck in status='running'.
 *
 * On every boot, mark any row with status='running' AND updated_at < NOW()-10min as
 * 'failed'. The worker writes progress at <=5s cadence, so 10 minutes of silence is
 * unambiguous evidence the worker is gone. Mark-failed-no-resume: a full re-sync is cheap
 * (UPSERT by realnex_key is idempotent), so resume-from-checkpoint isn't earned.
 *
 * Called by: instrumentation.ts (Next.js boot hook), once per server process, alongside
 * the Box orphan-recovery. Separate table => separate scan.
 */

import { and, eq, lt, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { realnexSyncJobs } from '@/lib/db/schema';

const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

export interface RealnexOrphanRecoveryResult {
  marked: number;
  jobIds: string[];
}

export async function markOrphanedRealnexJobsAsFailed(): Promise<RealnexOrphanRecoveryResult> {
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);

  // Two-step so we can log which job IDs were orphaned. The composite index
  // (status, updated_at) makes this fast.
  const stale = await db
    .select({ id: realnexSyncJobs.id })
    .from(realnexSyncJobs)
    .where(and(eq(realnexSyncJobs.status, 'running'), lt(realnexSyncJobs.updatedAt, cutoff)));

  if (stale.length === 0) {
    return { marked: 0, jobIds: [] };
  }

  await db
    .update(realnexSyncJobs)
    .set({
      status: 'failed',
      errorMessage: 'orphaned by process restart',
      completedAt: sql`NOW()`,
      updatedBy: 'orphan_recovery',
    })
    .where(and(eq(realnexSyncJobs.status, 'running'), lt(realnexSyncJobs.updatedAt, cutoff)));

  return { marked: stale.length, jobIds: stale.map((s) => s.id) };
}
