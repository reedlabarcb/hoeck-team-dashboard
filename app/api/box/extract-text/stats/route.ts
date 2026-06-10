/**
 * GET /api/box/extract-text/stats
 *
 * Aggregate stats for the /files page status banner:
 *
 *   "PDF content search: N files indexed of M total. Last extraction run: X ago."
 *
 * Returns:
 *   {
 *     totalPdfs:        int,    // count of box_folder_index rows that are PDFs
 *     extracted:        int,
 *     pending:          int,
 *     failed:           int,
 *     skippedScanned:   int,
 *     skippedTooLarge:  int,
 *     nullStatus:       int,    // PDFs with extraction_status IS NULL — Commit 7 backfills these to 'pending'
 *     lastRunCompletedAt: string | null,
 *     lastRunJobId:       string | null,
 *   }
 *
 * The UI uses `extracted / totalPdfs` for the headline number and shows the
 * full breakdown on hover. `lastRunCompletedAt` powers the "last extraction
 * run: X ago" relative-time label.
 *
 * Performance: aggregate query over box_folder_index. With ~10k PDFs in the
 * index, scan is ~10ms; future optimization could add a partial index on
 * `(extraction_status) WHERE box_type='file' AND name ILIKE '%.pdf'`.
 */

import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

interface StatsRow {
  total_pdfs: number;
  extracted: number;
  pending: number;
  failed: number;
  skipped_scanned: number;
  skipped_too_large: number;
  null_status: number;
}

interface LatestRunRow {
  id: string;
  completed_at: string | null;
}

export async function GET() {
  const session = await getSession();
  if (!session.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // One scan, six counts — cheaper than six COUNT queries.
  const statsResult = await db.execute(sql`
    SELECT
      count(*)::int AS total_pdfs,
      count(*) FILTER (WHERE extraction_status = 'extracted')::int          AS extracted,
      count(*) FILTER (WHERE extraction_status = 'pending')::int            AS pending,
      count(*) FILTER (WHERE extraction_status = 'failed')::int             AS failed,
      count(*) FILTER (WHERE extraction_status = 'skipped_scanned')::int    AS skipped_scanned,
      count(*) FILTER (WHERE extraction_status = 'skipped_too_large')::int  AS skipped_too_large,
      count(*) FILTER (WHERE extraction_status IS NULL)::int                AS null_status
    FROM box_folder_index
    WHERE deleted_at IS NULL
      AND box_type = 'file'
      AND name ILIKE '%.pdf'
  `);
  const s = statsResult.rows[0] as unknown as StatsRow;

  const latestResult = await db.execute(sql`
    SELECT id::text, completed_at::text
    FROM box_sync_jobs
    WHERE job_type = 'text_extraction'
      AND status = 'completed'
      AND deleted_at IS NULL
    ORDER BY completed_at DESC NULLS LAST
    LIMIT 1
  `);
  const latest = latestResult.rows[0] as unknown as LatestRunRow | undefined;

  return NextResponse.json({
    totalPdfs: s.total_pdfs,
    extracted: s.extracted,
    pending: s.pending,
    failed: s.failed,
    skippedScanned: s.skipped_scanned,
    skippedTooLarge: s.skipped_too_large,
    nullStatus: s.null_status,
    lastRunCompletedAt: latest?.completed_at ?? null,
    lastRunJobId: latest?.id ?? null,
  });
}
