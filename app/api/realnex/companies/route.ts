/**
 * GET /api/realnex/companies — search/list companies from the RealNex MIRROR (READ-ONLY).
 *
 * Query params: ?q= (name search), ?limit= (<=100), ?offset=. Reads local Postgres only —
 * no live RealNex call. Powers the /companies list page (P3.5.2).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { searchCompanies } from '@/lib/realnex/queries';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const url = new URL(request.url);
  const { companies, total } = await searchCompanies({
    q: url.searchParams.get('q') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
    offset: url.searchParams.get('offset') ?? undefined,
  });
  return NextResponse.json({ companies, total });
}
