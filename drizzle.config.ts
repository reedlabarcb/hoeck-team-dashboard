import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// Load .env.local first (local dev), fall back to .env (CI / production builds).
loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Check .env.local (local dev) or Railway env vars (production).');
}

export default defineConfig({
  schema: './lib/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  // Verbose output during dev so we see exactly what's being generated.
  verbose: true,
  strict: true,
});
