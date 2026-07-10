/**
 * GET /api/realnex/resolve — the SHARED entity resolver over the mirror (READ-ONLY).
 *
 * Query params: ?q= (required search term), ?type=contact|company|both (default both),
 * ?limit= (<=100, default 10). Returns { results: EntityResult[] } ranked prefix-first.
 *
 * This is what <RealNexEntitySearch> (the P3.5.4 typeahead) hits per debounced keystroke, and
 * it's the same resolver P3.6 note-logging relies on: every result carries `key` = the RealNex
 * OBJECT KEY that appendActivity will POST history to. Reads local Postgres only — no live
 * RealNex call per keystroke.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { resolveEntities } from '@/lib/realnex/queries';

export const dynamic = 'force-dynamic';

function parseType(raw: string | null): 'contact' | 'company' | 'both' {
  return raw === 'contact' || raw === 'company' ? raw : 'both';
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const url = new URL(request.url);
  const results = await resolveEntities({
    q: url.searchParams.get('q') ?? '',
    type: parseType(url.searchParams.get('type')),
    limit: url.searchParams.get('limit') ?? undefined,
  });
  return NextResponse.json({ results });
}
