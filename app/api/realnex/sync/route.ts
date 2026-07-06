/**
 * POST /api/realnex/sync   — start a read-only RealNex -> Postgres mirror sync (202 + jobId).
 * GET  /api/realnex/sync   — latest job + state (same shape as /api/realnex/sync/status).
 *
 * Query params (POST):
 *   ?force=true   abandon any active job and start a new one.
 *
 * Responses:
 *   202 + { jobId, status }                    — new job created
 *   409 + { error:'sync_in_progress', ... }    — a job is already active (poll the status endpoint)
 *   401                                         — no session
 *   412 + { error:'realnex_not_configured' }    — REALNEX_API_KEY not set
 *
 * READ-ONLY: this reads RealNex + writes our Postgres mirror only. It MUST NOT await the
 * sync — kick off (fire-and-forget) and return 202. Orphan recovery handles process death.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import {
  createJob,
  getActiveJob,
  getLatestJob,
  kickOffRealnexSync,
  markJobFailed,
  serializeRealnexJob,
} from '@/lib/external/realnex/job-runner';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // RealNex readiness check BEFORE creating a job row (the worker would throw otherwise).
  if (!process.env.REALNEX_API_KEY) {
    return NextResponse.json(
      { error: 'realnex_not_configured', message: 'REALNEX_API_KEY is not set' },
      { status: 412 },
    );
  }

  const force = new URL(request.url).searchParams.get('force') === 'true';

  // Active-job guard: 409 with current progress unless ?force=true abandons it.
  const active = await getActiveJob();
  if (active && !force) {
    return NextResponse.json(
      {
        error: 'sync_in_progress',
        jobId: active.id,
        status: active.status,
        progress: {
          currentPhase: active.currentPhase,
          companiesSynced: active.companiesSynced,
          contactsSynced: active.contactsSynced,
          groupsSynced: active.groupsSynced,
          linksResolved: active.linksResolved,
          apiCallsMade: active.apiCallsMade,
          rateLimitHits: active.rateLimitHits,
          startedAt: active.startedAt.toISOString(),
        },
      },
      { status: 409 },
    );
  }
  if (active && force) {
    await markJobFailed(active.id, `superseded by force=true from ${session.user.email}`);
    console.log(`[realnex-sync] force=true: abandoned active job ${active.id}`);
  }

  const job = await createJob({ triggeredBy: session.user.email });

  // Fire-and-forget. Node keeps the process alive while the promise is pending; if it dies
  // mid-sync, orphan-recovery marks the row failed on next boot.
  void kickOffRealnexSync({ jobId: job.id, userId: session.user.id });

  console.log(`[realnex-sync] POST started jobId=${job.id} triggeredBy=${session.user.email}`);

  return NextResponse.json({ jobId: job.id, status: job.status }, { status: 202 });
}

export async function GET() {
  const session = await getSession();
  if (!session.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const latest = await getLatestJob();
  return NextResponse.json({ job: latest ? serializeRealnexJob(latest) : null });
}
