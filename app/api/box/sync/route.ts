/**
 * POST /api/box/sync       — start a new walk (returns 202 with jobId).
 * GET  /api/box/sync       — same shape as /api/box/sync/status (latest job + state).
 *
 * Query params (POST):
 *   ?mode=full|incremental  default: 'incremental' if a completed full exists, else 'full'
 *   ?force=true             abandons any active job and starts a new one
 *
 * Responses:
 *   202 + { jobId, status, walkId } — new job created
 *   409 + { jobId, status, progress } — active job already running (use status endpoint to poll)
 *   401                              — no session
 *   412 + { error: 'box_not_connected' }  — calling user has no Box token
 *   500                              — unexpected
 *
 * Anti-pattern guard: this endpoint MUST NOT await the walk. Kick off + return.
 */

import { NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth/session';
import { BoxNotConnectedError, getValidAccessTokenForUser } from '@/lib/external/box/client';
import {
  createJob,
  getActiveJob,
  getLatestJob,
  kickOffWalk,
  markJobFailed,
} from '@/lib/external/box/job-runner';

export const dynamic = 'force-dynamic';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

/**
 * Decide which sync mode to use when caller didn't override.
 * - If no completed full walk has ever happened → 'full'
 * - Otherwise → 'incremental'
 */
async function chooseDefaultSyncMode(): Promise<'full' | 'incremental'> {
  const result = await db.execute(sql`
    SELECT id FROM box_sync_jobs
    WHERE status = 'completed' AND sync_mode = 'full' AND deleted_at IS NULL
    ORDER BY completed_at DESC NULLS LAST
    LIMIT 1
  `);
  return result.rows.length > 0 ? 'incremental' : 'full';
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const modeParam = url.searchParams.get('mode');
  const force = url.searchParams.get('force') === 'true';

  // Verify the caller has a Box connection BEFORE we create a job record.
  try {
    await getValidAccessTokenForUser(session.user.id);
  } catch (err) {
    if (err instanceof BoxNotConnectedError) {
      return NextResponse.json(
        { error: 'box_not_connected', message: err.message },
        { status: 412 },
      );
    }
    return NextResponse.json(
      { error: 'box_auth_check_failed', message: err instanceof Error ? err.message : 'unknown' },
      { status: 412 },
    );
  }

  let rootFolderId: string;
  try {
    rootFolderId = requireEnv('BOX_TENANTS_CHAPMANHOECK_FOLDER_ID');
  } catch (err) {
    return NextResponse.json(
      { error: 'env_missing', message: err instanceof Error ? err.message : 'env missing' },
      { status: 500 },
    );
  }

  // Active-job guard. If a job is already running, return 409 with current state — UNLESS
  // ?force=true, in which case we abandon it (mark failed) and start a new one.
  const active = await getActiveJob();
  if (active && !force) {
    return NextResponse.json(
      {
        error: 'sync_in_progress',
        jobId: active.id,
        status: active.status,
        progress: {
          foldersWalked: active.progressFoldersWalked,
          filesIndexed: active.progressFilesIndexed,
          apiCallsMade: active.apiCallsMade,
          currentPath: active.currentPath,
          startedAt: active.startedAt.toISOString(),
        },
      },
      { status: 409 },
    );
  }
  if (active && force) {
    await markJobFailed(active.id, `superseded by force=true from ${session.user.email}`);
    console.log(
      `[sync] force=true: abandoned active job ${active.id} from previous attempt`,
    );
  }

  const syncMode: 'full' | 'incremental' =
    modeParam === 'full' || modeParam === 'incremental' ? modeParam : await chooseDefaultSyncMode();

  const job = await createJob({
    triggeredBy: session.user.email,
    syncMode,
    isForceFull: force || syncMode === 'full',
  });

  // Fire-and-forget. Node keeps the process alive while the promise is pending.
  // If the process dies mid-walk, orphan-recovery handles cleanup on next boot.
  void kickOffWalk({
    jobId: job.id,
    walkId: job.walkId,
    userId: session.user.id,
    rootFolderId,
  });

  console.log(
    `[sync] POST started jobId=${job.id} walkId=${job.walkId} mode=${syncMode} forceFull=${job.isForceFull} triggeredBy=${session.user.email}`,
  );

  return NextResponse.json(
    {
      jobId: job.id,
      walkId: job.walkId,
      status: job.status,
      syncMode: job.syncMode,
    },
    { status: 202 },
  );
}

export async function GET() {
  const session = await getSession();
  if (!session.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const latest = await getLatestJob();
  if (!latest) {
    return NextResponse.json({ job: null });
  }
  return NextResponse.json({
    job: {
      id: latest.id,
      walkId: latest.walkId,
      status: latest.status,
      syncMode: latest.syncMode,
      isForceFull: latest.isForceFull,
      startedAt: latest.startedAt.toISOString(),
      completedAt: latest.completedAt?.toISOString() ?? null,
      progressFoldersWalked: latest.progressFoldersWalked,
      progressFilesIndexed: latest.progressFilesIndexed,
      apiCallsMade: latest.apiCallsMade,
      currentPath: latest.currentPath,
      totalFoldersInIndex: latest.totalFoldersInIndex,
      errorMessage: latest.errorMessage,
      triggeredBy: latest.triggeredBy,
    },
  });
}
