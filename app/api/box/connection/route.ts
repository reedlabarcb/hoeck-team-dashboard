/**
 * GET /api/box/connection
 *
 * Returns whether the calling user has an active Box connection.
 * Used by the UI to decide whether to show "Connect Box" vs "Connected as <email>".
 *
 * Never returns the access_token. Only metadata.
 */

import { NextResponse } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { userBoxTokens } from '@/lib/db/schema';
import { getSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rows = await db
    .select({
      boxUserId: userBoxTokens.boxUserId,
      boxLogin: userBoxTokens.boxLogin,
      expiresAt: userBoxTokens.expiresAt,
      createdAt: userBoxTokens.createdAt,
      updatedAt: userBoxTokens.updatedAt,
    })
    .from(userBoxTokens)
    .where(and(eq(userBoxTokens.userId, session.user.id), isNull(userBoxTokens.deletedAt)))
    .limit(1);

  if (rows.length === 0) {
    return NextResponse.json({ connected: false });
  }
  const r = rows[0];
  return NextResponse.json({
    connected: true,
    box_user_id: r.boxUserId,
    box_login: r.boxLogin,
    expires_at: r.expiresAt.toISOString(),
    connected_at: r.createdAt.toISOString(),
    refreshed_at: r.updatedAt.toISOString(),
  });
}
