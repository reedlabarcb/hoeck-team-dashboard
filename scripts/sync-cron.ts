/**
 * scripts/sync-cron.ts — entry point for Railway daily cron jobs.
 *
 * Invocation:
 *   - `npm run sync:all` (Railway daily cron at 12:00 UTC / 4am Pacific)
 *   - `npm run sync:box` (manual / future use)
 *   - `npm run sync:realnex` (manual / Phase 3)
 *
 * Strategy:
 *   - Pick the most recently-refreshed user_box_tokens row as the indexing identity.
 *     Rationale: that user has been actively using the dashboard recently, so their token
 *     is likely to still refresh successfully. If their refresh has died, log + bail loudly
 *     (no fallback to a different user — we want the failure visible, not silently masked).
 *   - For sync:realnex: stub (Phase 3 lands the real one).
 *   - For sync:all: runs sync:box then sync:realnex sequentially.
 */

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

import { and, desc, isNull } from 'drizzle-orm';
import { db } from '../lib/db';
import { userBoxTokens } from '../lib/db/schema';
import { walkBoxTree } from '../lib/external/box/walker';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

async function syncBox(): Promise<void> {
  const rootFolderId = requireEnv('BOX_TENANTS_CHAPMANHOECK_FOLDER_ID');

  const candidates = await db
    .select({ userId: userBoxTokens.userId, updatedAt: userBoxTokens.updatedAt })
    .from(userBoxTokens)
    .where(and(isNull(userBoxTokens.deletedAt)))
    .orderBy(desc(userBoxTokens.updatedAt))
    .limit(1);

  if (candidates.length === 0) {
    console.log('[sync:box] no connected Box users yet — nothing to sync. (Reed needs to "Connect Box" first.)');
    return;
  }
  const indexer = candidates[0];
  console.log(`[sync:box] using token from user ${indexer.userId} (last refreshed ${indexer.updatedAt.toISOString()})`);

  const result = await walkBoxTree({
    userId: indexer.userId,
    rootFolderId,
  });
  console.log(
    `[sync:box] done. walkId=${result.walkId} root="${result.rootFolderName}" indexed=${result.indexedCount} duration=${result.durationMs}ms`,
  );
}

async function syncRealNex(): Promise<void> {
  // Phase 3 implements this.
  console.log('[sync:realnex] stub — wired in Phase 3.');
}

async function main(): Promise<void> {
  const target = process.argv[2] ?? 'all';
  switch (target) {
    case 'box':
      await syncBox();
      break;
    case 'realnex':
      await syncRealNex();
      break;
    case 'all':
      await syncBox();
      await syncRealNex();
      break;
    default:
      throw new Error(`Unknown sync target: ${target}. Use one of: box, realnex, all.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[sync] failed:', err);
    process.exit(1);
  });
