/**
 * GET /api/box/folder-chain?id=<box_id>
 *
 * Returns the ancestor chain from the root down to <box_id>, inclusive.
 * Used by /files to render the breadcrumb when navigating directly to a deep URL
 * (e.g., /files?folder=<deep_id>) — without this we'd have to walk the parents one
 * round-trip at a time.
 *
 * If id is omitted: returns just the root row (one entry: Tenants – ChapmanHoeck).
 * If id is unknown: returns 404.
 *
 * Implementation: recursive CTE on box_folder_index. Soft-deleted rows excluded.
 * Always one query, regardless of depth.
 */

import { NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface ChainRow {
  box_id: string;
  name: string;
  parent_box_id: string | null;
  depth: number;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  if (!id) {
    // Return just the root row (parent_box_id IS NULL).
    const rootResult = await db.execute(sql`
      SELECT box_id, name, parent_box_id, depth
      FROM box_folder_index
      WHERE parent_box_id IS NULL AND deleted_at IS NULL
      ORDER BY depth ASC
      LIMIT 1
    `);
    const root = rootResult.rows[0] as unknown as ChainRow | undefined;
    return NextResponse.json({ chain: root ? [root] : [] });
  }

  const chainResult = await db.execute(sql`
    WITH RECURSIVE chain AS (
      SELECT box_id, name, parent_box_id, depth
      FROM box_folder_index
      WHERE box_id = ${id} AND deleted_at IS NULL
      UNION ALL
      SELECT p.box_id, p.name, p.parent_box_id, p.depth
      FROM box_folder_index p
      JOIN chain c ON p.box_id = c.parent_box_id
      WHERE p.deleted_at IS NULL
    )
    SELECT box_id, name, parent_box_id, depth FROM chain ORDER BY depth ASC
  `);

  const rows = chainResult.rows as unknown as ChainRow[];
  if (rows.length === 0) {
    return NextResponse.json({ error: 'folder_not_in_index', id }, { status: 404 });
  }
  return NextResponse.json({ chain: rows });
}
