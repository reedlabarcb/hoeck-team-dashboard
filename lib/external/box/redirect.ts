/**
 * Compute the Box OAuth redirect URI for a given request.
 *
 * Box requires the redirect_uri sent to /authorize to EXACTLY match the redirect_uri
 * sent to /token (the callback exchange). Both must be one of the URIs registered
 * in the Box Developer Console.
 *
 * Registered URIs (Box Developer Console):
 *   - https://hoeck-team-dashboard-production.up.railway.app/api/auth/box/callback
 *   - http://localhost:3000/api/auth/box/callback
 *
 * We derive from the request's own origin so local dev and prod both work.
 */

import type { NextRequest } from 'next/server';

export function getBoxRedirectUri(request: NextRequest): string {
  const url = new URL(request.url);
  // Honor X-Forwarded-Proto / X-Forwarded-Host if Railway sets them (it does).
  const proto = request.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '');
  const host = request.headers.get('x-forwarded-host') ?? url.host;
  return `${proto}://${host}/api/auth/box/callback`;
}
