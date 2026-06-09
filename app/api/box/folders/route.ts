/**
 * GET /api/box/folders?parent=<boxId>&q=<filename>&content=<full-text>
 *
 * Three search modes (mutually exclusive — checked in this order):
 *   1. ?content=<phrase>  — full-text search across PDF text using the
 *                           extracted_text_tsvector GENERATED column (Phase 2.5a).
 *                           Cross-tree. Returns top 50 ranked matches with
 *                           ts_headline-highlighted snippets.
 *   2. ?q=<query>          — case-insensitive filename ILIKE match. Cross-tree.
 *   3. ?parent=<boxId>     — children of a specific folder.
 *   4. (none)              — children of the indexed root (the row with parent_box_id IS NULL).
 *                            Empty index → empty list; UI prompts to refresh.
 *
 * Response shape:
 *   { entries: [
 *       { id, boxId, boxType, name, ...,  // same shape across all modes
 *         match_snippet: "<mark>...</mark>",  // ONLY when ?content= matched this row
 *         match_rank: 0.123 }                 // ONLY when ?content= matched this row
 *     ]
 *   }
 *
 * Performance: the GIN index on extracted_text_tsvector (migration 0005) makes
 * the content branch sub-100ms even at 10k indexed PDFs.
 *
 * UI uses this to render the file browser at /files. Phase 2.5a Commit 6 adds
 * a higher-level /api/box/folders/search endpoint that combines q + content
 * into the two-section search UI.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, asc, eq, ilike, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { boxFolderIndex } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

// Limit content-search results — Postgres FTS can return thousands of hits;
// users only ever look at the top-ranked few.
const CONTENT_SEARCH_LIMIT = 50;

// ts_headline options. Wrap matched lexemes in <mark> so the UI can style the
// hit. 10-30 word window: long enough to be readable, short enough to fit
// comfortably in a list item.
const TS_HEADLINE_OPTIONS =
  'StartSel=<mark>, StopSel=</mark>, MaxWords=30, MinWords=10, ShortWord=3, HighlightAll=false';

interface ContentMatchRow {
  id: string;
  box_id: string;
  box_type: 'file' | 'folder' | 'web_link';
  name: string;
  parent_box_id: string | null;
  depth: number;
  path_segments: string[];
  box_modified_at: string | null;
  size_bytes: number | null;
  web_link_url: string | null;
  is_sublease_shortcut: boolean;
  year_start: number | null;
  year_end: number | null;
  deal_type: string | null;
  address: string | null;
  client_folder_name: string | null;
  is_mt_client: boolean;
  market_subfolder: string | null;
  last_seen_at: string;
  match_snippet: string;
  match_rank: number;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const parent = url.searchParams.get('parent');
  const q = url.searchParams.get('q')?.trim();
  const content = url.searchParams.get('content')?.trim();

  // ----- Mode 1: full-text content search (highest priority) -----
  if (content) {
    // plainto_tsquery handles user input safely (no operators to escape).
    // ts_rank_cd is "cover density" — weights matches by proximity, which beats
    // plain ts_rank for finding the most relevant lease passage.
    // The GIN index on extracted_text_tsvector makes the @@ match index-driven.
    const result = await db.execute(sql`
      SELECT
        id::text,
        box_id,
        box_type,
        name,
        parent_box_id,
        depth,
        path_segments,
        box_modified_at,
        size_bytes,
        web_link_url,
        is_sublease_shortcut,
        year_start,
        year_end,
        deal_type,
        address,
        client_folder_name,
        is_mt_client,
        market_subfolder,
        last_seen_at,
        ts_headline(
          'english',
          extracted_text,
          plainto_tsquery('english', ${content}),
          ${TS_HEADLINE_OPTIONS}
        ) AS match_snippet,
        ts_rank_cd(extracted_text_tsvector, plainto_tsquery('english', ${content})) AS match_rank
      FROM box_folder_index
      WHERE deleted_at IS NULL
        AND box_type = 'file'
        AND extraction_status = 'extracted'
        AND extracted_text_tsvector @@ plainto_tsquery('english', ${content})
      ORDER BY match_rank DESC, box_modified_at DESC NULLS LAST
      LIMIT ${CONTENT_SEARCH_LIMIT}
    `);

    const entries = (result.rows as unknown as ContentMatchRow[]).map((r) => ({
      id: r.id,
      boxId: r.box_id,
      boxType: r.box_type,
      name: r.name,
      parentBoxId: r.parent_box_id,
      depth: r.depth,
      pathSegments: r.path_segments,
      boxModifiedAt: r.box_modified_at,
      sizeBytes: r.size_bytes,
      webLinkUrl: r.web_link_url,
      isSubleaseShortcut: r.is_sublease_shortcut,
      yearStart: r.year_start,
      yearEnd: r.year_end,
      dealType: r.deal_type,
      address: r.address,
      clientFolderName: r.client_folder_name,
      isMtClient: r.is_mt_client,
      marketSubfolder: r.market_subfolder,
      lastSeenAt: r.last_seen_at,
      match_snippet: r.match_snippet,
      match_rank: Number(r.match_rank),
    }));

    return NextResponse.json({ entries });
  }

  // ----- Modes 2/3/4: existing behavior, unchanged -----
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
