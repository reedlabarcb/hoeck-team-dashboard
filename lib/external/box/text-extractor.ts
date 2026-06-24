/**
 * PDF text-extraction worker (Phase 2.5a).
 *
 * Mirrors the walker.ts/job-runner.ts pattern, but instead of crawling the Box tree,
 * iterates over already-indexed PDFs in box_folder_index and pulls text from each.
 *
 * Per-PDF lifecycle:
 *   1. SELECT next batch where box_type='file' AND name ILIKE '%.pdf'
 *        AND extraction_status='pending' AND deleted_at IS NULL
 *        ORDER BY box_modified_at DESC NULLS LAST
 *        LIMIT MAX_PDFS_PER_RUN
 *   2. For each row:
 *      a. downloadFile() from Box â†’ stream to /tmp/{box_id}.pdf
 *      b. spawn scripts/python/pdf_extract_text.py --file-path /tmp/{box_id}.pdf
 *      c. parse JSON; map status â†’ extraction_status; persist via UPDATE
 *      d. delete /tmp/{box_id}.pdf (best-effort)
 *      e. bump in-memory counters, call ctx.reportProgress() (throttled to 5s)
 *
 * Status mapping (Python â†’ DB):
 *   "ok"        â†’ extraction_status='extracted',         is_text_native=true
 *   "scanned"   â†’ extraction_status='skipped_scanned',   is_text_native=false
 *   "too_large" â†’ extraction_status='skipped_too_large', is_text_native=null
 *   "error"     â†’ extraction_status='failed', extraction_error=<msg>
 *   <crash>     â†’ extraction_status='failed', extraction_error="subprocess crashed: <msg>"
 *
 * IMPORTANT â€” generated column:
 *   `extracted_text_tsvector` is a Postgres GENERATED ALWAYS AS STORED column.
 *   This worker writes ONLY `extracted_text`. Postgres recomputes the tsvector
 *   automatically. See the warning block in lib/db/schema/box-folder-index.ts.
 *
 * IMPORTANT â€” orphan recovery:
 *   The shared orphan-recovery hook in instrumentation.ts marks any
 *   `box_sync_jobs` row with status='running' AND updated_at < NOW() - 10min
 *   as failed, regardless of job_type â€” so this worker inherits the same crash
 *   safety as the walker without a separate code path.
 */

import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { and, desc, eq, ilike, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { boxFolderIndex } from '@/lib/db/schema';
import { downloadFile } from './safe';
import type { JobContext } from './job-runner';

const PYTHON_SCRIPT = resolve(process.cwd(), 'scripts/python/pdf_extract_text.py');
const PYTHON_BIN = process.env.PYTHON_BIN || 'python';

// Cap per run so a single trigger doesn't try to chew through everything at once
// on a fresh deploy. Subsequent runs (cron in Phase 2.5a.7b) pick up the next batch.
const MAX_PDFS_PER_RUN = 10_000;

export interface TextExtractionResult {
  jobId: string;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  durationMs: number;
}

type PythonStatus = 'ok' | 'scanned' | 'too_large' | 'error';

interface PythonResponse {
  status: PythonStatus;
  text: string | null;
  page_count: number;
  character_count: number;
  extraction_method: string;
  warnings: string[];
  error?: string;
}

/**
 * Pull the next batch of PDF rows that need extraction. Ordered by modified_at desc
 * (newest first) so demo / Mike-driven testing sees recent leases populated first.
 */
async function fetchPendingPdfs(limit: number) {
  return db
    .select({
      boxId: boxFolderIndex.boxId,
      name: boxFolderIndex.name,
      pathSegments: boxFolderIndex.pathSegments,
    })
    .from(boxFolderIndex)
    .where(
      and(
        eq(boxFolderIndex.boxType, 'file'),
        ilike(boxFolderIndex.name, '%.pdf'),
        eq(boxFolderIndex.extractionStatus, 'pending'),
        isNull(boxFolderIndex.deletedAt),
      ),
    )
    .orderBy(desc(boxFolderIndex.boxModifiedAt))
    .limit(limit);
}

/**
 * Download a Box file to a local /tmp path. Returns the local path.
 */
async function downloadToTmp(userId: string, boxId: string): Promise<string> {
  const localPath = join(tmpdir(), `pdf-extract-${boxId}.pdf`);
  const body = await downloadFile(userId, boxId);
  await pipeline(
    Readable.fromWeb(body as unknown as import('node:stream/web').ReadableStream),
    createWriteStream(localPath),
  );
  return localPath;
}

/**
 * Spawn pdf_extract_text.py and parse its JSON stdout. Rejects only on argparse
 * / IO failures (exit code >1) â€” exit 1 with status='error' is returned as data
 * so the caller can persist it as extraction_status='failed' with the message.
 */
function runPython(filePath: string): Promise<PythonResponse> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(PYTHON_BIN, [PYTHON_SCRIPT, '--file-path', filePath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    child.on('error', (err) => rejectPromise(err));
    child.on('close', (code) => {
      // 0 = success/skip, 1 = extraction error (still emits JSON), 2 = argparse error
      if (code !== 0 && code !== 1) {
        return rejectPromise(
          new Error(`pdf_extract_text exited ${code}. stderr: ${stderr.slice(0, 500)}`),
        );
      }
      try {
        const parsed = JSON.parse(stdout) as PythonResponse;
        resolvePromise(parsed);
      } catch (err) {
        rejectPromise(
          new Error(
            `Failed to parse pdf_extract_text output: ${
              err instanceof Error ? err.message : 'unknown'
            }. stdout head: ${stdout.slice(0, 300)}`,
          ),
        );
      }
    });
  });
}

/**
 * Strip NUL (0x00) bytes. Postgres `text`/`varchar` columns reject them outright
 * ("invalid byte sequence for encoding UTF8: 0x00"), so ANY string we persist must
 * be scrubbed first â€” including extraction_error, since an error message can itself
 * embed NUL-containing extracted text (that double-fault is exactly why failed rows
 * previously got stuck `pending`). Web-print PDFs (Bloomberg / Investing.com
 * print-to-PDF) commonly embed NULs. Lossless for search. Defense-in-depth with the
 * same strip at the source in scripts/python/pdf_extract_text.py.
 */
function stripNul<T extends string | null | undefined>(s: T): T {
  return s == null ? s : (s.split(String.fromCharCode(0)).join('') as T);
}

/**
 * Persist Python's response back to box_folder_index.
 * Always sets extraction_attempted_at + extraction_completed_at to NOW().
 *
 * NOTE: we do NOT update extracted_text_tsvector â€” it's a Postgres GENERATED
 *       column and Postgres recomputes it from extracted_text automatically.
 */
async function persistResult(boxId: string, py: PythonResponse): Promise<void> {
  // Map Python status â†’ DB extraction_status enum + decide what to persist.
  let extractionStatus:
    | 'extracted'
    | 'failed'
    | 'skipped_scanned'
    | 'skipped_too_large';
  let extractedText: string | null = null;
  let isTextNative: boolean | null = null;
  let extractionError: string | null = null;

  switch (py.status) {
    case 'ok':
      extractionStatus = 'extracted';
      extractedText = py.text;
      isTextNative = true;
      break;
    case 'scanned':
      extractionStatus = 'skipped_scanned';
      isTextNative = false;
      break;
    case 'too_large':
      extractionStatus = 'skipped_too_large';
      isTextNative = null;
      // Squirrel away the size in extraction_error so ops can see why w/o opening the file.
      extractionError = py.warnings[0] ?? 'file too large';
      break;
    case 'error':
      extractionStatus = 'failed';
      extractionError = py.error ?? 'unknown extraction error';
      break;
  }

  await db
    .update(boxFolderIndex)
    .set({
      // stripNul: Postgres text columns reject 0x00; scrub before write (defense-in-depth
      // with the source strip in pdf_extract_text.py).
      extractedText: stripNul(extractedText),
      extractionStatus,
      pageCount: py.page_count || null,
      isTextNative,
      extractionAttemptedAt: sql`NOW()`,
      extractionCompletedAt: sql`NOW()`,
      extractionError: stripNul(extractionError),
      updatedBy: 'text_extractor',
    })
    .where(eq(boxFolderIndex.boxId, boxId));
}

/**
 * Mark a row as failed when something blew up OUTSIDE the Python subprocess
 * (e.g. Box download failed, file unreachable, write error).
 */
async function persistOuterFailure(boxId: string, reason: string): Promise<void> {
  await db
    .update(boxFolderIndex)
    .set({
      extractionStatus: 'failed',
      extractionAttemptedAt: sql`NOW()`,
      extractionCompletedAt: sql`NOW()`,
      // stripNul FIRST, then truncate — the reason can embed NUL-containing extracted
      // text, and an un-scrubbed error write is exactly what left failed rows stuck
      // `pending` before (the failure-recording UPDATE itself threw on 0x00).
      extractionError: stripNul(reason).slice(0, 4000),
      updatedBy: 'text_extractor',
    })
    .where(eq(boxFolderIndex.boxId, boxId));
}

/**
 * Main entry point. Returns counts so the job-runner can write a completion summary.
 *
 * NOTE: this function does NOT touch box_sync_jobs directly â€” it only emits
 * progress via ctx and returns the final tally. The job-runner caller is
 * responsible for INSERT/UPDATE of the job row.
 */
export async function runTextExtraction(opts: {
  userId: string;
  jobContext: JobContext;
  /** Override the per-run cap. Tests use small numbers; production uses default. */
  maxItems?: number;
}): Promise<TextExtractionResult> {
  const startedAt = Date.now();
  const limit = opts.maxItems ?? MAX_PDFS_PER_RUN;

  const pending = await fetchPendingPdfs(limit);
  console.log(
    `[job:${opts.jobContext.jobId}] text-extractor: ${pending.length} pending PDFs (limit ${limit})`,
  );

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of pending) {
    const path = (row.pathSegments ?? []).join('/');
    let localPath: string | undefined;
    try {
      localPath = await downloadToTmp(opts.userId, row.boxId);
      const py = await runPython(localPath);
      await persistResult(row.boxId, py);

      if (py.status === 'ok') succeeded++;
      else if (py.status === 'scanned' || py.status === 'too_large') skipped++;
      else if (py.status === 'error') failed++;
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[job:${opts.jobContext.jobId}] PDF ${row.boxId} (${row.name}) failed:`,
        msg,
      );
      try {
        await persistOuterFailure(row.boxId, msg);
      } catch (writeErr) {
        // If we can't even record the failure, log + continue. The orphan
        // recovery + run-it-again pattern is the safety net.
        console.error(
          `[job:${opts.jobContext.jobId}] could not record failure for ${row.boxId}:`,
          writeErr,
        );
      }
    } finally {
      processed++;
      if (localPath) {
        await unlink(localPath).catch(() => {
          /* best-effort cleanup; ignore ENOENT etc. */
        });
      }
      // Best-effort progress write (job-runner's JobContext handles throttling).
      await opts.jobContext.reportProgress({
        foldersWalked: 0,
        filesIndexed: 0,
        apiCalls: 0,
        currentPath: `${path}/${row.name}`,
        // The text-extraction-specific fields are layered on top via
        // job-runner's extended context â€” see kickOffTextExtraction below.
        textExtraction: { processed, succeeded, failed, skipped },
      } as Parameters<JobContext['reportProgress']>[0]);
    }
  }

  const durationMs = Date.now() - startedAt;
  console.log(
    `[job:${opts.jobContext.jobId}] text-extractor done: processed=${processed} succeeded=${succeeded} failed=${failed} skipped=${skipped} duration=${durationMs}ms`,
  );

  return {
    jobId: opts.jobContext.jobId,
    processed,
    succeeded,
    failed,
    skipped,
    durationMs,
  };
}

