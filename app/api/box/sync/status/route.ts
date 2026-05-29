/**
 * GET /api/box/sync/status — returns the latest box_sync_jobs row's current state.
 *
 * Dedicated status endpoint (per spec). Same payload shape as `GET /api/box/sync`
 * but at a memorable URL the UI polls every 5s.
 *
 * Returns:
 *   200 + { job: {...} | null }
 *   401                       — no session
 */

import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { getLatestJob } from '@/lib/external/box/job-runner';

export const dynamic = 'force-dynamic';

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
