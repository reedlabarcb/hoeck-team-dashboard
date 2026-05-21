/**
 * GET /api/auth/box/connect
 *
 * Kicks off the Box OAuth dance. Behavior:
 *   1. Require a logged-in dashboard user (else 401 — proxy.ts already enforces this)
 *   2. Generate a CSRF state token, store in iron-session
 *   3. Redirect to Box's authorize URL with our redirect_uri + state
 *   4. (Box shows consent screen → user clicks Allow → Box redirects to /callback)
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { getSession } from '@/lib/auth/session';
import { getAuthorizeUrl } from '@/lib/external/box/oauth';
import { getBoxRedirectUri } from '@/lib/external/box/redirect';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const state = randomBytes(32).toString('base64url');
  const url = new URL(request.url);
  const redirectAfter = url.searchParams.get('redirect') ?? '/files';

  session.boxOauthState = {
    state,
    issuedAt: Date.now(),
    redirectAfter,
  };
  await session.save();

  const redirectUri = getBoxRedirectUri(request);
  const authorizeUrl = getAuthorizeUrl({ state, redirectUri });
  return NextResponse.redirect(authorizeUrl, { status: 302 });
}
