/**
 * logActivity — append an entry to activity_feed AND bump system_state.last_write_at.
 *
 * Every meaningful write in the dashboard goes through this helper so:
 *   1. There's a single chokepoint for audit
 *   2. system_state.last_write_at advances → other users' tabs invalidate their caches
 *      within their polling window (mechanism: useSystemStateInvalidation)
 *
 * Use:
 *   await logActivity({
 *     actorUserId: user.id,
 *     action: 'company.create',
 *     entityType: 'realnex_company',
 *     entityId: created.id,
 *     payload: { name: created.name, source: 'Dashboard' },
 *     status: 'ok',
 *   });
 */

import { sql } from 'drizzle-orm';
import { db } from './db';
import { activityFeed, systemState, SYSTEM_STATE_KEYS } from './db/schema';

export interface LogActivityInput {
  actorUserId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  payload?: Record<string, unknown>;
  status?: 'ok' | 'warn' | 'error' | 'destructive_rename';
}

export async function logActivity(input: LogActivityInput): Promise<void> {
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.insert(activityFeed).values({
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      payload: input.payload ?? {},
      status: input.status ?? 'ok',
    });

    // Upsert last_write_at + table-keyed timestamps.
    // Frontend polling reads these and invalidates stale caches.
    await tx
      .insert(systemState)
      .values({
        key: SYSTEM_STATE_KEYS.LAST_WRITE_AT,
        value: { timestamp: now.toISOString() },
      })
      .onConflictDoUpdate({
        target: systemState.key,
        set: {
          value: { timestamp: now.toISOString() },
          updatedAt: sql`NOW()`,
        },
      });
  });
}
