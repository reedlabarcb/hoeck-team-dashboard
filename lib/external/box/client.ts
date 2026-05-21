/**
 * Box HTTP client — handles token retrieval + auto-refresh for a given dashboard user.
 *
 * Used by lib/external/box/safe.ts. Application code calls safe-wrapper methods like
 * `listFolder(userId, folderId)`; the safe wrapper calls `boxFetch(userId, url, init)`
 * here, which resolves the right access_token (auto-refreshing if needed) and makes the
 * call.
 *
 * Refresh rules:
 *   - If stored access_token is within 5 min of expiry → refresh proactively
 *   - If Box returns 401 → refresh once + retry
 *   - On refresh, persist BOTH the new access_token AND the new refresh_token
 *     (Box rotates refresh_tokens; failing to persist makes the old one valid until
 *     the new one is used, but eventually the chain breaks and user must re-OAuth)
 *
 * Activity logging:
 *   - Every successful refresh logs to activity_feed as 'box.token_refresh'
 *   - 401-after-refresh (user must reconnect) logs as 'box.token_invalid' with status='warn'
 */

import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { userBoxTokens } from '@/lib/db/schema';
import { encryptToken, decryptToken } from './crypto';
import { refreshAccessToken } from './oauth';
import { logActivity } from '@/lib/activity';

const REFRESH_BEFORE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

export class BoxNotConnectedError extends Error {
  constructor(public userId: string) {
    super(`No Box connection for user ${userId} (or it was revoked)`);
    this.name = 'BoxNotConnectedError';
  }
}

export class BoxAuthExpiredError extends Error {
  constructor(public userId: string, cause?: string) {
    super(
      `Box refresh failed for user ${userId} — user must reconnect Box${cause ? `: ${cause}` : ''}`,
    );
    this.name = 'BoxAuthExpiredError';
  }
}

interface ResolvedToken {
  accessToken: string;
  expiresAt: Date;
  boxUserId: string;
}

/**
 * Pull the current access_token for a user, refreshing if necessary.
 * Throws BoxNotConnectedError if the user has never connected Box (UI shows "Connect Box").
 * Throws BoxAuthExpiredError if the refresh token is also invalid.
 */
export async function getValidAccessTokenForUser(userId: string): Promise<ResolvedToken> {
  const rows = await db
    .select()
    .from(userBoxTokens)
    .where(and(eq(userBoxTokens.userId, userId), isNull(userBoxTokens.deletedAt)))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new BoxNotConnectedError(userId);
  }

  // Still fresh? Use as-is.
  const now = Date.now();
  if (row.expiresAt.getTime() - now > REFRESH_BEFORE_EXPIRY_MS) {
    return {
      accessToken: decryptToken(row.accessTokenEncrypted),
      expiresAt: row.expiresAt,
      boxUserId: row.boxUserId,
    };
  }

  // Refresh.
  const oldRefresh = decryptToken(row.refreshTokenEncrypted);
  let fresh;
  try {
    fresh = await refreshAccessToken(oldRefresh);
  } catch (err) {
    await logActivity({
      actorUserId: userId,
      action: 'box.token_invalid',
      entityType: 'user_box_token',
      entityId: row.id,
      payload: { reason: err instanceof Error ? err.message : 'unknown' },
      status: 'warn',
    });
    throw new BoxAuthExpiredError(userId, err instanceof Error ? err.message : undefined);
  }

  const newExpiresAt = new Date(now + fresh.expires_in * 1000);
  await db
    .update(userBoxTokens)
    .set({
      accessTokenEncrypted: encryptToken(fresh.access_token),
      refreshTokenEncrypted: encryptToken(fresh.refresh_token),
      expiresAt: newExpiresAt,
      updatedBy: 'box.token_refresh',
    })
    .where(eq(userBoxTokens.id, row.id));

  await logActivity({
    actorUserId: userId,
    action: 'box.token_refresh',
    entityType: 'user_box_token',
    entityId: row.id,
    payload: { expires_in: fresh.expires_in },
    status: 'ok',
  });

  return {
    accessToken: fresh.access_token,
    expiresAt: newExpiresAt,
    boxUserId: row.boxUserId,
  };
}

/**
 * Make an authenticated Box API call as a given user.
 * Returns the raw Response — callers handle parsing (json/blob/text).
 *
 * On 401, performs ONE refresh + retry attempt before giving up.
 */
export async function boxFetch(
  userId: string,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  let { accessToken } = await getValidAccessTokenForUser(userId);
  const doFetch = async () =>
    fetch(url, {
      ...init,
      headers: {
        ...(init.headers || {}),
        Authorization: `Bearer ${accessToken}`,
      },
    });

  let res = await doFetch();
  if (res.status === 401) {
    // Force a refresh by zeroing the in-memory token (DB row still has the encrypted one
    // that just got 401; calling getValidAccessTokenForUser again will only re-decrypt
    // and re-use it, not force a refresh — so we explicitly invoke refresh logic by
    // marking expiresAt as past and looping through getValidAccessTokenForUser).
    // Simpler: directly call refreshAccessToken via getValidAccessTokenForUser after
    // setting the DB row's expires_at to past.
    await db
      .update(userBoxTokens)
      .set({ expiresAt: new Date(Date.now() - 1000), updatedBy: 'box.401_retry' })
      .where(eq(userBoxTokens.userId, userId));
    const retry = await getValidAccessTokenForUser(userId);
    accessToken = retry.accessToken;
    res = await doFetch();
  }
  return res;
}
