/**
 * GET /api/realnex/contacts/companies — distinct companies that HAVE contacts, from the
 * MIRROR (READ-ONLY). Returns {key, name}[] ordered by name, for the /contacts page's
 * company-filter dropdown. `key` is the company's RealNex key (exact-match filter, not fuzzy).
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { listContactCompanies } from '@/lib/realnex/queries';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const companies = await listContactCompanies();
  return NextResponse.json({ companies });
}
