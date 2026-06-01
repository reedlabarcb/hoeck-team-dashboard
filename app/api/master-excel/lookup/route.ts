/**
 * GET /api/master-excel/lookup?client=<name>&market=<optional>
 *
 * Queries the TT Rep Master Client List xlsx (downloaded from Box, parsed with openpyxl
 * via the Python bridge) for rows matching the given client (case-insensitive contains)
 * plus optional market filter.
 *
 * Auth-required (handled by the edge proxy at /proxy.ts).
 *
 * Responses:
 *   200 + { rows, matchCount, multipleMatches, query, source, warnings }
 *   400 + { error: 'missing_client' }       if no ?client param
 *   412 + { error: 'box_not_connected' }    if calling user has no Box token
 *   412 + { error: 'box_auth_expired' }     if token refresh failed
 *   503 + { error: 'lookup_failed', message }  on Python/Box error
 *
 * Side effects:
 *   - Logs `master_excel_lookup` to activity_feed (handled inside the safe wrapper).
 *   - May trigger a Box file download to /tmp on cache miss.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import {
  BoxAuthExpiredError,
  BoxNotConnectedError,
} from '@/lib/external/box/client';
import { getCriticalDatesForClient } from '@/lib/external/master-excel/safe';

export const dynamic = 'force-dynamic';
// The Box download + openpyxl read can take a few seconds on cache miss; give it room.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const client = url.searchParams.get('client')?.trim();
  const market = url.searchParams.get('market')?.trim() || undefined;

  if (!client) {
    return NextResponse.json(
      { error: 'missing_client', message: '?client param is required' },
      { status: 400 },
    );
  }

  try {
    const result = await getCriticalDatesForClient(session.user.id, client, market);
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
    console.error(`[master-excel] lookup failed userId=${session.user.id} client="${client}" market="${market ?? ''}":`, msg);
    return NextResponse.json(
      { error: 'lookup_failed', message: msg },
      { status: 503 },
    );
  }
}
