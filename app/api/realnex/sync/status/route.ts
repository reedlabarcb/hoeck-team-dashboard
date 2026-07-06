/**
 * GET /api/realnex/sync/status — the latest realnex_sync_jobs row's current state.
 *
 * Dedicated status URL the UI polls every 5s. Same payload shape as GET /api/realnex/sync.
 *
 * Returns:
 *   200 + { job: {...} | null }
 *   401                        — no session
 */

import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { getLatestJob, serializeRealnexJob } from '@/lib/external/realnex/job-runner';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const latest = await getLatestJob();
  return NextResponse.json({ job: latest ? serializeRealnexJob(latest) : null });
}
