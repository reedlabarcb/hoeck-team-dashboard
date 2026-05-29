/**
 * POST /api/box/reindex — DEPRECATED. Forwards to /api/box/sync (async).
 *
 * The synchronous walker behind this route held the HTTP connection for the entire walk
 * (up to 34 min on the real Tenants - ChapmanHoeck tree). The frontend's 5-min
 * AbortController fired well before completion. Replaced by the async background-job
 * pattern at /api/box/sync.
 *
 * This shim exists so:
 *   - In-flight browser bundles from before the async rollout still work
 *   - Any external integrations or bookmarks pointing here keep working
 *
 * 307 (Temporary Redirect) preserves the POST method when the client follows.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const newUrl = new URL('/api/box/sync', url);
  // Preserve any query string the caller sent (e.g., ?mode=full).
  newUrl.search = url.search;
  return NextResponse.redirect(newUrl, { status: 307 });
}
