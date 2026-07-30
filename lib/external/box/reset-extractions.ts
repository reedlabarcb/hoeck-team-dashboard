/**
 * Reset failed text-extraction rows back to 'pending' so the worker retries them.
 *
 * WHY THIS EXISTS: extraction_status='failed' is TERMINAL — the batch predicate in
 * text-extractor.ts only picks up 'pending' or NULL, and nothing retries failures. Before
 * the access-failure fix, a run under a token with narrower Box visibility than the index
 * stamped 'failed' on every file it couldn't see, permanently hiding them from content
 * search with no way back. This is the way back.
 *
 * DEFAULT MODE IS 'access', NOT a blanket reset. A blanket reset would also requeue
 * genuinely corrupt files, which will just fail again and churn Box API calls on every
 * run. 'access' targets only rows whose recorded error was a permission/visibility
 * problem (HTTP 403 / 404) — the ones that legitimately deserve another try.
 *
 * Idempotent + resumable: it flips rows OUT of 'failed', so a re-run matches nothing and
 * reports 0. Chunked so one statement never locks a huge row set.
 *
 * Read-only elsewhere: this touches only extraction bookkeeping columns on
 * box_folder_index. It writes nothing to Box, and the Box safe wrapper is untouched.
 */

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';

export type ResetMode = 'access' | 'all';

/** Errors recorded by an access failure. Matches persistOuterFailure's stored message. */
export const ACCESS_ERROR_SQL =
  "(extraction_error LIKE '%HTTP 403%' OR extraction_error LIKE '%HTTP 404%')";

const DEFAULT_CHUNK_SIZE = 500;
/** Backstop so a pathological loop can't run forever. 200 * 500 = 100k rows. */
const MAX_CHUNKS = 200;

export interface ResetResult {
  mode: ResetMode;
  updated: number;
  chunks: number;
  /** True if we hit MAX_CHUNKS — run it again to continue. */
  truncated: boolean;
}

/**
 * The WHERE body selecting rows to reset. Pure + exported so the filter is unit-tested
 * without a DB. Contains NO caller input — it's composed from fixed literals only, which
 * is why it's safe to hand to sql.raw().
 */
export function resetPredicate(mode: ResetMode): string {
  const base = "extraction_status = 'failed' AND deleted_at IS NULL";
  return mode === 'access' ? `${base} AND ${ACCESS_ERROR_SQL}` : base;
}

/**
 * Flip matching 'failed' rows back to 'pending', in chunks.
 *
 * Clears extraction_error/extraction_completed_at too, so the retry starts clean and a
 * stale 403 message can't be mistaken for a fresh one. extracted_text is already NULL on
 * failed rows (nothing was extracted), so there's nothing to clear there — and the
 * GENERATED tsvector follows extracted_text automatically.
 */
export async function resetFailedExtractions(
  opts: { mode?: ResetMode; chunkSize?: number } = {},
): Promise<ResetResult> {
  const mode: ResetMode = opts.mode === 'all' ? 'all' : 'access'; // default: filtered
  const chunkSize = Math.max(1, Math.min(opts.chunkSize ?? DEFAULT_CHUNK_SIZE, 5_000));
  const where = sql.raw(resetPredicate(mode));

  let updated = 0;
  let chunks = 0;
  let truncated = false;

  for (;;) {
    if (chunks >= MAX_CHUNKS) {
      truncated = true;
      break;
    }
    const res = await db.execute(sql`
      UPDATE box_folder_index
         SET extraction_status = 'pending',
             extraction_error = NULL,
             extraction_completed_at = NULL,
             updated_at = NOW(),
             updated_by = 'reset_extractions'
       WHERE box_id IN (
         SELECT box_id FROM box_folder_index
          WHERE ${where}
          LIMIT ${chunkSize}
       )
    `);
    // node-postgres reports affected rows on rowCount; drizzle passes the result through.
    const n = Number((res as unknown as { rowCount?: number | null }).rowCount ?? 0);
    chunks += 1;
    updated += n;
    if (n === 0) break; // nothing left to flip — also the idempotent re-run path
  }

  console.log(`[reset-extractions] mode=${mode} updated=${updated} chunks=${chunks} truncated=${truncated}`);
  return { mode, updated, chunks, truncated };
}
