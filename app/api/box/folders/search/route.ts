/**
 * GET /api/box/folders/search?q=<query>
 *
 * Combined search endpoint backing the /files page's unified search input.
 * Returns BOTH:
 *   - filename matches (ILIKE on box_folder_index.name, cross-tree)
 *   - PDF content matches (FTS on extracted_text_tsvector, cross-tree, ranked, snippeted)
 *
 * Response shape:
 *   {
 *     query: string,
 *     filenames: [ ...same row shape as /api/box/folders ... ],
 *     contents:  [ ...same row shape PLUS match_snippet + match_rank ... ],
 *   }
 *
 * Mode selection rationale (vs. having the UI do two parallel fetches): the UI's
 * "two sections" view is the only consumer of this combined shape, and putting
 * the join in one server roundtrip keeps the network simpler. /api/box/folders
 * remains the lower-level primitive — direct callers (cron, scripts, future API
 * integrations) still hit the per-mode endpoint.
 *
 * The two sub-queries are wired in parallel — total latency = max(filename, content)
 * not sum. Both branches degrade gracefully: if FTS returns empty, the UI just
 * shows "no content matches"; if filename returns empty, the UI just shows "no
 * name matches."
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, asc, eq, ilike, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { boxFolderIndex } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

const FILENAME_LIMIT = 100;
const CONTENT_LIMIT = 50;
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
  const q = url.searchParams.get('q')?.trim();

  if (!q) {
    return NextResponse.json({ query: '', filenames: [], contents: [] });
  }

  // Run both queries in parallel — no shared rows are expected (filename != content)
  // so we don't need to dedupe.
  const [filenameRows, contentResult] = await Promise.all([
    db
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
      .where(and(isNull(boxFolderIndex.deletedAt), ilike(boxFolderIndex.name, `%${q}%`)))
      .orderBy(asc(boxFolderIndex.boxType), asc(boxFolderIndex.name))
      .limit(FILENAME_LIMIT),
    db.execute(sql`
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
          plainto_tsquery('english', ${q}),
          ${TS_HEADLINE_OPTIONS}
        ) AS match_snippet,
        ts_rank_cd(extracted_text_tsvector, plainto_tsquery('english', ${q})) AS match_rank
      FROM box_folder_index
      WHERE deleted_at IS NULL
        AND box_type = 'file'
        AND extraction_status = 'extracted'
        AND extracted_text_tsvector @@ plainto_tsquery('english', ${q})
      ORDER BY match_rank DESC, box_modified_at DESC NULLS LAST
      LIMIT ${CONTENT_LIMIT}
    `),
  ]);

  const contents = (contentResult.rows as unknown as ContentMatchRow[]).map((r) => ({
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

  return NextResponse.json({ query: q, filenames: filenameRows, contents });
}
