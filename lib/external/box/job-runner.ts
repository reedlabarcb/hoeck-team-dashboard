/**
 * Async background job runner for Box folder-tree walks.
 *
 * Lifecycle:
 *   1. createJob({ userId, triggeredBy, syncMode, isForceFull })
 *      → INSERT box_sync_jobs row, status='queued'.
 *      → Returns the jobId immediately. Caller responds 202 to the user.
 *      → kickOffWalk(jobId, …) is called as a fire-and-forget async function.
 *
 *   2. kickOffWalk(jobId, …)
 *      → Flips status='queued' → 'running', sets started_at.
 *      → Calls walkBoxTree({ jobContext: { … } }) — see walker.ts.
 *      → On finish: status='completed', completed_at, total_folders_in_index.
 *      → On error:  status='failed',    completed_at, error_message.
 *
 *   3. While the walk runs, walker.ts calls `ctx.reportProgress({ folders, files, apiCalls, currentPath })`
 *      on every item. JobContext throttles the UPDATE to at most every PROGRESS_WRITE_INTERVAL_MS.
 *
 * Throttling rationale:
 *   - Walker can emit 100+ items/sec — writing one UPDATE per item would melt the connection pool
 *     (we capped at max:10) and serialize every walker step.
 *   - 5s cadence = ~6 writes/min for a 5-min walk = trivial Postgres load.
 *   - Final write happens unconditionally on walk completion regardless of throttle window.
 */

import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { boxSyncJobs, type BoxSyncJob } from '@/lib/db/schema';
import { logActivity } from '@/lib/activity';

const PROGRESS_WRITE_INTERVAL_MS = 5_000;

export interface JobContext {
  jobId: string;
  walkId: string;
  // Walker calls this on every item. We coalesce writes inside.
  // Phase 2.5a: text-extractor uses the same context shape; its caller
  // populates `textExtraction` and leaves the walker-specific fields at 0.
  reportProgress(update: {
    foldersWalked: number;
    filesIndexed: number;
    apiCalls: number;
    currentPath: string;
    /** Optional — populated only by the text-extraction worker. */
    textExtraction?: {
      processed: number;
      succeeded: number;
      failed: number;
      skipped: number;
    };
  }): Promise<void>;
}

export interface CreateJobInput {
  triggeredBy: string; // user.email or 'cron'
  // Walker-only fields. Ignored for text-extraction jobs (they default to 'full'/false).
  syncMode: 'full' | 'incremental';
  isForceFull: boolean;
  /** Phase 2.5a: which kind of work. Defaults to 'folder_walk' to keep older callers unchanged. */
  jobType?: 'folder_walk' | 'text_extraction';
}

/**
 * Insert a new job row. Returns the row (caller uses .id + .walkId).
 * Caller is responsible for invoking kickOffWalk(...) after responding to the user.
 */
export async function createJob(input: CreateJobInput): Promise<BoxSyncJob> {
  const [row] = await db
    .insert(boxSyncJobs)
    .values({
      status: 'queued',
      syncMode: input.syncMode,
      isForceFull: input.isForceFull,
      jobType: input.jobType ?? 'folder_walk',
      triggeredBy: input.triggeredBy,
      createdBy: 'job_runner',
      updatedBy: 'job_runner',
    })
    .returning();
  return row;
}

/**
 * Find the most recent box_sync_jobs row (any status). Used by GET /api/box/sync/status.
 */
export async function getLatestJob(): Promise<BoxSyncJob | null> {
  const rows = await db
    .select()
    .from(boxSyncJobs)
    .orderBy(sql`${boxSyncJobs.startedAt} DESC`)
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Find any active (queued or running) job. Used by POST /api/box/sync to detect
 * the "already in flight" case and return 409 instead of stacking another walk.
 */
export async function getActiveJob(): Promise<BoxSyncJob | null> {
  const rows = await db
    .select()
    .from(boxSyncJobs)
    .where(sql`${boxSyncJobs.status} IN ('queued', 'running')`)
    .orderBy(sql`${boxSyncJobs.startedAt} DESC`)
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Mark an active job (queued or running) as failed with the given reason.
 * Used by POST /api/box/sync?force=true — admin escape hatch to abandon a stuck job.
 */
export async function markJobFailed(jobId: string, reason: string): Promise<void> {
  await db
    .update(boxSyncJobs)
    .set({
      status: 'failed',
      errorMessage: reason,
      completedAt: sql`NOW()`,
      updatedBy: 'job_runner',
    })
    .where(eq(boxSyncJobs.id, jobId));
}

/**
 * Build a JobContext that walker.ts can call into.
 * The context throttles progress writes; the walker doesn't have to think about it.
 */
function buildContext(jobId: string, walkId: string): JobContext {
  let lastWriteAt = 0;
  return {
    jobId,
    walkId,
    async reportProgress(update) {
      const now = Date.now();
      if (now - lastWriteAt < PROGRESS_WRITE_INTERVAL_MS) return; // throttle
      lastWriteAt = now;
      try {
        // Build the SET clause from whichever fields the caller populated.
        // Walker passes folders/files/apiCalls; text-extractor passes textExtraction.
        const set: Record<string, unknown> = {
          currentPath: update.currentPath,
          updatedBy: 'job_runner',
        };
        // Walker-shape fields — only write when non-zero (text-extractor passes 0s).
        if (update.foldersWalked || update.filesIndexed || update.apiCalls) {
          set.progressFoldersWalked = update.foldersWalked;
          set.progressFilesIndexed = update.filesIndexed;
          set.apiCallsMade = update.apiCalls;
          set.updatedBy = 'walker';
        }
        // Text-extractor-shape fields.
        if (update.textExtraction) {
          set.progressFilesProcessed = update.textExtraction.processed;
          set.progressFilesSucceeded = update.textExtraction.succeeded;
          set.progressFilesFailed = update.textExtraction.failed;
          set.progressFilesSkipped = update.textExtraction.skipped;
          set.updatedBy = 'text_extractor';
        }
        await db.update(boxSyncJobs).set(set).where(eq(boxSyncJobs.id, jobId));
      } catch (err) {
        // Progress writes are best-effort. A transient DB blip shouldn't kill the work.
        console.error(`[job:${jobId}] progress write failed (continuing):`, err);
      }
    },
  };
}

/**
 * Mark queued → running and stamp started_at. Called once per walk, at kickoff.
 */
async function markJobRunning(jobId: string): Promise<void> {
  await db
    .update(boxSyncJobs)
    .set({
      status: 'running',
      startedAt: sql`NOW()`,
      updatedBy: 'job_runner',
    })
    .where(eq(boxSyncJobs.id, jobId));
}

interface FinishJobInput {
  jobId: string;
  totalIndexed: number;
}

/**
 * Final write after a successful walk.
 */
async function markJobCompleted(input: FinishJobInput): Promise<void> {
  // Best-effort count of total rows now in box_folder_index (for trending UX).
  let totalInIndex: number | undefined;
  try {
    const [{ count }] = (await db.execute(
      sql`SELECT count(*)::int AS count FROM box_folder_index WHERE deleted_at IS NULL`,
    )).rows as unknown as { count: number }[];
    totalInIndex = count;
  } catch {
    totalInIndex = undefined;
  }

  await db
    .update(boxSyncJobs)
    .set({
      status: 'completed',
      completedAt: sql`NOW()`,
      progressFilesIndexed: input.totalIndexed,
      totalFoldersInIndex: totalInIndex ?? null,
      currentPath: null,
      updatedBy: 'job_runner',
    })
    .where(eq(boxSyncJobs.id, input.jobId));
}

/**
 * Final write after a failed walk.
 */
async function markJobFailedInternal(jobId: string, err: unknown): Promise<void> {
  const msg = err instanceof Error ? err.message : String(err);
  await db
    .update(boxSyncJobs)
    .set({
      status: 'failed',
      completedAt: sql`NOW()`,
      errorMessage: msg.slice(0, 4000), // keep DB payload sane on huge stack traces
      updatedBy: 'job_runner',
    })
    .where(eq(boxSyncJobs.id, jobId));
}

/**
 * For incremental sync: find the started_at of the most recent successfully-completed
 * full walk. Subfolders whose box modified_at predates this are not recursed into.
 *
 * Returns null if no full has ever completed — caller should fall back to a full walk.
 */
export async function getLastFullWalkStartedAt(): Promise<Date | null> {
  const result = await db.execute(sql`
    SELECT started_at FROM box_sync_jobs
    WHERE status = 'completed' AND sync_mode = 'full' AND deleted_at IS NULL
    ORDER BY completed_at DESC NULLS LAST
    LIMIT 1
  `);
  const row = result.rows[0] as unknown as { started_at: string } | undefined;
  if (!row) return null;
  return new Date(row.started_at);
}

/**
 * Run the walk for an existing queued job.
 *
 * IMPORTANT: this is meant to be invoked fire-and-forget from the POST handler:
 *
 *   const job = await createJob({...});
 *   void kickOffWalk({ jobId: job.id, walkId: job.walkId, userId, rootFolderId });
 *   return NextResponse.json({ jobId: job.id }, { status: 202 });
 *
 * The function's lifetime exceeds the HTTP request. Node.js keeps the process alive
 * because the promise is pending. If the process dies, orphan recovery handles cleanup.
 */
export async function kickOffWalk(opts: {
  jobId: string;
  walkId: string;
  userId: string;
  rootFolderId: string;
  /** Job's sync_mode — drives whether we pass incrementalSince. */
  syncMode: 'full' | 'incremental';
}): Promise<void> {
  const { jobId, walkId, userId, rootFolderId, syncMode } = opts;
  const ctx = buildContext(jobId, walkId);

  try {
    await markJobRunning(jobId);

    // Resolve incrementalSince when caller asked for an incremental walk. If no full has
    // completed yet, silently upgrade to a full (and log so it's visible in audit).
    let incrementalSince: Date | undefined;
    let effectiveMode: 'full' | 'incremental' = syncMode;
    if (syncMode === 'incremental') {
      const lastFullStartedAt = await getLastFullWalkStartedAt();
      if (lastFullStartedAt) {
        incrementalSince = lastFullStartedAt;
      } else {
        console.log(
          `[job:${jobId}] incremental requested but no prior full walk found — upgrading to full`,
        );
        effectiveMode = 'full';
        // Reflect the actual mode in the DB row.
        await db
          .update(boxSyncJobs)
          .set({ syncMode: 'full', updatedBy: 'job_runner' })
          .where(eq(boxSyncJobs.id, jobId));
      }
    }

    console.log(
      `[job:${jobId}] running walkId=${walkId} userId=${userId} mode=${effectiveMode}` +
        (incrementalSince ? ` incrementalSince=${incrementalSince.toISOString()}` : ''),
    );

    // Lazy import to avoid circular dep (walker.ts may import this file in the future).
    const { walkBoxTree } = await import('./walker');
    const result = await walkBoxTree({
      userId,
      rootFolderId,
      jobContext: ctx,
      incrementalSince,
    });
    await markJobCompleted({ jobId, totalIndexed: result.indexedCount });

    await logActivity({
      actorUserId: userId,
      action: 'box.sync.completed',
      entityType: 'box_sync_job',
      entityId: jobId,
      payload: {
        walkId,
        indexedCount: result.indexedCount,
        durationMs: result.durationMs,
        rootFolderName: result.rootFolderName,
      },
      status: 'ok',
    });

    console.log(
      `[job:${jobId}] done walkId=${walkId} indexed=${result.indexedCount} duration=${result.durationMs}ms`,
    );
  } catch (err) {
    console.error(`[job:${jobId}] FAILED walkId=${walkId}:`, err);
    await markJobFailedInternal(jobId, err);
    await logActivity({
      actorUserId: userId,
      action: 'box.sync.failed',
      entityType: 'box_sync_job',
      entityId: jobId,
      payload: { walkId, reason: err instanceof Error ? err.message : 'unknown' },
      status: 'error',
    });
  }
}

// ============================================================================
// Phase 2.5a — text-extraction job
// ============================================================================

/**
 * Final write after a successful text-extraction run. Persists the four totals
 * one more time (in case the throttler skipped the very last batch) and stamps
 * status='completed'. Mirrors markJobCompleted's role for the walker.
 */
async function markTextExtractionCompleted(input: {
  jobId: string;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
}): Promise<void> {
  await db
    .update(boxSyncJobs)
    .set({
      status: 'completed',
      completedAt: sql`NOW()`,
      progressFilesProcessed: input.processed,
      progressFilesSucceeded: input.succeeded,
      progressFilesFailed: input.failed,
      progressFilesSkipped: input.skipped,
      currentPath: null,
      updatedBy: 'job_runner',
    })
    .where(eq(boxSyncJobs.id, input.jobId));
}

/**
 * Fire-and-forget kickoff for a text-extraction job. Mirrors kickOffWalk's
 * lifecycle: queued → running → completed/failed; orphan-recovery catches
 * mid-run process death via the shared `status='running' AND stale` query.
 *
 * Call AFTER createJob({ jobType: 'text_extraction', ... }) has returned a row.
 *
 *   const job = await createJob({ jobType: 'text_extraction', ... });
 *   void kickOffTextExtraction({ jobId: job.id, walkId: job.walkId, userId });
 *   return NextResponse.json({ jobId: job.id }, { status: 202 });
 */
export async function kickOffTextExtraction(opts: {
  jobId: string;
  walkId: string;
  userId: string;
  /** Optional override of the per-run cap. Production uses default (10k). */
  maxItems?: number;
}): Promise<void> {
  const { jobId, walkId, userId, maxItems } = opts;
  const ctx = buildContext(jobId, walkId);

  try {
    await markJobRunning(jobId);
    console.log(`[job:${jobId}] running text_extraction walkId=${walkId} userId=${userId}`);

    // Lazy import to avoid pulling text-extractor.ts (and its child_process import)
    // into routes that don't need it.
    const { runTextExtraction } = await import('./text-extractor');
    const result = await runTextExtraction({ userId, jobContext: ctx, maxItems });
    await markTextExtractionCompleted({
      jobId,
      processed: result.processed,
      succeeded: result.succeeded,
      failed: result.failed,
      skipped: result.skipped,
    });

    await logActivity({
      actorUserId: userId,
      action: 'box.text_extraction.completed',
      entityType: 'box_sync_job',
      entityId: jobId,
      payload: {
        walkId,
        processed: result.processed,
        succeeded: result.succeeded,
        failed: result.failed,
        skipped: result.skipped,
        durationMs: result.durationMs,
      },
      status: 'ok',
    });

    console.log(
      `[job:${jobId}] done text_extraction walkId=${walkId} processed=${result.processed} succeeded=${result.succeeded} failed=${result.failed} skipped=${result.skipped} duration=${result.durationMs}ms`,
    );
  } catch (err) {
    console.error(`[job:${jobId}] FAILED text_extraction walkId=${walkId}:`, err);
    await markJobFailedInternal(jobId, err);
    await logActivity({
      actorUserId: userId,
      action: 'box.text_extraction.failed',
      entityType: 'box_sync_job',
      entityId: jobId,
      payload: { walkId, reason: err instanceof Error ? err.message : 'unknown' },
      status: 'error',
    });
  }
}
