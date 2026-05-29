/**
 * Folder walker — BFS through the Tenants – ChapmanHoeck tree and populate box_folder_index.
 *
 * Strategy:
 *   - Start at BOX_TENANTS_CHAPMANHOECK_FOLDER_ID
 *   - listFolder() each folder; for each child, upsert into box_folder_index
 *   - For folders, queue them for BFS exploration
 *   - For web_link items inside a client folder named "Lease Disposition" or pointed at the
 *     master sublease folder, flag is_sublease_shortcut = true
 *   - Tag every row with the same last_walk_run_id (a UUID we generate at start) so callers
 *     can later see which rows were updated by this walk vs. which are stale
 *   - Upsert idempotent: ON CONFLICT (box_id) DO UPDATE everything but createdAt + id
 *
 * Throttling:
 *   - Box rate-limits free apps at ~1000 calls/min. With a few hundred folders, one walk
 *     should complete in <60 seconds. If we hit 429, we back off and retry.
 *
 * Identity:
 *   - Walks as a specific dashboard user (the user whose Box token we use). The walker is
 *     usually invoked by /api/box/reindex (the calling user) or by the nightly sync cron
 *     (which picks the most-recently-active user_box_tokens row).
 */

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { boxFolderIndex, systemState, SYSTEM_STATE_KEYS } from '@/lib/db/schema';
import { listFolder, getFolder } from './safe';
import { parseDealFolderName, isMtClient } from './folder-name-parser';
import type { JobContext } from './job-runner';

const MASTER_SUBLEASE_KEYWORDS = ['Sublease Listings', 'sublease-listings', 'Master Sublease'];

export interface WalkResult {
  walkId: string;
  rootFolderId: string;
  rootFolderName: string | null;
  indexedCount: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

interface QueueItem {
  boxId: string;
  parentBoxId: string | null;
  depth: number;
  pathSegments: string[];
  clientFolderName: string | null;
  isMtClient: boolean;
  marketSubfolder: string | null;
}

/**
 * Walk the tree rooted at `rootFolderId` as `userId`, upserting every item into box_folder_index.
 * `maxDepth` defaults to 6 — plenty for the team's folder convention (Client / [Market] / Deal / Subfolder / file).
 */
export async function walkBoxTree(opts: {
  userId: string;
  rootFolderId: string;
  maxDepth?: number;
  /**
   * If set, stop after N items. Useful for first-time deploy smoke tests.
   * Undefined = walk everything.
   */
  maxItems?: number;
  /**
   * When invoked by the async job runner: receives progress callbacks AND reuses the
   * job's walkId so box_folder_index.last_walk_run_id correlates with box_sync_jobs.walk_id.
   * When omitted (legacy direct invocation): walker mints its own walkId, no callbacks fire.
   */
  jobContext?: JobContext;
  /**
   * Earliest box modified_at to walk into during incremental sync. Folders whose
   * modified_at is older than this are skipped (their subtree is assumed unchanged).
   * Undefined = full walk (everything).
   *
   * NOTE: Files inside a folder are still indexed via listFolder regardless of this filter —
   *       we only skip RECURSING INTO unchanged subfolders, not seeing them. So if Mike
   *       drops a new PDF inside an old deal folder, the listFolder call on the parent
   *       still sees it on the next sync.
   *
   *       The "incremental" path therefore catches: new+modified files anywhere, new+modified
   *       subfolders, and any descendants of modified folders. It does NOT catch deletions
   *       (those need a full walk, scheduled weekly by the Railway cron).
   */
  incrementalSince?: Date;
}): Promise<WalkResult> {
  const { userId, rootFolderId, maxDepth = 6, maxItems, jobContext, incrementalSince } = opts;
  // If running under a job, use the job's walkId so we can correlate. Otherwise mint our own.
  const walkId = jobContext?.walkId ?? randomUUID();
  const startedAt = new Date();
  // Best-effort API-call counter — bumped after every listFolder/getFolder. Reported via jobContext.
  let apiCalls = 0;
  let foldersWalked = 0;
  let filesIndexed = 0;

  console.log(
    `[walker] start walkId=${walkId} userId=${userId} rootFolderId=${rootFolderId} maxDepth=${maxDepth}`,
  );

  // Look up the root folder so we can capture its name + put it in the index too.
  const root = await getFolder(userId, rootFolderId);
  apiCalls += 1;
  if (!root) {
    console.error(
      `[walker] root folder ${rootFolderId} returned null from getFolder — aborting walk walkId=${walkId}`,
    );
    throw new Error(
      `Box root folder ${rootFolderId} not accessible. Verify BOX_TENANTS_CHAPMANHOECK_FOLDER_ID + that the user has Box access to it.`,
    );
  }
  console.log(`[walker] root folder resolved: name="${root.name}" id=${root.id}`);

  // Insert root row first.
  await upsertRow({
    walkId,
    boxId: root.id,
    boxType: 'folder',
    name: root.name,
    parentBoxId: null,
    depth: 0,
    pathSegments: [],
    boxModifiedAt: root.modifiedAt,
    sizeBytes: undefined,
    clientFolderName: null,
    isMtClient: false,
    marketSubfolder: null,
  });

  const queue: QueueItem[] = [
    {
      boxId: root.id,
      parentBoxId: null,
      depth: 0,
      pathSegments: [],
      clientFolderName: null,
      isMtClient: false,
      marketSubfolder: null,
    },
  ];
  let indexedCount = 1;
  let lastProgressLog = 1;
  const PROGRESS_EVERY = 50;

  while (queue.length > 0) {
    if (maxItems && indexedCount >= maxItems) break;
    const cur = queue.shift()!;
    foldersWalked += 1;

    let children;
    try {
      children = await listFolder(userId, cur.boxId);
      apiCalls += 1;
    } catch (err) {
      // Log and continue — one bad folder shouldn't abort the whole walk.
      console.error(
        `[walker] listFolder failed for "${cur.pathSegments.join('/')}" (id=${cur.boxId}, depth=${cur.depth}) walkId=${walkId}:`,
        err instanceof Error ? err.message : err,
      );
      continue;
    }

    // Report progress to the job runner. The runner throttles writes to ≤5s.
    if (jobContext) {
      void jobContext.reportProgress({
        foldersWalked,
        filesIndexed,
        apiCalls,
        currentPath: cur.pathSegments.join(' / ') || (root.name ?? 'root'),
      });
    }

    for (const child of children) {
      if (maxItems && indexedCount >= maxItems) break;

      // Figure out client context for this child.
      // - At depth 1 (direct children of root, e.g. /Clients), no client context yet
      // - At depth 2 (under /Clients), each child IS a client folder → set clientFolderName
      // - At depth 3+ inside an MT client, the child might be a market subfolder (state name)
      // We approximate: depth 2 = client folder; for MT clients depth 3 = market subfolder.
      let childClient = cur.clientFolderName;
      let childIsMt = cur.isMtClient;
      let childMarket = cur.marketSubfolder;
      if (cur.depth === 1 && child.type === 'folder') {
        // /Clients/<client name>
        childClient = child.name;
        childIsMt = isMtClient(child.name);
        childMarket = null;
      } else if (cur.depth === 2 && cur.isMtClient && child.type === 'folder') {
        // /Clients/<MT client>/<market>
        childMarket = child.name;
      }

      const parsed = parseDealFolderName(child.name);
      const isSubleaseShortcut =
        child.type === 'web_link' &&
        !!child.url &&
        MASTER_SUBLEASE_KEYWORDS.some((k) => child.url!.toLowerCase().includes(k.toLowerCase()));

      try {
        await upsertRow({
          walkId,
          boxId: child.id,
          boxType: child.type,
          name: child.name,
          parentBoxId: cur.boxId,
          depth: cur.depth + 1,
          pathSegments: [...cur.pathSegments, child.name],
          boxModifiedAt: child.modifiedAt,
          sizeBytes: child.size,
          webLinkUrl: child.url,
          isSubleaseShortcut,
          yearStart: parsed?.yearStart,
          yearEnd: parsed?.yearEnd,
          dealType: parsed?.dealType,
          address: parsed?.address,
          clientFolderName: childClient,
          isMtClient: childIsMt,
          marketSubfolder: childMarket,
        });
      } catch (err) {
        // Per-row upsert failures should never abort the whole walk. Log loudly with
        // identifying info so we can diagnose schema mismatches, oversized values, etc.
        console.error(
          `[walker] upsert failed for "${child.name}" (id=${child.id}, type=${child.type}, parent="${cur.pathSegments.join('/')}") walkId=${walkId}:`,
          err instanceof Error ? err.message : err,
        );
        continue;
      }
      indexedCount += 1;
      if (child.type === 'file') filesIndexed += 1;
      if (indexedCount - lastProgressLog >= PROGRESS_EVERY) {
        console.log(
          `[walker] progress walkId=${walkId} indexed=${indexedCount} queueRemaining=${queue.length} depth=${cur.depth + 1}`,
        );
        lastProgressLog = indexedCount;
      }

      // Incremental sync skip: if the child folder hasn't been modified since the last full
      // walk's started_at, don't recurse into it. We DO still upsert it (row above) so the
      // index reflects current metadata; we just don't walk its subtree.
      const skipForIncremental =
        incrementalSince !== undefined &&
        child.type === 'folder' &&
        !!child.modifiedAt &&
        new Date(child.modifiedAt) < incrementalSince;

      // Recurse into folders only — don't enqueue files or web_links.
      // Don't recurse past maxDepth.
      if (child.type === 'folder' && cur.depth + 1 < maxDepth && !skipForIncremental) {
        queue.push({
          boxId: child.id,
          parentBoxId: cur.boxId,
          depth: cur.depth + 1,
          pathSegments: [...cur.pathSegments, child.name],
          clientFolderName: childClient,
          isMtClient: childIsMt,
          marketSubfolder: childMarket,
        });
      }
    }
  }

  const finishedAt = new Date();
  console.log(
    `[walker] done walkId=${walkId} indexed=${indexedCount} duration=${finishedAt.getTime() - startedAt.getTime()}ms root="${root.name}" apiCalls=${apiCalls}`,
  );

  // Final progress write (bypasses the 5s throttle by waiting it out via Promise resolution
  // before returning — the job runner reads the in-memory state but the persisted state
  // should match what we just observed).
  // Note: the runner's reportProgress is fire-and-forget by design; the job-runner's
  // markJobCompleted will write the final completed state authoritatively a moment later.

  // Update system_state.last_sync_box so the frontend polling sees the new index.
  await db
    .insert(systemState)
    .values({
      key: SYSTEM_STATE_KEYS.LAST_SYNC_BOX,
      value: {
        walkId,
        rootFolderId,
        rootFolderName: root.name,
        indexedCount,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        userId,
      },
    })
    .onConflictDoUpdate({
      target: systemState.key,
      set: {
        value: {
          walkId,
          rootFolderId,
          rootFolderName: root.name,
          indexedCount,
          startedAt: startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          userId,
        },
        updatedAt: sql`NOW()`,
      },
    });

  return {
    walkId,
    rootFolderId,
    rootFolderName: root.name,
    indexedCount,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
  };
}

interface UpsertArgs {
  walkId: string;
  boxId: string;
  boxType: 'file' | 'folder' | 'web_link';
  name: string;
  parentBoxId: string | null;
  depth: number;
  pathSegments: string[];
  boxModifiedAt?: string;
  sizeBytes?: number;
  webLinkUrl?: string;
  isSubleaseShortcut?: boolean;
  yearStart?: number;
  yearEnd?: number;
  dealType?: string;
  address?: string;
  clientFolderName?: string | null;
  isMtClient?: boolean;
  marketSubfolder?: string | null;
}

async function upsertRow(args: UpsertArgs) {
  await db
    .insert(boxFolderIndex)
    .values({
      boxId: args.boxId,
      boxType: args.boxType,
      name: args.name,
      parentBoxId: args.parentBoxId,
      depth: args.depth,
      pathSegments: args.pathSegments,
      boxModifiedAt: args.boxModifiedAt ? new Date(args.boxModifiedAt) : null,
      sizeBytes: args.sizeBytes ?? null,
      webLinkUrl: args.webLinkUrl ?? null,
      isSubleaseShortcut: args.isSubleaseShortcut ?? false,
      yearStart: args.yearStart ?? null,
      yearEnd: args.yearEnd ?? null,
      dealType: args.dealType ?? null,
      address: args.address ?? null,
      clientFolderName: args.clientFolderName ?? null,
      isMtClient: args.isMtClient ?? false,
      marketSubfolder: args.marketSubfolder ?? null,
      lastSeenAt: sql`NOW()`,
      lastWalkRunId: args.walkId,
    })
    .onConflictDoUpdate({
      target: boxFolderIndex.boxId,
      set: {
        name: args.name,
        parentBoxId: args.parentBoxId,
        depth: args.depth,
        pathSegments: args.pathSegments,
        boxModifiedAt: args.boxModifiedAt ? new Date(args.boxModifiedAt) : null,
        sizeBytes: args.sizeBytes ?? null,
        webLinkUrl: args.webLinkUrl ?? null,
        isSubleaseShortcut: args.isSubleaseShortcut ?? false,
        yearStart: args.yearStart ?? null,
        yearEnd: args.yearEnd ?? null,
        dealType: args.dealType ?? null,
        address: args.address ?? null,
        clientFolderName: args.clientFolderName ?? null,
        isMtClient: args.isMtClient ?? false,
        marketSubfolder: args.marketSubfolder ?? null,
        lastSeenAt: sql`NOW()`,
        lastWalkRunId: args.walkId,
        updatedAt: sql`NOW()`,
        updatedBy: 'box_walker',
      },
    });
}
