/**
 * GET /api/realnex/history?key=<objectKey>&page=<n> — a record's RealNex History/notes, read LIVE
 * (P3.13 Record View). Notes must always be current (a colleague's note from this morning must
 * show), so this reads live via the wrapper's getObjectHistory rather than the mirror. Returns the
 * normalized { totalCount, pageNumber, pageSize, items } with each note's userKey resolved to a
 * name (cached listUsers). READ-ONLY — getObjectHistory + listUsers are wrapper GETs.
 *
 * Auth-required. 200 {page} | 400 missing_key | 401 | 502 realnex_read_failed
 * | 503 realnex_not_configured | 500 history_failed.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { getObjectHistory } from '@/lib/external/realnex/safe';
import { RealNexApiError, RealNexNotConfiguredError } from '@/lib/external/realnex/client';
import { getUserNameMap, normalizeHistoryPage } from '@/lib/realnex/history';

export const dynamic = 'force-dynamic';
const PAGE_SIZE = 25;

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const key = (url.searchParams.get('key') ?? '').trim();
  if (!key) {
    return NextResponse.json({ error: 'missing_key', message: 'key is required' }, { status: 400 });
  }
  const pageRaw = parseInt(url.searchParams.get('page') ?? '1', 10);
  const pageNumber = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  try {
    // Both are reads; run in parallel (getUserNameMap is cached + swallows its own errors).
    const [raw, userNames] = await Promise.all([
      getObjectHistory(key, { pageNumber, pageSize: PAGE_SIZE }),
      getUserNameMap(),
    ]);
    return NextResponse.json(normalizeHistoryPage(raw, PAGE_SIZE, userNames));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    if (err instanceof RealNexNotConfiguredError) {
      return NextResponse.json({ error: 'realnex_not_configured', message }, { status: 503 });
    }
    if (err instanceof RealNexApiError) {
      return NextResponse.json({ error: 'realnex_read_failed', status: err.status, message }, { status: 502 });
    }
    return NextResponse.json({ error: 'history_failed', message }, { status: 500 });
  }
}
