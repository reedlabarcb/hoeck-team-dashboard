/**
 * GET /api/realnex/query — the Master Query VIEW (P3.11). Parses the stackable filter params and runs
 * the paginated view query against the mirror (READ-ONLY). Powers the /query page.
 *
 * Params: ?entity=companies|contacts & q & lxdFrom & lxdTo & sfMin & sfMax & city & state & address &
 * flags (comma-sep) & group. EVERY param is parsed in parseQueryFilters and the whole object is handed
 * to runQuery — deliberately routed through one parser so no dimension can be silently dropped at the
 * boundary (the bug that killed the /companies group filter). route.test.ts asserts all params forward.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { runQuery } from '@/lib/realnex/queries';
import { parseQueryFilters } from '@/lib/realnex/query-filters';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const filters = parseQueryFilters(new URL(request.url).searchParams);
  const { rows, total } = await runQuery(filters); // view query: paginated (first 100) + count(*)
  return NextResponse.json({ rows, total, entity: filters.entity });
}
