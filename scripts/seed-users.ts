/**
 * scripts/seed-users.ts — IDEMPOTENT seed for application users.
 *
 * IMPORTANT: This script uses INSERT ... ON CONFLICT (email) DO NOTHING.
 * It never UPDATEs and never DELETEs existing rows.
 *
 * Why: inbound-tracker commit `0fdcb2f` ("CRITICAL FIX: The seed-data.json seeding was
 * overwriting user data on every deploy") — destructive seeding wiped the live DB on every
 * Railway redeploy. Solution: seeds are append-only.
 *
 * Default temp passwords are set here. Each broker MUST rotate their own on first login
 * (a "first login = forced password reset" flow lands in Phase 7 alongside notes/tags).
 *
 * Run: npm run seed:users
 */

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { users } from '../lib/db/schema';
import { hashPassword } from '../lib/auth/password';

interface SeedUser {
  email: string;
  name: string;
  role: 'admin' | 'broker';
  tempPassword: string;
}

// Temp passwords — must rotate on first login (Phase 7).
const SEED_USERS: SeedUser[] = [
  { email: 'reed.labar@cbre.com', name: 'Reed LaBar', role: 'admin', tempPassword: 'changeme-reed' },
  { email: 'mike.hoeck@cbre.com', name: 'Mike Hoeck', role: 'broker', tempPassword: 'changeme-mike' },
  { email: 'jack.chapman@cbre.com', name: 'Jack Chapman', role: 'broker', tempPassword: 'changeme-jack' },
  { email: 'nadya.gorelov@cbre.com', name: 'Nadya Gorelov', role: 'broker', tempPassword: 'changeme-nadya' },
];

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
  const db = drizzle(pool);

  let inserted = 0;
  let skipped = 0;

  for (const u of SEED_USERS) {
    const hash = await hashPassword(u.tempPassword);
    const result = await db
      .insert(users)
      .values({
        email: u.email,
        name: u.name,
        role: u.role,
        passwordHash: hash,
        createdBy: 'seed-script',
        updatedBy: 'seed-script',
      })
      .onConflictDoNothing({ target: users.email })
      .returning({ id: users.id });

    if (result.length > 0) {
      inserted += 1;
      console.log(`[seed] inserted ${u.email}`);
    } else {
      skipped += 1;
      console.log(`[seed] skipped ${u.email} (already exists)`);
    }
  }

  console.log(`[seed] done. inserted=${inserted} skipped=${skipped}`);
  await pool.end();
}

main().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
