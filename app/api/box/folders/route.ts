/**
 * GET /api/box/folders?parent=<boxId>&q=<search>
 *
 * Returns rows from box_folder_index for a given parent folder, optionally filtered by query.
 * - If `parent` is omitted, returns rows where parent_box_id IS NULL (the root row).
 * - If `q` is present, returns matches across the whole tree (not scoped to parent).
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
    conditions.push(ilike(boxFolderIndex.name, `%${q}%`));
  } else if (parent) {
    conditions.push(eq(boxFolderIndex.parentBoxId, parent));
  } else {
    conditions.push(isNull(boxFolderIndex.parentBoxId));
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
