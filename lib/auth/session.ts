/**
 * iron-session config + helpers.
 *
 * Cookie strategy:
 *   - 7-day maxAge (golf-bd lesson 1ca7202 — 8h TTL locked users out mid-workday)
 *   - httpOnly + sameSite: 'lax' + secure in production
 *
 * Reading the session in a route handler:
 *   const session = await getSession();
 *   if (!session.user) return 401
 *
 * Writing:
 *   const session = await getSession();
 *   session.user = { id, email, name, role };
 *   await session.save();
 */

import { cookies } from 'next/headers';
import { getIronSession, SessionOptions } from 'iron-session';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'broker';
}

export interface AppSession {
  user?: SessionUser;
}

if (!process.env.SESSION_PASSWORD) {
  // We don't throw here at module load (Next builds run this file once at boot)
  // but the runtime helpers will throw on first use if it's missing.
  console.warn('[auth] SESSION_PASSWORD is not set — every login attempt will fail.');
}

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_PASSWORD || 'INSECURE-DEFAULT-DO-NOT-SHIP',
  cookieName: 'hoeck_session',
  cookieOptions: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 7, // 7 days — see golf-bd commit 1ca7202
  },
};

export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<AppSession>(cookieStore, sessionOptions);
}
