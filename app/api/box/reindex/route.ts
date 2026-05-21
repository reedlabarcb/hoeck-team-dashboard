/**
 * POST /api/box/reindex
 *
 * Triggers a fresh walk of the Tenants – ChapmanHoeck Box tree using the calling
 * user's stored OAuth token. Anyone authenticated can trigger this (design decision (C)
 * — see Phase 2 plan). The walker is rate-limited by Box itself; spamming the button
 * doesn't do real damage.
 *
 * Response:
 *   200 + { walkId, indexedCount, durationMs, rootFolderName }  on success
 *   401                                                          if no Box token
 *   503 + { error }                                              on walker failure
 */

import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { walkBoxTree } from '@/lib/external/box/walker';
import { BoxNotConnectedError, BoxAuthExpiredError } from '@/lib/external/box/client';
import { logActivity } from '@/lib/activity';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 min — walk should finish in <60s but room for big trees

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export async function POST() {
  const session = await getSession();
  if (!session.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let rootFolderId: string;
  try {
    rootFolderId = requireEnv('BOX_TENANTS_CHAPMANHOECK_FOLDER_ID');
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'env missing' },
      { status: 500 },
    );
  }

  try {
    const result = await walkBoxTree({
      userId: session.user.id,
      rootFolderId,
    });
    await logActivity({
      actorUserId: session.user.id,
      action: 'box.reindex',
      entityType: 'box_folder_index',
      payload: {
        walkId: result.walkId,
        indexedCount: result.indexedCount,
        durationMs: result.durationMs,
        rootFolderName: result.rootFolderName,
      },
      status: 'ok',
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof BoxNotConnectedError) {
      return NextResponse.json(
        { error: 'box_not_connected', message: err.message },
        { status: 412 }, // precondition failed: user must Connect Box first
      );
    }
    if (err instanceof BoxAuthExpiredError) {
      return NextResponse.json(
        { error: 'box_auth_expired', message: err.message },
        { status: 412 },
      );
    }
    await logActivity({
      actorUserId: session.user.id,
      action: 'box.reindex_failed',
      payload: { reason: err instanceof Error ? err.message : 'unknown' },
      status: 'error',
    });
    return NextResponse.json(
      { error: 'walker_failed', message: err instanceof Error ? err.message : 'unknown' },
      { status: 503 },
    );
  }
}
