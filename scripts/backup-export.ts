/**
 * scripts/backup-export.ts — CLI mirror of GET /api/export/all.
 * Run with: npm run backup
 *
 * Produces a ZIP locally for ad-hoc backups outside the HTTP endpoint
 * (useful for cron jobs that pipe to Box, or for manual snapshots while debugging).
 */

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

import { createWriteStream, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { Pool } from 'pg';

const archiver = createRequire(import.meta.url)('archiver') as typeof import('archiver');

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set');
  }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('railway.internal')
      ? undefined
      : { rejectUnauthorized: false },
  });

  const outDir = resolve(process.cwd(), 'backups');
  mkdirSync(outDir, { recursive: true });

  const exportedAt = new Date().toISOString();
  const stamp = exportedAt.replace(/[:T-]/g, '').replace(/\..*Z$/, '');
  const filename = `hoeck-dashboard-backup-${stamp.slice(0, 8)}_${stamp.slice(8, 14)}.zip`;
  const outPath = resolve(outDir, filename);

  const out = createWriteStream(outPath);
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.pipe(out);

  archive.append(
    JSON.stringify(
      {
        exported_at: exportedAt,
        app_version: '0.1.0',
        schema_version: 1,
        source: 'cli',
      },
      null,
      2,
    ),
    { name: 'metadata.json' },
  );

  const { rows } = await pool.query('SELECT * FROM activity_feed ORDER BY created_at ASC');
  archive.append(JSON.stringify(rows, null, 2), { name: 'activity_feed.json' });

  await archive.finalize();
  await new Promise<void>((res) => out.on('close', () => res()));
  await pool.end();

  console.log(`[backup-export] wrote ${outPath}`);
}

main().catch((err) => {
  console.error('[backup-export] failed:', err);
  process.exit(1);
});
