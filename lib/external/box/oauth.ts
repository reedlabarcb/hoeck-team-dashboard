/**
 * Box OAuth 2.0 client.
 *
 * Box endpoints (from https://developer.box.com/reference/get-authorize/):
 *   - Authorize:    https://account.box.com/api/oauth2/authorize
 *   - Token:        https://api.box.com/oauth2/token
 *   - Current user: https://api.box.com/2.0/users/me
 *
 * Token lifetimes:
 *   - access_token:  60 minutes
 *   - refresh_token: 60 days; rotated forward each time it's used
 *
 * Refresh token rotation is critical: Box returns a NEW refresh_token on every refresh.
 * We must replace the stored value or the previous refresh token gets blacklisted after
 * the new one is issued. Our refreshAccessToken() always returns both new tokens
 * so the caller can persist them.
 */

const AUTHORIZE_URL = 'https://account.box.com/api/oauth2/authorize';
const TOKEN_URL = 'https://api.box.com/oauth2/token';
const ME_URL = 'https://api.box.com/2.0/users/me';

export interface BoxTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: 'bearer';
  expires_in: number; // seconds, typically 3600
}

export interface BoxMe {
  id: string;
  type: 'user';
  login: string;
  name?: string;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

/**
 * Build the Box authorize URL. The user is redirected here from /api/auth/box/connect.
 * After they consent, Box redirects to redirectUri with ?code=... + ?state=...
 */
export function getAuthorizeUrl(opts: { state: string; redirectUri: string }): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: requireEnv('BOX_CLIENT_ID'),
    redirect_uri: opts.redirectUri,
    state: opts.state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * Trade the one-time `code` Box sent us for an access_token + refresh_token pair.
 * Called from /api/auth/box/callback.
 */
export async function exchangeCodeForTokens(opts: {
  code: string;
  redirectUri: string;
}): Promise<BoxTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: opts.code,
    client_id: requireEnv('BOX_CLIENT_ID'),
    client_secret: requireEnv('BOX_CLIENT_SECRET'),
    redirect_uri: opts.redirectUri,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Box token exchange failed: HTTP ${res.status} — ${text}`);
  }
  return (await res.json()) as BoxTokenResponse;
}

/**
 * Exchange a refresh_token for a fresh access_token + refresh_token pair.
 * Box rotates the refresh_token on every call — caller MUST persist the new value
 * or the next refresh will fail.
 */
export async function refreshAccessToken(refreshToken: string): Promise<BoxTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: requireEnv('BOX_CLIENT_ID'),
    client_secret: requireEnv('BOX_CLIENT_SECRET'),
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Box token refresh failed: HTTP ${res.status} — ${text}`);
  }
  return (await res.json()) as BoxTokenResponse;
}

/**
 * Identify the Box user a given access_token belongs to.
 * Used after exchangeCodeForTokens so we can store box_user_id alongside the tokens.
 */
export async function getCurrentBoxUser(accessToken: string): Promise<BoxMe> {
  const res = await fetch(ME_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Box /users/me failed: HTTP ${res.status} — ${text}`);
  }
  return (await res.json()) as BoxMe;
}
