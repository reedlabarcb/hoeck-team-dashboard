/**
 * Edge proxy (was: middleware) — auth guard.
 *
 * Renamed for Next.js 16: the "middleware" file convention is deprecated in favor of "proxy".
 * Function export is also renamed `middleware` → `proxy` to match.
 *
 * Strategy:
 *   - Read the iron-session cookie at the edge.
 *   - If user is unauthenticated and visiting anything other than /login or /api/auth/*, redirect to /login.
 *   - If user is authenticated and visiting /login, redirect to /.
 *   - /api/* requests that fail auth get a 401 JSON response (consumed by the global fetch wrapper).
 *
 * Lineage: golf-bd 1ca7202 — global 401 handling instead of cryptic errors in components.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getIronSession } from 'iron-session';
import { sessionOptions, type AppSession } from '@/lib/auth/session';

// Routes that don't require auth (login page + auth API + static assets are handled by matcher).
const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/auth/logout', '/api/health'];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths.
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  // Read session. iron-session v8 reads/writes cookies via the Next request/response objects.
  const response = NextResponse.next();
  const session = await getIronSession<AppSession>(request, response, sessionOptions);

  if (!session.user) {
    // For API routes return JSON 401 (so the global fetch wrapper can reload).
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    // For pages, redirect to /login with a return URL.
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('redirect', pathname);
    return NextResponse.redirect(url);
  }

  // Authenticated user trying to hit /login — bounce them home.
  if (pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  return response;
}

// Matcher: run middleware on everything except Next.js internals and static files.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico)$).*)'],
};
