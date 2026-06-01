/**
 * GET /api/box/folders?parent=<boxId>&q=<search>
 *
 * Returns rows from box_folder_index for a given parent folder, optionally filtered by query.
 * - If `parent` is omitted, returns CHILDREN of the indexed root (the row whose
 *   parent_box_id IS NULL). Without this, /files at the root URL would show the root
 *   folder itself as a single table row, duplicating what the breadcrumb already says.
 * - If `parent` is present, returns children of that folder.
 * - If `q` is present, returns name-matches across the whole tree (not scoped to parent).
 *
 * UI uses this to render the file browser at /files.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, asc, eq, ilike, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { boxFolderIndex } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const parent = url.searchParams.get('parent');
  const q = url.searchParams.get('q')?.trim();

  const conditions = [isNull(boxFolderIndex.deletedAt)];

  if (q) {
    // Search mode: cross-tree name match. Not scoped to parent.
    conditions.push(ilike(boxFolderIndex.name, `%${q}%`));
  } else if (parent) {
    // Explicit parent: return its children.
    conditions.push(eq(boxFolderIndex.parentBoxId, parent));
  } else {
    // No parent param: return children of the indexed root.
    // We resolve the root's box_id in a quick pre-query, then filter children to it.
    // (Empty index → no root row → return empty list; UI shows "click Refresh from Box".)
    const rootResult = await db
      .select({ boxId: boxFolderIndex.boxId })
      .from(boxFolderIndex)
      .where(and(isNull(boxFolderIndex.parentBoxId), isNull(boxFolderIndex.deletedAt)))
      .limit(1);
    if (rootResult.length === 0) {
      return NextResponse.json({ entries: [] });
    }
    conditions.push(eq(boxFolderIndex.parentBoxId, rootResult[0].boxId));
  }

  const rows = await db
    .select({
      id: boxFolderIndex.id,
      boxId: boxFolderIndex.boxId,
      boxType: boxFolderIndex.boxType,
      name: boxFolderIndex.name,
      parentBoxId: boxFolderIndex.parentBoxId,
      depth: boxFolderIndex.depth,
      pathSegments: boxFolderIndex.pathSegments,
      boxModifiedAt: boxFolderIndex.boxModifiedAt,
      sizeBytes: boxFolderIndex.sizeBytes,
      webLinkUrl: boxFolderIndex.webLinkUrl,
      isSubleaseShortcut: boxFolderIndex.isSubleaseShortcut,
      yearStart: boxFolderIndex.yearStart,
      yearEnd: boxFolderIndex.yearEnd,
      dealType: boxFolderIndex.dealType,
      address: boxFolderIndex.address,
      clientFolderName: boxFolderIndex.clientFolderName,
      isMtClient: boxFolderIndex.isMtClient,
      marketSubfolder: boxFolderIndex.marketSubfolder,
      lastSeenAt: boxFolderIndex.lastSeenAt,
    })
    .from(boxFolderIndex)
    .where(and(...conditions))
    .orderBy(
      // Folders first, then files; within type, by name.
      asc(boxFolderIndex.boxType),
      asc(boxFolderIndex.name),
    )
    .limit(500);

  return NextResponse.json({ entries: rows });
}
