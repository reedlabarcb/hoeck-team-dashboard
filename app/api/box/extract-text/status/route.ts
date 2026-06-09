/**
 * GET /api/box/extract-text/status — returns the latest text_extraction job's state.
 *
 * Dedicated status endpoint at a memorable URL the UI polls every 5s. Same payload
 * shape as `GET /api/box/extract-text`. Mirrors /api/box/sync/status (Phase 2 walker).
 *
 * Returns:
 *   200 + { job: {...} | null }   — null when no text_extraction job has ever run
 *   401                            — no session
 */

import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { getLatestJobByType } from '@/lib/external/box/job-runner';

export const dynamic = 'force-dynamic';

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
