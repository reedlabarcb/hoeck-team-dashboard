/**
 * GET /api/realnex/contacts — search/list contacts from the RealNex MIRROR (READ-ONLY).
 *
 * Query params: ?q= (name/email search), ?companyKey= (filter to one company's contacts),
 * ?limit= (<=100), ?offset=. Reads local Postgres only — no live RealNex call. Powers the
 * /contacts list page (P3.5.3).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { searchContacts } from '@/lib/realnex/queries';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const url = new URL(request.url);
  const { contacts, total } = await searchContacts({
    q: url.searchParams.get('q') ?? undefined,
    companyKey: url.searchParams.get('companyKey') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
    offset: url.searchParams.get('offset') ?? undefined,
  });
  return NextResponse.json({ contacts, total });
}
