/**
 * Postgres client (Drizzle + node-postgres).
 *
 * Lazy-initialized so that importing this module does not require DATABASE_URL.
 * The error fires the first time you actually USE `db` or `pool` — not at import.
 * Why: tests + tooling that import dependent modules but never touch the DB should
 * not crash. Production code that uses `db` will surface the loud error correctly.
 *
 * Lessons applied:
 *   - DATABASE_URL only — no hardcoded fallback (golf-bd OneDrive path bomb).
 *   - Single pool, cached on globalThis for dev hot-reload.
 */

// Env loading is the caller's responsibility:
//   - Next.js routes / RSCs: Next loads .env.local automatically.
//   - tsx scripts (seed, health-check, migrate): they call loadEnv({ path: '.env.local' }) before importing.
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

const globalForDb = globalThis as unknown as { __pgPool?: Pool };

function buildPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is not set. ' +
        'For local dev, populate .env.local with Railway\'s public Postgres URL. ' +
        'For production, Railway injects DATABASE_URL automatically.',
    );
  }
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('railway.internal')
      ? undefined
      : { rejectUnauthorized: false },
    // Cap at 10 to stay well below Railway Hobby Postgres's ~22 connection limit.
    // This pool is shared across the entire app process; per-request handlers must
    // NEVER instantiate their own Pool (see docs/LESSONS_LEARNED.md Phase 2 entry).
    max: 10,
    idleTimeoutMillis: 30_000,
    // Fail fast when the Postgres host is unreachable (e.g., dev laptop on corp network).
    connectionTimeoutMillis: 5_000,
  });
}

export function getPool(): Pool {
  // Cache on globalThis in ALL environments (not just dev). Without this, each call to
  // getPool() in production builds a fresh Pool — the original cause of the Phase 2
  // connection-pool leak. The fix is to cache unconditionally.
  if (globalForDb.__pgPool) return globalForDb.__pgPool;
  const p = buildPool();
  globalForDb.__pgPool = p;
  return p;
}

// Proxy `db` so calls like `db.select()...` lazily initialize the pool on first use,
// but `import { db }` itself is free of side effects.
export const db: ReturnType<typeof drizzle<typeof schema>> = new Proxy(
  {} as ReturnType<typeof drizzle<typeof schema>>,
  {
    get(_target, prop) {
      const real = drizzle(getPool(), { schema });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (real as any)[prop];
    },
  },
);

export type Database = typeof db;
