/**
 * GET /api/master-excel/all
 *
 * Returns every parsed row from the Master Excel. Primarily for the /master-excel UI
 * to populate the market dropdown (only show markets that actually exist) and to
 * render an initial table view without requiring a search.
 *
 * Auth-required.
 *
 * Same caching semantics as /lookup: 5-min etag-bound. The parsed-all result is
 * memoized inside lib/external/master-excel/cache.ts so calling this twice in a
 * row is one Python invocation + one in-memory return.
 *
 * Responses:
 *   200 + { rows, rowCount, source, warnings }
 *   412 + { error: 'box_not_connected' | 'box_auth_expired' }
 *   503 + { error: 'all_failed', message }
 */

import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import {
  BoxAuthExpiredError,
  BoxNotConnectedError,
} from '@/lib/external/box/client';
import { getAllRows } from '@/lib/external/master-excel/safe';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  const session = await getSession();
  if (!session.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await getAllRows(session.user.id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof BoxNotConnectedError) {
      return NextResponse.json(
        { error: 'box_not_connected', message: err.message },
        { status: 412 },
      );
    }
    if (err instanceof BoxAuthExpiredError) {
      return NextResponse.json(
        { error: 'box_auth_expired', message: err.message },
        { status: 412 },
      );
    }
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error(`[master-excel] /all failed userId=${session.user.id}:`, msg);
    return NextResponse.json(
      { error: 'all_failed', message: msg },
      { status: 503 },
    );
  }
}
