/**
 * CLI: reset failed text-extraction rows back to 'pending'.
 *
 *   npm run reset:extractions            # mode=access (default, filtered)
 *   npm run reset:extractions -- all     # mode=all (includes corrupt files)
 *
 * NOTE ON REACHABILITY: production Postgres is only reachable from inside Railway's
 * network — the public proxy is firewall-blocked on the corp network — so from a laptop
 * this will fail to connect. The authenticated route POST /api/box/reset-extractions is
 * the trigger that actually works in prod; this exists for Railway-side/one-off use and
 * for parity with the other sync CLI targets.
 */

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

import { resetFailedExtractions, type ResetMode } from '../lib/external/box/reset-extractions';

async function main(): Promise<void> {
  const mode: ResetMode = process.argv[2] === 'all' ? 'all' : 'access';
  console.log(`[reset:extractions] starting mode=${mode}`);
  const result = await resetFailedExtractions({ mode });
  console.log(
    `[reset:extractions] done updated=${result.updated} chunks=${result.chunks} truncated=${result.truncated}`,
  );
  if (result.truncated) {
    console.log('[reset:extractions] hit the chunk backstop — run again to continue.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[reset:extractions] failed:', err);
    process.exit(1);
  });
