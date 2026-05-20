/**
 * Postgres client (Drizzle + node-postgres).
 *
 * Lessons applied:
 *   - DATABASE_URL only — no hardcoded fallback (golf-bd OneDrive path bomb).
 *   - Single pool, lazily initialized — avoids opening Postgres connections during build.
 *   - Throws loudly if DATABASE_URL is missing, never silently uses a default.
 */

// Env loading is the caller's responsibility:
//   - Next.js routes / RSCs: Next loads .env.local automatically.
//   - tsx scripts (seed, health-check, migrate): they call loadEnv({ path: '.env.local' }) before importing.
// We intentionally do NOT call dotenv here to avoid double-loading in the Next runtime.
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

if (!process.env.DATABASE_URL) {
  // Loud failure. Don't paper over a missing env var with a "localhost" fallback.
  throw new Error(
    'DATABASE_URL is not set. ' +
      'For local dev, populate .env.local with Railway\'s public Postgres URL. ' +
      'For production, Railway injects DATABASE_URL automatically.',
  );
}

// In dev, hot-reload can multiply pools; cache on globalThis to keep just one.
// In production this branch never matches.
const globalForDb = globalThis as unknown as { __pgPool?: Pool };

const pool =
  globalForDb.__pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    // Railway public proxy requires SSL; internal does not but accepts it.
    ssl: process.env.DATABASE_URL.includes('railway.internal')
      ? undefined
      : { rejectUnauthorized: false },
    // Conservative pool — three concurrent users won't saturate even 5 connections.
    max: 5,
    idleTimeoutMillis: 30_000,
  });

if (process.env.NODE_ENV !== 'production') {
  globalForDb.__pgPool = pool;
}

export const db = drizzle(pool, { schema });
export { pool };
export type Database = typeof db;
