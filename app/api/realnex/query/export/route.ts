/**
 * GET /api/realnex/query/export — the Master Query EXCEL EXPORT (P3.11 Step 3). Parses the SAME filter
 * params as the view route (reuses parseQueryFilters, so the export matches exactly what's on screen),
 * runs the UNCAPPED export query, flattens the rows, and streams a 3-sheet .xlsx (openpyxl, server-side).
 * READ-ONLY; wrapper stays 13.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { runQueryExport } from '@/lib/realnex/queries';
import { parseQueryFilters } from '@/lib/realnex/query-filters';
import { buildExportRows, generateQueryWorkbook } from '@/lib/realnex/query-export';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const filters = parseQueryFilters(new URL(request.url).searchParams);
  const { rows } = await runQueryExport(filters);
  const records = buildExportRows(rows, filters.entity);
  const generatedDate = new Date().toISOString().slice(0, 10);
  const buf = await generateQueryWorkbook({ entity: filters.entity, generatedDate, records });
  const filename = `master-query-${filters.entity}-${generatedDate}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
