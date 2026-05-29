/**
 * scripts/sync-cron.ts — entry point for Railway cron jobs.
 *
 * Invocation:
 *   - `npm run sync:box -- incremental` (Railway daily cron at 4am Pacific)
 *   - `npm run sync:box -- full`        (Railway weekly cron at 5am Pacific Sunday)
 *   - `npm run sync:all`                (manual: incremental box + stubbed realnex)
 *   - `npm run sync:realnex`            (manual / stubbed until Phase 3)
 *
 * Strategy:
 *   - Picks the most recently-refreshed `user_box_tokens` row as the indexing identity.
 *     Rationale: that user has been actively using the dashboard recently, so their token
 *     is likely to still refresh successfully. If their refresh has died, the job logs the
 *     failure to box_sync_jobs.error_message — visible in the UI + activity feed, not
 *     silently masked.
 *   - Creates a `box_sync_jobs` row with triggered_by='cron' and AWAITS completion
 *     (cron processes are one-shot — we want the exit code to reflect success).
 *   - Uses the same kickOffWalk() machinery as the UI POST path. Single code path,
 *     same orphan-recovery semantics if the cron process is killed mid-walk.
 */

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

import { and, desc, isNull } from 'drizzle-orm';
import { db } from '../lib/db';
import { userBoxTokens } from '../lib/db/schema';
import { createJob, kickOffWalk } from '../lib/external/box/job-runner';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

async function syncBox(mode: 'full' | 'incremental'): Promise<void> {
  const rootFolderId = requireEnv('BOX_TENANTS_CHAPMANHOECK_FOLDER_ID');

  const candidates = await db
    .select({ userId: userBoxTokens.userId, updatedAt: userBoxTokens.updatedAt })
    .from(userBoxTokens)
    .where(and(isNull(userBoxTokens.deletedAt)))
    .orderBy(desc(userBoxTokens.updatedAt))
    .limit(1);

  if (candidates.length === 0) {
    console.log(
      '[sync:box] no connected Box users yet — nothing to sync. ' +
        '(A team member needs to "Connect Box" on /files first.)',
    );
    return;
  }
  const indexer = candidates[0];
  console.log(
    `[sync:box] mode=${mode} using token from user ${indexer.userId} ` +
      `(last refreshed ${indexer.updatedAt.toISOString()})`,
  );

  const job = await createJob({
    triggeredBy: 'cron',
    syncMode: mode,
    isForceFull: mode === 'full',
  });
  console.log(`[sync:box] created job ${job.id} walkId=${job.walkId}`);

  // The cron process must AWAIT the walk so its exit code reflects success/failure.
  // (The UI POST path doesn't await; cron does.)
  await kickOffWalk({
    jobId: job.id,
    walkId: job.walkId,
    userId: indexer.userId,
    rootFolderId,
    syncMode: mode,
  });

  console.log(`[sync:box] job ${job.id} finished`);
}

async function syncRealNex(): Promise<void> {
  // Phase 3 implements this.
  console.log('[sync:realnex] stub — wired in Phase 3.');
}

async function main(): Promise<void> {
  // Args:
  //   sync-cron.ts <target> [<mode>]
  //     target = box | realnex | all
  //     mode   = full | incremental (only relevant when target=box; default=incremental)
  const target = process.argv[2] ?? 'all';
  const modeArg = process.argv[3];
  const mode: 'full' | 'incremental' = modeArg === 'full' ? 'full' : 'incremental';

  switch (target) {
    case 'box':
      await syncBox(mode);
      break;
    case 'realnex':
      await syncRealNex();
      break;
    case 'all':
      await syncBox(mode);
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
