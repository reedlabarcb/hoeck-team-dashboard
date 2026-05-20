/**
 * scripts/seed-users.ts — IDEMPOTENT, NO-DEFAULT-CREDENTIAL seed for application users.
 *
 * Hard rule (see AGENTS.md → Hard Rules): NO DEFAULT CREDENTIALS.
 *   - Each seeded user requires a per-user env var: SEED_<USERNAME>_PASSWORD.
 *   - If a user's env var is unset, this script SKIPS that user (does not seed).
 *   - There is never a fallback password. Never. No `changeme-*`, no defaults.
 *
 * Idempotent:
 *   - Uses INSERT ... ON CONFLICT (email) DO NOTHING.
 *   - Never UPDATEs, never DELETEs existing rows.
 *   - Lineage: inbound-tracker commit `0fdcb2f` ("CRITICAL FIX: The seed-data.json seeding
 *     was overwriting user data on every deploy"). Destructive seeding wiped the live DB on
 *     every Railway redeploy. Solution: seeds are append-only AND require explicit per-user
 *     credentials so we never accidentally re-seed someone with a stale fallback.
 *
 * Run: npm run seed:users
 *
 * Local verification (no env vars set): all users are skipped, no DB connection attempted,
 * script exits 0.
 */

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { users } from '../lib/db/schema';
import { hashPassword } from '../lib/auth/password';

interface SeedCandidate {
  envKey: string;
  username: string;
  email: string;
  name: string;
  role: 'admin' | 'broker';
}

// The set of users we MIGHT seed. Whether each is actually seeded depends on
// whether its SEED_<USERNAME>_PASSWORD env var is set at runtime.
const CANDIDATES: SeedCandidate[] = [
  {
    envKey: 'SEED_REED_PASSWORD',
    username: 'reed',
    email: 'reed.labar@cbre.com',
    name: 'Reed LaBar',
    role: 'admin',
  },
  {
    envKey: 'SEED_MIKE_PASSWORD',
    username: 'mike',
    email: 'mike.hoeck@cbre.com',
    name: 'Mike Hoeck',
    role: 'broker',
  },
  {
    envKey: 'SEED_JACK_PASSWORD',
    username: 'jack',
    email: 'jack.chapman@cbre.com',
    name: 'Jack Chapman',
    role: 'broker',
  },
  {
    envKey: 'SEED_NADYA_PASSWORD',
    username: 'nadya',
    email: 'nadya.gorelov@cbre.com',
    name: 'Nadya Gorelov',
    role: 'broker',
  },
];

async function main() {
  // Decide who we're seeding BEFORE touching the DB so that local verification
  // (where no env vars are set + DB is firewall-blocked) still exits cleanly.
  const toSeed: SeedCandidate[] = [];
  for (const c of CANDIDATES) {
    if (!process.env[c.envKey]) {
      console.log(`Skipping user ${c.username}: ${c.envKey} not set`);
      continue;
    }
    toSeed.push(c);
  }

  if (toSeed.length === 0) {
    console.log('[seed] No users to seed. Exiting without DB connection.');
    return;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is not set, but seed env vars are present. Aborting to avoid silent failure.',
    );
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('railway.internal')
      ? undefined
      : { rejectUnauthorized: false },
  });
  const db = drizzle(pool);

  let inserted = 0;
  let skippedExisting = 0;

  for (const c of toSeed) {
    const plaintext = process.env[c.envKey]!;
    const hash = await hashPassword(plaintext);
    const result = await db
      .insert(users)
      .values({
        email: c.email,
        name: c.name,
        role: c.role,
        passwordHash: hash,
        createdBy: 'seed-script',
        updatedBy: 'seed-script',
      })
      .onConflictDoNothing({ target: users.email })
      .returning({ id: users.id });

    if (result.length > 0) {
      inserted += 1;
      console.log(`[seed] inserted ${c.username} (${c.email})`);
    } else {
      skippedExisting += 1;
      console.log(`[seed] skipped ${c.username} (${c.email}) — already exists`);
    }
  }

  console.log(`[seed] done. inserted=${inserted} skipped_existing=${skippedExisting}`);
  await pool.end();
}

main().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
