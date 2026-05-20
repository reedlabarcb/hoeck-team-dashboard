/**
 * scripts/backup-db.ts — STUB (Phase 1).
 *
 * Target (Phase 2): run pg_dump → upload to a dedicated Box folder. Box keeps version
 * history so we get ~3 months of weekly snapshots for free. Wired by railway.toml's
 * weekly cron once Box OAuth is live.
 *
 * Phase 1 behavior: runs pg_dump locally so we know it's installed and the connection
 * works, but does NOT upload anywhere. Prints a clear TODO so anyone running it knows
 * the Box upload is pending.
 *
 * Run: npm run backup:weekly
 *
 * Lineage: Hobby-tier Railway has zero managed Postgres backups (verified May 2026).
 * This is our scar-tissue answer.
 */

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

import { spawnSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

function main() {
  if (!process.env.DATABASE_URL) {
    console.error('[backup-db] DATABASE_URL not set');
    process.exit(1);
  }

  const outDir = resolve(process.cwd(), 'backups');
  mkdirSync(outDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:T-]/g, '').replace(/\..*Z$/, '');
  const outFile = resolve(outDir, `hoeck-pgdump-${stamp.slice(0, 8)}_${stamp.slice(8, 14)}.sql`);

  console.log('[backup-db] running pg_dump...');

  // `pg_dump` reads connection from DATABASE_URL. Requires postgresql client tools on PATH
  // — we add `postgresql_16` to nixpacks.toml so the Railway image has them at build time.
  const result = spawnSync('pg_dump', ['--no-owner', '--no-acl', '-f', outFile, process.env.DATABASE_URL!], {
    stdio: 'inherit',
  });

  if (result.error) {
    console.error('[backup-db] pg_dump failed to start:', result.error.message);
    console.error(
      '[backup-db] HINT: install Postgres client tools (e.g. `apt install postgresql-client` or `brew install libpq`).',
    );
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[backup-db] pg_dump exited ${result.status}`);
    process.exit(result.status ?? 1);
  }

  const size = statSync(outFile).size;
  console.log(`[backup-db] wrote ${outFile} (${size} bytes)`);
  console.log('');
  console.log('[backup-db] TODO(phase-2): upload this file to Box once Phase 2 wires Box OAuth.');
  console.log('[backup-db] Local pg_dump complete — Box upload pending Phase 2 wiring.');
}

main();
