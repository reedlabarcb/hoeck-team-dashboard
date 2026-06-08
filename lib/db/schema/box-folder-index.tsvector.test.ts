/**
 * Regression guards for the `extracted_text_tsvector` GENERATED column.
 *
 * Why this file exists: Drizzle has no native helper for Postgres GENERATED
 * columns, so the migration that creates `extracted_text_tsvector` as
 *   GENERATED ALWAYS AS (to_tsvector('english', coalesce(extracted_text, ''))) STORED
 * is HAND-EDITED on top of drizzle-kit generate output. A future contributor
 * who blindly re-runs `drizzle-kit generate` could silently emit a plain
 * `tsvector` column instead — which would compile, deploy, and then never
 * populate any text. Full-text search would just return zero matches forever.
 *
 * Two guards, ordered cheapest first:
 *
 *  1. STATIC (always runs): grep migration 0005 for the GENERATED clause.
 *     Catches the most likely regression — someone regenerated the migration
 *     and lost the hand edit — without needing a database connection.
 *
 *  2. INTEGRATION (`*.integration` describe block): connect to DATABASE_URL,
 *     create a TEMPORARY TABLE that mirrors the relevant column shape, insert
 *     a known string, assert the tsvector populates and a match query works.
 *     Skipped cleanly when no DATABASE_URL is reachable (CBRE firewall blocks
 *     the public Railway proxy from Reed's laptop — same constraint as
 *     `npm run db:migrate`. Runs on Railway and any environment with DB access).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const MIGRATION_PATH = resolve(
  process.cwd(),
  'drizzle',
  '0005_pdf_text_extraction.sql',
);

// ----------------- Guard 1: static migration check (no DB needed) -----------------

describe('migration 0005_pdf_text_extraction.sql (static)', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf8');

  test('contains the GENERATED ALWAYS AS STORED clause on extracted_text_tsvector', () => {
    // If this fails, the hand-edited GENERATED column was lost (probably by
    // someone re-running `drizzle-kit generate`). Restore the clause from
    // git history and re-read the warning comment in
    // lib/db/schema/box-folder-index.ts above `extractedTextTsvector`.
    const re =
      /ADD COLUMN\s+"extracted_text_tsvector"\s+tsvector\s+GENERATED\s+ALWAYS\s+AS\s+\(to_tsvector\('english',\s*coalesce\("extracted_text",\s*''\)\)\)\s+STORED/i;
    expect(sql).toMatch(re);
  });

  test('GIN index on extracted_text_tsvector is present', () => {
    expect(sql).toMatch(
      /CREATE INDEX\s+"box_folder_index_text_tsv_gin_idx"\s+ON\s+"box_folder_index"\s+USING gin\s+\("extracted_text_tsvector"\)/i,
    );
  });
});

// ----------------- Guard 2: integration check (skips without DB) -----------------

const DATABASE_URL = process.env.DATABASE_URL;

const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('migration 0005 (integration — GENERATED tsvector behavior)', () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: DATABASE_URL });
    try {
      await client.connect();
    } catch (err) {
      // Connection failure (e.g. CBRE firewall blocking the public proxy) →
      // mark the test as skipped at runtime by throwing a marker error caught
      // by Vitest's reporter via test.skip in each test. Simpler: just rethrow
      // and let the suite fail loudly so the operator sees it. But we want
      // *graceful* skip when expected — so swallow connection errors and let
      // the per-test `client === null` check skip individual tests.
      // eslint-disable-next-line no-console
      console.warn(
        `[tsvector integration] could not connect to DATABASE_URL — skipping integration tests: ${
          err instanceof Error ? err.message : 'unknown'
        }`,
      );
      // @ts-expect-error mark as unusable
      client = null;
    }
  });

  afterAll(async () => {
    if (client) await client.end().catch(() => {});
  });

  test('TEMP TABLE with the same GENERATED clause populates and matches via @@', async () => {
    if (!client) return; // graceful skip when DB unreachable
    // Mirror the column shape inside a session-scoped TEMP TABLE so we touch
    // ZERO production rows. TEMP tables drop automatically on connection close.
    await client.query(`
      CREATE TEMP TABLE _tsvector_guard (
        id serial PRIMARY KEY,
        extracted_text text,
        extracted_text_tsvector tsvector
          GENERATED ALWAYS AS (to_tsvector('english', coalesce(extracted_text, ''))) STORED
      ) ON COMMIT DROP;
    `);

    // Insert WITHOUT supplying tsvector — Postgres must compute it.
    await client.query(
      `INSERT INTO _tsvector_guard (extracted_text) VALUES ($1)`,
      ['The quick brown fox jumps over the lazy lease document.'],
    );

    // Match a stemmed lexeme (jumps → jump) to also prove 'english' config wired.
    const r = await client.query(
      `SELECT extracted_text_tsvector @@ plainto_tsquery('english', $1) AS hit
       FROM _tsvector_guard`,
      ['jumping fox'],
    );

    expect(r.rows[0].hit).toBe(true);
  });

  test('NULL extracted_text yields a non-null but empty tsvector via coalesce', async () => {
    if (!client) return;
    await client.query(`
      CREATE TEMP TABLE _tsvector_null_guard (
        id serial PRIMARY KEY,
        extracted_text text,
        extracted_text_tsvector tsvector
          GENERATED ALWAYS AS (to_tsvector('english', coalesce(extracted_text, ''))) STORED
      ) ON COMMIT DROP;
    `);
    await client.query(`INSERT INTO _tsvector_null_guard (extracted_text) VALUES (NULL)`);
    const r = await client.query(
      `SELECT extracted_text_tsvector IS NOT NULL AS not_null,
              extracted_text_tsvector = ''::tsvector AS is_empty
       FROM _tsvector_null_guard`,
    );
    // coalesce('', NULL) → '' → to_tsvector('english', '') → ''::tsvector (empty, not null)
    expect(r.rows[0].not_null).toBe(true);
    expect(r.rows[0].is_empty).toBe(true);
  });
});
