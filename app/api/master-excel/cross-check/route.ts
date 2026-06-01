/**
 * GET /api/master-excel/cross-check?client=<name>&address=<addr>
 *
 * "Cross-check vs. lease PDF" — for a Master Excel row, find the underlying lease
 * in box_folder_index and return the Box URL of the most recent file in its
 * Lease Documents subfolder.
 *
 * Lookup algorithm:
 *   1. Find rows in box_folder_index where:
 *        - boxType = 'folder'
 *        - dealType = 'Acquisition'
 *        - clientFolderName ILIKE %client%
 *        - AND ((address ILIKE %addr%) OR (name ILIKE %addr%))
 *   2. Among those, find the most recent (by box_modified_at) "Lease Documents"
 *      subfolder.
 *   3. Inside it, find the most recently modified file whose name suggests a
 *      fully-executed lease ("executed", "fully executed", or just newest .pdf).
 *   4. Return the Box file URL.
 *
 * If any step fails, return a soft response with `match: false` + the closest
 * candidate folders so the UI can show "couldn't auto-find — here are the
 * candidates" and let the user click through.
 *
 * Auth-required.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, ilike, inArray, isNotNull, isNull, or } from 'drizzle-orm';
import { db } from '@/lib/db';
import { boxFolderIndex } from '@/lib/db/schema';
import { getSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

function boxFolderUrl(boxId: string) {
  return `https://cbre.box.com/folder/${boxId}`;
}
function boxFileUrl(boxId: string) {
  return `https://cbre.box.com/file/${boxId}`;
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const client = url.searchParams.get('client')?.trim();
  const address = url.searchParams.get('address')?.trim();

  if (!client) {
    return NextResponse.json(
      { error: 'missing_client', message: '?client param is required' },
      { status: 400 },
    );
  }

  // Step 1: candidate deal folders for the client.
  const dealFolderConditions = [
    isNull(boxFolderIndex.deletedAt),
    eq(boxFolderIndex.boxType, 'folder'),
    eq(boxFolderIndex.dealType, 'Acquisition'),
    ilike(boxFolderIndex.clientFolderName, `%${client}%`),
  ];
  if (address) {
    dealFolderConditions.push(
      // Match address column when it parsed, OR raw folder name (the convention
      // includes the address at the tail: "2026 - Lease Acquisition - 350 10th Ave").
      or(
        ilike(boxFolderIndex.address, `%${address}%`),
        ilike(boxFolderIndex.name, `%${address}%`),
      )!,
    );
  }
  const candidateDeals = await db
    .select({
      boxId: boxFolderIndex.boxId,
      name: boxFolderIndex.name,
      pathSegments: boxFolderIndex.pathSegments,
      address: boxFolderIndex.address,
      yearStart: boxFolderIndex.yearStart,
      yearEnd: boxFolderIndex.yearEnd,
      clientFolderName: boxFolderIndex.clientFolderName,
      boxModifiedAt: boxFolderIndex.boxModifiedAt,
    })
    .from(boxFolderIndex)
    .where(and(...dealFolderConditions))
    .orderBy(desc(boxFolderIndex.boxModifiedAt))
    .limit(10);

  if (candidateDeals.length === 0) {
    return NextResponse.json({
      match: false,
      reason: 'no_deal_folder_found',
      message: `No "Lease Acquisition" folder matched client="${client}"${address ? ` address="${address}"` : ''} in the local Box index. Make sure /files has been refreshed recently.`,
      candidates: [],
    });
  }

  // Step 2: for each candidate, look for a "Lease Documents" subfolder.
  // (Most folders use "Lease Document(s)" plural; tolerate both.)
  const dealBoxIds = candidateDeals.map((c) => c.boxId);
  const leaseDocFolders = await db
    .select({
      boxId: boxFolderIndex.boxId,
      name: boxFolderIndex.name,
      parentBoxId: boxFolderIndex.parentBoxId,
      pathSegments: boxFolderIndex.pathSegments,
      boxModifiedAt: boxFolderIndex.boxModifiedAt,
    })
    .from(boxFolderIndex)
    .where(
      and(
        isNull(boxFolderIndex.deletedAt),
        eq(boxFolderIndex.boxType, 'folder'),
        ilike(boxFolderIndex.name, '%lease document%'),
        inArray(boxFolderIndex.parentBoxId, dealBoxIds),
      ),
    );

  if (leaseDocFolders.length === 0) {
    return NextResponse.json({
      match: false,
      reason: 'no_lease_documents_folder',
      message: 'Found candidate deal folder(s) but no "Lease Document(s)" subfolder inside.',
      candidates: candidateDeals.map((c) => ({
        kind: 'deal_folder',
        boxId: c.boxId,
        name: c.name,
        url: boxFolderUrl(c.boxId),
        path: c.pathSegments,
      })),
    });
  }

  // Step 3: find the most recently modified file inside any of the lease-doc folders.
  // Prefer files whose name hints at a fully-executed lease.
  const leaseDocBoxIds = leaseDocFolders.map((f) => f.boxId);
  const leaseFiles = await db
    .select({
      boxId: boxFolderIndex.boxId,
      name: boxFolderIndex.name,
      parentBoxId: boxFolderIndex.parentBoxId,
      pathSegments: boxFolderIndex.pathSegments,
      boxModifiedAt: boxFolderIndex.boxModifiedAt,
      sizeBytes: boxFolderIndex.sizeBytes,
    })
    .from(boxFolderIndex)
    .where(
      and(
        isNull(boxFolderIndex.deletedAt),
        eq(boxFolderIndex.boxType, 'file'),
        inArray(boxFolderIndex.parentBoxId, leaseDocBoxIds),
        isNotNull(boxFolderIndex.boxModifiedAt),
      ),
    )
    .orderBy(desc(boxFolderIndex.boxModifiedAt))
    .limit(20);

  // Score: any file whose name contains "executed" wins over otherwise more-recent files.
  // Among same-tier matches, most recent wins.
  const scored = leaseFiles
    .map((f) => ({
      ...f,
      score: /fully ?executed|executed/i.test(f.name) ? 2 : /lease/i.test(f.name) ? 1 : 0,
    }))
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      const aT = a.boxModifiedAt ? new Date(a.boxModifiedAt).getTime() : 0;
      const bT = b.boxModifiedAt ? new Date(b.boxModifiedAt).getTime() : 0;
      return bT - aT;
    });

  const best = scored[0];
  if (!best) {
    return NextResponse.json({
      match: false,
      reason: 'no_files_in_lease_documents',
      message: 'Lease Documents folder is empty — has the lease been filed yet?',
      candidates: leaseDocFolders.map((f) => ({
        kind: 'lease_documents_folder',
        boxId: f.boxId,
        name: f.name,
        url: boxFolderUrl(f.boxId),
        path: f.pathSegments,
      })),
    });
  }

  return NextResponse.json({
    match: true,
    file: {
      boxId: best.boxId,
      name: best.name,
      url: boxFileUrl(best.boxId),
      path: best.pathSegments,
      modifiedAt: best.boxModifiedAt,
      sizeBytes: best.sizeBytes,
      executed: best.score === 2,
    },
    dealFolder: {
      boxId: candidateDeals[0].boxId,
      name: candidateDeals[0].name,
      url: boxFolderUrl(candidateDeals[0].boxId),
      path: candidateDeals[0].pathSegments,
    },
  });
}
