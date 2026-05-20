/**
 * GET /api/system/last-write
 *
 * Lightweight polling endpoint consumed by:
 *   - lib/hooks/useSystemStateInvalidation.ts (every 30s, dashboard root)
 *   - components/UpdatesAvailableBadge.tsx (every 30s, per-view)
 *
 * Returns the latest write timestamp app-wide, plus a per-table breakdown so views
 * only invalidate when their own table changes.
 */

import { NextResponse } from 'next/server';
import { max } from 'drizzle-orm';
import { db } from '@/lib/db';
import { activityFeed, systemState, SYSTEM_STATE_KEYS } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Pull system_state rows we care about.
    const stateRows = await db.select().from(systemState);
    const stateMap = new Map(stateRows.map((r) => [r.key, r]));

    const lastWriteRow = stateMap.get(SYSTEM_STATE_KEYS.LAST_WRITE_AT);
    const lastSyncRealnex = stateMap.get(SYSTEM_STATE_KEYS.LAST_SYNC_REALNEX);
    const lastSyncBox = stateMap.get(SYSTEM_STATE_KEYS.LAST_SYNC_BOX);

    // Per-table breakdown. Phase 1 has activity_feed only.
    // Later phases add notes, tags, companies_mirror, contacts_mirror.
    const [{ activityMax }] = await db
      .select({ activityMax: max(activityFeed.createdAt) })
      .from(activityFeed);

    return NextResponse.json({
      last_write_at: lastWriteRow?.updatedAt?.toISOString() ?? null,
      last_sync_at:
        lastSyncRealnex?.updatedAt && lastSyncBox?.updatedAt
          ? new Date(
              Math.max(
                new Date(lastSyncRealnex.updatedAt).getTime(),
                new Date(lastSyncBox.updatedAt).getTime(),
              ),
            ).toISOString()
          : (lastSyncRealnex?.updatedAt ?? lastSyncBox?.updatedAt ?? null)?.toString() ?? null,
      tables: {
        activity_feed: activityMax instanceof Date ? activityMax.toISOString() : (activityMax ?? null),
        // Phase 2+: notes, tags, companies_mirror, contacts_mirror filled in as tables land.
        notes: null,
        tags: null,
        companies_mirror: null,
        contacts_mirror: null,
      },
    });
  } catch (err) {
    // Don't blow up the poll loop — return a soft-failure response that the hook can ignore.
    return NextResponse.json(
      {
        last_write_at: null,
        last_sync_at: null,
        tables: {},
        error: err instanceof Error ? err.message : 'unknown',
      },
      { status: 503 },
    );
  }
}
