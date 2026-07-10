/**
 * GET /api/realnex/groups — list RealNex groups from the mirror (READ-ONLY), for the
 * companies/contacts list-page group filter dropdown. Returns {key, name}[] ordered by name.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { listGroups } from '@/lib/realnex/queries';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const groups = await listGroups();
  return NextResponse.json({ groups });
}
