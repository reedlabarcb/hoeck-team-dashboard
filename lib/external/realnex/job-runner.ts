/**
 * Async background job runner for the RealNex -> Postgres mirror sync (P3.4).
 *
 * Mirrors lib/external/box/job-runner.ts:
 *   1. createJob({ triggeredBy })  -> INSERT realnex_sync_jobs (status='queued'), returns row.
 *      Caller responds 202 and then fire-and-forgets kickOffRealnexSync(jobId).
 *   2. kickOffRealnexSync(jobId)   -> queued->running, runs runRealnexSync(ctx) (see ./sync),
 *      then completed (with final counts + metadata) or failed (error_message).
 *   3. During the run, ./sync calls ctx.reportProgress(...) frequently; JobContext throttles
 *      the UPDATE to at most every PROGRESS_WRITE_INTERVAL_MS.
 *
 * READ-ONLY: this drives reads from RealNex + writes to OUR Postgres mirror only. No writes
 * to RealNex (the safe wrapper exposes none).
 */

import { eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { realnexSyncJobs, type RealnexSyncJobRow } from '@/lib/db/schema';
import { logActivity } from '@/lib/activity';
import { resolveConcurrency } from './retry';

const PROGRESS_WRITE_INTERVAL_MS = 5_000;

/** Progress snapshot the sync worker pushes; JobContext coalesces writes. */
export interface RealnexProgress {
  phase: 'companies' | 'contacts' | 'groups' | 'linking';
  companiesSynced: number;
  contactsSynced: number;
  groupsSynced: number;
  linksResolved: number;
  apiCalls: number;
  rateLimitHits: number;
  totalCompanies: number | null;
  totalContacts: number | null;
}

/** What ./sync is handed. It never touches realnex_sync_jobs directly — only through this. */
export interface RealnexJobContext {
  jobId: string;
  reportProgress(p: RealnexProgress): Promise<void>;
}

/** Final result the sync returns; persisted by markJobCompleted. */
export interface RealnexSyncResult {
  companiesSynced: number;
  contactsSynced: number;
  groupsSynced: number;
  linksResolved: number;
  apiCalls: number;
  rateLimitHits: number;
  skippedCompanyKeys: string[];
  durationMs: number;
}

/** INSERT a queued job row. Caller invokes kickOffRealnexSync(row.id) after responding. */
export async function createJob(input: { triggeredBy: string }): Promise<RealnexSyncJobRow> {
  const [row] = await db
    .insert(realnexSyncJobs)
    .values({
      status: 'queued',
      triggeredBy: input.triggeredBy,
      createdBy: 'realnex_job_runner',
      updatedBy: 'realnex_job_runner',
    })
    .returning();
  return row;
}

/** Most recent job (any status). Used by GET /api/realnex/sync/status. */
export async function getLatestJob(): Promise<RealnexSyncJobRow | null> {
  const rows = await db
    .select()
    .from(realnexSyncJobs)
    .where(isNull(realnexSyncJobs.deletedAt))
    .orderBy(sql`${realnexSyncJobs.createdAt} DESC`)
    .limit(1);
  return rows[0] ?? null;
}

/** Any active (queued or running) job. Used by POST /api/realnex/sync for the 409 guard. */
export async function getActiveJob(): Promise<RealnexSyncJobRow | null> {
  const rows = await db
    .select()
    .from(realnexSyncJobs)
    .where(sql`${realnexSyncJobs.status} IN ('queued', 'running')`)
    .orderBy(sql`${realnexSyncJobs.createdAt} DESC`)
    .limit(1);
  return rows[0] ?? null;
}

/** Force-fail an active job. Used by POST /api/realnex/sync?force=true (admin escape hatch). */
export async function markJobFailed(jobId: string, reason: string): Promise<void> {
  await db
    .update(realnexSyncJobs)
    .set({ status: 'failed', errorMessage: reason, completedAt: sql`NOW()`, updatedBy: 'realnex_job_runner' })
    .where(eq(realnexSyncJobs.id, jobId));
}

/**
 * Shape a realnex_sync_jobs row for the sync API + status polling. Shared by both routes
 * (route.ts GET + status/route.ts) — kept here (not in a route file) because Next.js route
 * modules may only export HTTP handlers + config.
 */
export function serializeRealnexJob(j: RealnexSyncJobRow) {
  return {
    id: j.id,
    status: j.status,
    currentPhase: j.currentPhase,
    companiesSynced: j.companiesSynced,
    contactsSynced: j.contactsSynced,
    groupsSynced: j.groupsSynced,
    linksResolved: j.linksResolved,
    apiCallsMade: j.apiCallsMade,
    rateLimitHits: j.rateLimitHits,
    totalCompanies: j.totalCompanies,
    totalContacts: j.totalContacts,
    startedAt: j.startedAt.toISOString(),
    completedAt: j.completedAt ? j.completedAt.toISOString() : null,
    errorMessage: j.errorMessage,
    triggeredBy: j.triggeredBy,
    metadata: j.metadata,
  };
}

/** Throttled progress context handed to the sync worker. */
function buildContext(jobId: string): RealnexJobContext {
  let lastWriteAt = 0;
  return {
    jobId,
    async reportProgress(p) {
      const now = Date.now();
      if (now - lastWriteAt < PROGRESS_WRITE_INTERVAL_MS) return; // throttle
      lastWriteAt = now;
      try {
        await db
          .update(realnexSyncJobs)
          .set({
            currentPhase: p.phase,
            companiesSynced: p.companiesSynced,
            contactsSynced: p.contactsSynced,
            groupsSynced: p.groupsSynced,
            linksResolved: p.linksResolved,
            apiCallsMade: p.apiCalls,
            rateLimitHits: p.rateLimitHits,
            totalCompanies: p.totalCompanies,
            totalContacts: p.totalContacts,
            updatedAt: sql`NOW()`,
            updatedBy: 'realnex_sync',
          })
          .where(eq(realnexSyncJobs.id, jobId));
      } catch (err) {
        // Progress writes are best-effort; a transient DB blip must not kill the sync.
        console.error(`[realnex-job:${jobId}] progress write failed (continuing):`, err);
      }
    },
  };
}

async function markJobRunning(jobId: string): Promise<void> {
  await db
    .update(realnexSyncJobs)
    .set({ status: 'running', startedAt: sql`NOW()`, updatedBy: 'realnex_job_runner' })
    .where(eq(realnexSyncJobs.id, jobId));
}

/** Unconditional final write on success (persists final counts + metadata, ignores throttle). */
async function markJobCompleted(jobId: string, r: RealnexSyncResult, rebuildLinks: boolean): Promise<void> {
  await db
    .update(realnexSyncJobs)
    .set({
      status: 'completed',
      completedAt: sql`NOW()`,
      currentPhase: null,
      companiesSynced: r.companiesSynced,
      contactsSynced: r.contactsSynced,
      groupsSynced: r.groupsSynced,
      linksResolved: r.linksResolved,
      apiCallsMade: r.apiCalls,
      rateLimitHits: r.rateLimitHits,
      totalCompanies: r.companiesSynced,
      totalContacts: r.contactsSynced,
      // log-and-skip failures are recorded here, never fatal (approved).
      metadata: {
        skippedCompanyKeys: r.skippedCompanyKeys,
        skippedCount: r.skippedCompanyKeys.length,
        durationMs: r.durationMs,
        concurrency: resolveConcurrency(),
        rebuildLinks,
      },
      updatedAt: sql`NOW()`,
      updatedBy: 'realnex_sync',
    })
    .where(eq(realnexSyncJobs.id, jobId));
}

async function markJobFailedInternal(jobId: string, err: unknown): Promise<void> {
  const msg = err instanceof Error ? err.message : String(err);
  await db
    .update(realnexSyncJobs)
    .set({
      status: 'failed',
      completedAt: sql`NOW()`,
      errorMessage: msg.slice(0, 4000),
      updatedBy: 'realnex_job_runner',
    })
    .where(eq(realnexSyncJobs.id, jobId));
}

/**
 * Run the sync for an existing queued job. Fire-and-forget from the POST handler:
 *
 *   const job = await createJob({ triggeredBy: session.user.email });
 *   void kickOffRealnexSync({ jobId: job.id, userId: session.user.id });
 *   return NextResponse.json({ jobId: job.id }, { status: 202 });
 *
 * The cron path AWAITS it (so the cron exit code reflects success). Orphan recovery handles
 * mid-run process death via the shared status='running' AND stale query.
 */
export async function kickOffRealnexSync(opts: {
  jobId: string;
  userId?: string | null;
  /** Drift remedy: clear all company_key before re-walking so the run converges to truth. */
  rebuildLinks?: boolean;
}): Promise<void> {
  const { jobId, userId, rebuildLinks = false } = opts;
  const ctx = buildContext(jobId);
  try {
    await markJobRunning(jobId);
    console.log(`[realnex-job:${jobId}] running (concurrency=${resolveConcurrency()}, rebuildLinks=${rebuildLinks})`);

    // Lazy import to avoid a runtime import cycle (./sync imports the RealnexJobContext type
    // from this file). Type-only imports are erased, but the runtime edge lives here.
    const { runRealnexSync } = await import('./sync');
    const result = await runRealnexSync({ jobContext: ctx, rebuildLinks });
    await markJobCompleted(jobId, result, rebuildLinks);

    await logActivity({
      actorUserId: userId ?? null,
      action: 'realnex.sync.completed',
      entityType: 'realnex_sync_job',
      entityId: jobId,
      payload: {
        companies: result.companiesSynced,
        contacts: result.contactsSynced,
        groups: result.groupsSynced,
        links: result.linksResolved,
        apiCalls: result.apiCalls,
        rateLimitHits: result.rateLimitHits,
        skipped: result.skippedCompanyKeys.length,
        durationMs: result.durationMs,
      },
      status: result.skippedCompanyKeys.length > 0 ? 'warn' : 'ok',
    });

    console.log(
      `[realnex-job:${jobId}] done companies=${result.companiesSynced} contacts=${result.contactsSynced} ` +
        `groups=${result.groupsSynced} links=${result.linksResolved} apiCalls=${result.apiCalls} ` +
        `rateLimitHits=${result.rateLimitHits} skipped=${result.skippedCompanyKeys.length} duration=${result.durationMs}ms`,
    );
  } catch (err) {
    console.error(`[realnex-job:${jobId}] FAILED:`, err);
    await markJobFailedInternal(jobId, err);
    await logActivity({
      actorUserId: userId ?? null,
      action: 'realnex.sync.failed',
      entityType: 'realnex_sync_job',
      entityId: jobId,
      payload: { reason: err instanceof Error ? err.message : 'unknown' },
      status: 'error',
    });
  }
}
