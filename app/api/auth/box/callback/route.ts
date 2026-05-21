/**
 * GET /api/auth/box/callback?code=...&state=...
 *
 * Box redirects here after the user clicks Allow. We:
 *   1. Validate state against the value we put in iron-session at /connect (CSRF)
 *   2. Exchange `code` for access_token + refresh_token
 *   3. Look up the Box user we connected (so we can show "Connected as <email>")
 *   4. Encrypt tokens, upsert into user_box_tokens
 *   5. Log activity_feed entry
 *   6. Redirect user back to wherever they came from (default: /files)
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { userBoxTokens } from '@/lib/db/schema';
import { getSession } from '@/lib/auth/session';
import { exchangeCodeForTokens, getCurrentBoxUser } from '@/lib/external/box/oauth';
import { encryptToken } from '@/lib/external/box/crypto';
import { getBoxRedirectUri } from '@/lib/external/box/redirect';
import { logActivity } from '@/lib/activity';

export const dynamic = 'force-dynamic';

const STATE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes — generous, OAuth is usually instant

function errorPage(message: string, detail?: string) {
  // Plain HTML so we don't depend on any layout — runs even if state was tampered.
  const safe = (s: string) => s.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const body = `<!doctype html><html><head><title>Box connect failed</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 480px; margin: 60px auto; color: #111;">
  <h1 style="font-size: 20px; margin-bottom: 8px;">Box connect failed</h1>
  <p style="color: #444; font-size: 14px;">${safe(message)}</p>
  ${detail ? `<pre style="background:#f5f5f5;padding:8px;border-radius:4px;font-size:12px;overflow:auto;">${safe(detail)}</pre>` : ''}
  <p style="font-size: 13px;"><a href="/files">Back to /files</a></p>
</body></html>`;
  return new NextResponse(body, { status: 400, headers: { 'Content-Type': 'text/html' } });
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');

  if (errorParam) {
    await logActivity({
      actorUserId: session.user.id,
      action: 'box.oauth_denied',
      payload: { error: errorParam, description: errorDescription },
      status: 'warn',
    });
    return errorPage(
      `Box returned an error: ${errorParam}`,
      errorDescription ?? undefined,
    );
  }

  if (!code || !state) {
    return errorPage('Missing code or state parameter.');
  }

  const stored = session.boxOauthState;
  if (!stored) {
    return errorPage('No pending Box connect request. Start over from /files.');
  }
  if (stored.state !== state) {
    return errorPage('State mismatch. Refusing to complete OAuth (possible CSRF).');
  }
  if (Date.now() - stored.issuedAt > STATE_MAX_AGE_MS) {
    return errorPage('OAuth state expired. Start over from /files.');
  }

  // State validated — clear it so it can't be replayed.
  const redirectAfter = stored.redirectAfter ?? '/files';
  delete session.boxOauthState;
  await session.save();

  const redirectUri = getBoxRedirectUri(request);

  let tokens;
  try {
    tokens = await exchangeCodeForTokens({ code, redirectUri });
  } catch (err) {
    await logActivity({
      actorUserId: session.user.id,
      action: 'box.oauth_exchange_failed',
      payload: { reason: err instanceof Error ? err.message : 'unknown' },
      status: 'error',
    });
    return errorPage(
      'Failed to exchange code for tokens with Box.',
      err instanceof Error ? err.message : undefined,
    );
  }

  let boxMe;
  try {
    boxMe = await getCurrentBoxUser(tokens.access_token);
  } catch (err) {
    return errorPage(
      'Got tokens from Box but /users/me failed.',
      err instanceof Error ? err.message : undefined,
    );
  }

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  // Upsert: replace any existing active row for this dashboard user.
  // (The unique partial index user_box_tokens_user_id_active_unique enforces one active link.)
  await db.transaction(async (tx) => {
    // Soft-delete any existing active row.
    await tx
      .update(userBoxTokens)
      .set({
        deletedAt: sql`NOW()`,
        updatedBy: 'box.oauth_callback',
      })
      .where(
        and(eq(userBoxTokens.userId, session.user!.id), isNull(userBoxTokens.deletedAt)),
      );

    // Insert the fresh row.
    await tx.insert(userBoxTokens).values({
      userId: session.user!.id,
      boxUserId: boxMe.id,
      boxLogin: boxMe.login,
      accessTokenEncrypted: encryptToken(tokens.access_token),
      refreshTokenEncrypted: encryptToken(tokens.refresh_token),
      expiresAt,
      createdBy: 'box.oauth_callback',
      updatedBy: 'box.oauth_callback',
    });
  });

  await logActivity({
    actorUserId: session.user.id,
    action: 'box.connected',
    entityType: 'user_box_token',
    payload: { box_user_id: boxMe.id, box_login: boxMe.login, expires_in: tokens.expires_in },
    status: 'ok',
  });

  return NextResponse.redirect(new URL(redirectAfter, request.url), { status: 302 });
}
