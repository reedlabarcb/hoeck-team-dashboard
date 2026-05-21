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
}): Promise<WalkResult> {
  const { userId, rootFolderId, maxDepth = 6, maxItems } = opts;
  const walkId = randomUUID();
  const startedAt = new Date();

  // Look up the root folder so we can capture its name + put it in the index too.
  const root = await getFolder(userId, rootFolderId);
  if (!root) {
    throw new Error(
      `Box root folder ${rootFolderId} not accessible. Verify BOX_TENANTS_CHAPMANHOECK_FOLDER_ID + that the user has Box access to it.`,
    );
  }

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

  while (queue.length > 0) {
    if (maxItems && indexedCount >= maxItems) break;
    const cur = queue.shift()!;

    let children;
    try {
      children = await listFolder(userId, cur.boxId);
    } catch (err) {
      // Log and continue — one bad folder shouldn't abort the whole walk.
      console.error(`[walker] failed to list folder ${cur.boxId} (${cur.pathSegments.join('/')})`, err);
      continue;
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
      indexedCount += 1;

      // Recurse into folders only — don't enqueue files or web_links.
      // Don't recurse past maxDepth.
      if (child.type === 'folder' && cur.depth + 1 < maxDepth) {
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
