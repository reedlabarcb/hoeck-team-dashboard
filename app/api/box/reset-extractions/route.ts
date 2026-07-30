/**
 * POST /api/box/reset-extractions — flip failed text-extraction rows back to 'pending'
 * so the extraction worker retries them.
 *
 * Query params:
 *   ?mode=access  (DEFAULT) only rows whose extraction_error was a permission/visibility
 *                 failure (HTTP 403 / 404) — the ones that deserve another try under a
 *                 token with broader Box access.
 *   ?mode=all     every 'failed' row, including genuinely corrupt files. Opt-in on
 *                 purpose: those will just fail again and burn Box API calls.
 *
 * Responses:
 *   200 + { mode, updated, chunks, truncated }
 *   401                                      — no session
 *   409 + { error: 'text_extraction_in_progress' } — an extraction job is running; resetting
 *          rows mid-run would reshuffle the batch under the worker's feet.
 *   500                                      — unexpected
 *
 * WHY A ROUTE AND NOT JUST A SCRIPT: the production Postgres is only reachable from inside
 * Railway's network (the public proxy is firewall-blocked on the corp network), so a
 * CLI-only path isn't usable from a laptop. This runs server-side, same as the extraction
 * kickoff. Mirrors app/api/box/extract-text/route.ts's auth + active-job guard.
 *
 * This endpoint touches ONLY extraction bookkeeping columns on box_folder_index. It makes
 * no Box calls and cannot write to Box.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { getActiveJobByType } from '@/lib/external/box/job-runner';
import { resetFailedExtractions, type ResetMode } from '@/lib/external/box/reset-extractions';
import { logActivity } from '@/lib/activity';

export const dynamic = 'force-dynamic';
// Chunked UPDATEs over a large index can take a few seconds; give it room.
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const mode: ResetMode = new URL(request.url).searchParams.get('mode') === 'all' ? 'all' : 'access';

  // Don't move rows around while the worker is mid-batch.
  const active = await getActiveJobByType('text_extraction');
  if (active) {
    return NextResponse.json(
      {
        error: 'text_extraction_in_progress',
        message: 'An extraction job is running. Wait for it to finish, then reset.',
        jobId: active.id,
      },
      { status: 409 },
    );
  }

  try {
    const result = await resetFailedExtractions({ mode });

    await logActivity({
      actorUserId: session.user.id,
      action: 'box.extraction.reset',
      entityType: 'box_folder_index',
      entityId: 'bulk',
      payload: { mode: result.mode, updated: result.updated, chunks: result.chunks, truncated: result.truncated },
      status: 'ok',
    }).catch((e) => console.error('[reset-extractions] audit write failed:', e));

    console.log(
      `[reset-extractions] POST mode=${result.mode} updated=${result.updated} by=${session.user.email}`,
    );
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    console.error('[reset-extractions] failed:', message);
    return NextResponse.json({ error: 'reset_failed', message }, { status: 500 });
  }
}
