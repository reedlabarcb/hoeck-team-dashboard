/**
 * POST /api/box/extract-text       — start a new text-extraction job (202 + jobId).
 * GET  /api/box/extract-text       — same shape as /api/box/extract-text/status
 *                                    (latest text_extraction job, type-scoped).
 *
 * Query params (POST):
 *   ?force=true   abandons any active text_extraction job and starts a new one.
 *                 No ?mode — text extraction has no full/incremental dichotomy
 *                 (the worker pulls whichever rows are extraction_status='pending').
 *
 * Responses:
 *   202 + { jobId, status, walkId } — new job created, worker fired-and-forget
 *   409 + { jobId, status, progress } — text_extraction job already active
 *   401                              — no session
 *   412 + { error: 'box_not_connected' } — calling user has no Box token
 *   500                              — unexpected
 *
 * Concurrency note: the 409 guard is scoped to job_type='text_extraction', so a
 * walker (folder_walk) running concurrently does NOT block this kickoff. The
 * two workers share the same Postgres connection pool but otherwise read/write
 * disjoint columns on box_folder_index (walker upserts identity/metadata;
 * text-extractor updates extracted_text + extraction_status). Inserts/updates
 * are row-scoped so contention is minimal.
 *
 * Anti-pattern guard: this endpoint MUST NOT await the extraction. Kick off + return.
 *
 * Lineage: mirrors app/api/box/sync/route.ts (Phase 2 walker pattern).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { BoxNotConnectedError, getValidAccessTokenForUser } from '@/lib/external/box/client';
import {
  createJob,
  getActiveJobByType,
  getLatestJobByType,
  kickOffTextExtraction,
  markJobFailed,
} from '@/lib/external/box/job-runner';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const force = url.searchParams.get('force') === 'true';

  // Verify the caller has a Box connection BEFORE we create a job record.
  // The worker downloads PDFs using the same user's token.
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
      {
        error: 'box_auth_check_failed',
        message: err instanceof Error ? err.message : 'unknown',
      },
      { status: 412 },
    );
  }

  // Active-job guard, scoped to text_extraction so a running walker doesn't block.
  const active = await getActiveJobByType('text_extraction');
  if (active && !force) {
    return NextResponse.json(
      {
        error: 'text_extraction_in_progress',
        jobId: active.id,
        status: active.status,
        progress: {
          filesProcessed: active.progressFilesProcessed,
          filesSucceeded: active.progressFilesSucceeded,
          filesFailed: active.progressFilesFailed,
          filesSkipped: active.progressFilesSkipped,
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
      `[extract-text] force=true: abandoned active job ${active.id} from previous attempt`,
    );
  }

  const job = await createJob({
    triggeredBy: session.user.email,
    syncMode: 'full', // walker-shape field; not used for text_extraction. Default 'full' is fine.
    isForceFull: false,
    jobType: 'text_extraction',
  });

  // Fire-and-forget. Node keeps the process alive while the promise is pending.
  // Orphan-recovery handles cleanup on next boot if the process dies mid-run.
  void kickOffTextExtraction({
    jobId: job.id,
    walkId: job.walkId,
    userId: session.user.id,
  });

  console.log(
    `[extract-text] POST started jobId=${job.id} walkId=${job.walkId} triggeredBy=${session.user.email}`,
  );

  return NextResponse.json(
    {
      jobId: job.id,
      walkId: job.walkId,
      status: job.status,
      jobType: job.jobType,
    },
    { status: 202 },
  );
}

/**
 * GET — alias of /api/box/extract-text/status for symmetry with /api/box/sync.
 * The dedicated status endpoint is the one the UI polls.
 */
export async function GET() {
  const session = await getSession();
  if (!session.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const latest = await getLatestJobByType('text_extraction');
  if (!latest) {
    return NextResponse.json({ job: null });
  }
  return NextResponse.json({
    job: {
      id: latest.id,
      walkId: latest.walkId,
      status: latest.status,
      jobType: latest.jobType,
      startedAt: latest.startedAt.toISOString(),
      completedAt: latest.completedAt?.toISOString() ?? null,
      progressFilesProcessed: latest.progressFilesProcessed,
      progressFilesSucceeded: latest.progressFilesSucceeded,
      progressFilesFailed: latest.progressFilesFailed,
      progressFilesSkipped: latest.progressFilesSkipped,
      currentPath: latest.currentPath,
      errorMessage: latest.errorMessage,
      triggeredBy: latest.triggeredBy,
    },
  });
}
