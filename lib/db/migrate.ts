/**
 * Migration runner.
 *   1. Runs drizzle's generated SQL migrations (in ./drizzle).
 *   2. Applies our hand-managed triggers.sql.
 *
 * Run via: npm run db:migrate
 *
 * On Railway, this is invoked by `startCommand = "npm run db:migrate && npm start"` (see railway.toml).
 */

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Cannot run migrations.');
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('railway.internal')
      ? undefined
      : { rejectUnauthorized: false },
  });

  const db = drizzle(pool);

  console.log('[migrate] applying drizzle migrations...');
  await migrate(db, { migrationsFolder: resolve(process.cwd(), 'drizzle') });
  console.log('[migrate] drizzle migrations OK');

  console.log('[migrate] applying triggers.sql...');
  const triggersSql = readFileSync(resolve(process.cwd(), 'lib/db/triggers.sql'), 'utf8');
  await pool.query(triggersSql);
  console.log('[migrate] triggers OK');

  await pool.end();
  console.log('[migrate] done');
}

main().catch((err) => {
  console.error('[migrate] failed:', err);
  process.exit(1);
});
