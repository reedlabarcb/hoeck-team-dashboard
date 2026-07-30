/**
 * Text-extraction worker — PDF (Phase 2.5a) + Word/Excel.
 *
 * Mirrors the walker.ts/job-runner.ts pattern, but instead of crawling the Box tree,
 * iterates over already-indexed files in box_folder_index and pulls text from each.
 * The walker indexes EVERY file type, so .docx/.xlsx rows already exist here; only
 * extraction was PDF-only, which is why Word/Excel content wasn't searchable.
 *
 * Per-file lifecycle:
 *   1. SELECT next batch where box_type='file' AND name ILIKE '%.pdf'/'%.docx'/'%.xlsx'
 *        AND (extraction_status='pending' OR extraction_status IS NULL)
 *        AND deleted_at IS NULL
 *        ORDER BY box_modified_at DESC NULLS LAST
 *        LIMIT MAX_FILES_PER_RUN            (see pendingFilesQuery for why NULL counts)
 *   2. For each row:
 *      a. downloadFile() from Box â†’ stream to /tmp/box-extract-{box_id}.{ext}
 *      b. spawn the extractor for that extension (pdf â†’ pdf_extract_text.py,
 *         docx/xlsx â†’ office_extract_text.py) â€” both share one JSON contract
 *      c. parse JSON; map status â†’ extraction_status; persist via UPDATE
 *      d. delete the temp file (best-effort)
 *      e. bump in-memory counters, call ctx.reportProgress() (throttled to 5s)
 *
 * Status mapping (Python â†’ DB):
 *   "ok"        â†’ extraction_status='extracted',         is_text_native=true
 *   "scanned"   â†’ extraction_status='skipped_scanned',   is_text_native=false
 *   "too_large" â†’ extraction_status='skipped_too_large', is_text_native=null
 *   "error"     â†’ extraction_status='failed', extraction_error=<msg>
 *   <crash>     â†’ extraction_status='failed', extraction_error="subprocess crashed: <msg>"
 *
 * ACCESS FAILURES ARE NOT TERMINAL:
 *   A 403/404 from Box means "this TOKEN can't see this file", not "this file is
 *   unextractable". The job runs under a BORROWED user token (the most recently
 *   refreshed row in user_box_tokens), so a run by someone with narrower Box
 *   visibility than the index would otherwise stamp 'failed' — which the batch
 *   predicate excludes — and permanently bury those files. Instead we leave the row
 *   UNTOUCHED (pending/NULL) so a later run under a broader token picks it up, and
 *   count it as skippedNoAccess. Trade-off: a file nobody can read is retried on
 *   every run. That's one cheap failing GET, and runs are manual — far better than
 *   silent permanent loss, and it needs no new enum value or migration.
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
import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { boxFolderIndex } from '@/lib/db/schema';
import { downloadFile } from './safe';
import type { JobContext } from './job-runner';

const PYTHON_BIN = process.env.PYTHON_BIN || 'python';

// Cap per run so a single trigger doesn't try to chew through everything at once
// on a fresh deploy. Subsequent runs pick up the next batch (see runTextExtraction).
const MAX_FILES_PER_RUN = 10_000;

/** File types we can extract text from. Extension drives which Python script runs. */
export type ExtractableExtension = 'pdf' | 'docx' | 'xlsx';

/**
 * Extension -> extractor script. PDFs keep pdfplumber; Word/Excel share the office
 * extractor (python-docx / openpyxl). Both scripts implement the SAME JSON stdout
 * contract, so everything downstream — status mapping, persistResult — is common.
 */
const EXTRACTOR_SCRIPT: Record<ExtractableExtension, string> = {
  pdf: 'pdf_extract_text.py',
  docx: 'office_extract_text.py',
  xlsx: 'office_extract_text.py',
};

/** Which extractable type is this filename, if any? Case-insensitive. */
export function extensionOf(name: string): ExtractableExtension | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.docx')) return 'docx';
  if (lower.endsWith('.xlsx')) return 'xlsx';
  return null;
}

/** Absolute path of the extractor script for an extension. */
export function scriptPathFor(ext: ExtractableExtension): string {
  return resolve(process.cwd(), 'scripts/python', EXTRACTOR_SCRIPT[ext]);
}

/**
 * Temp filename for a download. The REAL extension is preserved: python-docx and
 * openpyxl sniff/expect the container format and reject a .docx renamed to .pdf,
 * so the old hardcoded `pdf-extract-{id}.pdf` would fail every office file.
 */
export function tmpNameFor(boxId: string, ext: ExtractableExtension): string {
  return `box-extract-${boxId}.${ext}`;
}

export interface TextExtractionResult {
  jobId: string;
  processed: number;
  succeeded: number;
  failed: number;
  /** scanned + too_large + no-access. Keeps processed = succeeded + failed + skipped. */
  skipped: number;
  /** Subset of `skipped`: left pending on purpose, for a run under a broader token. */
  skippedNoAccess: number;
  durationMs: number;
}

/**
 * Is this an ACCESS failure (403 forbidden / 404 invisible-or-gone) rather than a real
 * extraction failure? Access failures are retryable under a different token; everything
 * else is terminal.
 *
 * ⚠️ FRAGILITY: this matches on the message TEXT, because the Box safe wrapper throws a
 * plain Error — `Box downloadFile ${fileId} failed: HTTP ${res.status} — ${body}` — and
 * widening that wrapper is out of scope here. If that message format ever changes, this
 * silently stops matching and permission failures go back to being terminal. The tests in
 * text-extractor.test.ts pin the exact strings downloadFile produces, so a format change
 * fails CI instead of quietly burying files.
 */
export function isAccessError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /\bHTTP (403|404)\b/.test(msg);
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
 * The next batch of rows needing extraction — PDF, Word, or Excel. Exported so the
 * predicate can be asserted via toSQL() without a DB (see text-extractor.test.ts).
 *
 * TWO status values qualify, and the NULL half is load-bearing:
 *   - 'pending'  — PDFs, set by the one-time migration 0006 backfill.
 *   - NULL       — everything the migration didn't touch, i.e. EVERY .docx/.xlsx row
 *                  (extraction_status has no DB default; the walker never sets it).
 *                  Widening the filename filter alone would still have matched zero
 *                  office rows, so this is what actually makes them reachable —
 *                  and it needs no migration and no schema change.
 *
 * Terminal statuses ('extracted' / 'failed' / 'skipped_*') are excluded, which is what
 * makes a re-run IDEMPOTENT and a interrupted run RESUMABLE: finished rows are never
 * re-picked, and anything not yet reached is still pending/NULL for the next batch.
 *
 * Ordered newest-modified first so recent leases populate first.
 */
export function pendingFilesQuery(limit: number) {
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
        or(
          ilike(boxFolderIndex.name, '%.pdf'),
          ilike(boxFolderIndex.name, '%.docx'),
          ilike(boxFolderIndex.name, '%.xlsx'),
        ),
        or(
          eq(boxFolderIndex.extractionStatus, 'pending'),
          isNull(boxFolderIndex.extractionStatus),
        ),
        isNull(boxFolderIndex.deletedAt),
      ),
    )
    .orderBy(desc(boxFolderIndex.boxModifiedAt))
    .limit(limit);
}

/**
 * Download a Box file to a local /tmp path, KEEPING its real extension. Returns the path.
 */
async function downloadToTmp(userId: string, boxId: string, ext: ExtractableExtension): Promise<string> {
  const localPath = join(tmpdir(), tmpNameFor(boxId, ext));
  const body = await downloadFile(userId, boxId);
  await pipeline(
    Readable.fromWeb(body as unknown as import('node:stream/web').ReadableStream),
    createWriteStream(localPath),
  );
  return localPath;
}

/**
 * Spawn the extractor for this file type and parse its JSON stdout. Rejects only on
 * argparse / IO failures (exit code >1) â€” exit 1 with status='error' is returned as
 * data so the caller can persist it as extraction_status='failed' with the message.
 * Both extractors share one contract, so this is type-agnostic.
 */
function runPython(scriptPath: string, filePath: string): Promise<PythonResponse> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(PYTHON_BIN, [scriptPath, '--file-path', filePath], {
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
          new Error(`${scriptPath} exited ${code}. stderr: ${stderr.slice(0, 500)}`),
        );
      }
      try {
        const parsed = JSON.parse(stdout) as PythonResponse;
        resolvePromise(parsed);
      } catch (err) {
        rejectPromise(
          new Error(
            `Failed to parse ${scriptPath} output: ${
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
  const limit = opts.maxItems ?? MAX_FILES_PER_RUN;

  const pending = await pendingFilesQuery(limit);
  console.log(
    `[job:${opts.jobContext.jobId}] text-extractor: ${pending.length} pending files (pdf/docx/xlsx, limit ${limit})`,
  );

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0; // scanned + too_large + no-access
  let skippedNoAccess = 0; // subset of `skipped`, deliberately left pending

  for (const row of pending) {
    const path = (row.pathSegments ?? []).join('/');
    let localPath: string | undefined;
    try {
      // Dispatch by extension. The SELECT only returns the three we handle, so a null
      // here would mean the filter and this map drifted apart — fail loudly, don't guess.
      const ext = extensionOf(row.name);
      if (!ext) throw new Error(`no extractor for "${row.name}" (SELECT/dispatch mismatch)`);
      localPath = await downloadToTmp(opts.userId, row.boxId, ext);
      const py = await runPython(scriptPathFor(ext), localPath);
      await persistResult(row.boxId, py);

      if (py.status === 'ok') succeeded++;
      else if (py.status === 'scanned' || py.status === 'too_large') skipped++;
      else if (py.status === 'error') failed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      // 403/404 = this token can't see the file. Leave extraction_status UNTOUCHED
      // (pending/NULL) so a later run under a broader token retries it — writing
      // 'failed' here would bury it permanently, since 'failed' is excluded from the
      // batch predicate and nothing retries it.
      if (isAccessError(err)) {
        skipped++;
        skippedNoAccess++;
        console.warn(
          `[job:${opts.jobContext.jobId}] file ${row.boxId} (${row.name}) NOT ACCESSIBLE to this token — ` +
            `left pending for a run under a broader token: ${msg}`,
        );
        continue; // no status write at all
      }

      failed++;
      console.error(
        `[job:${opts.jobContext.jobId}] file ${row.boxId} (${row.name}) failed:`,
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
    `[job:${opts.jobContext.jobId}] text-extractor done: processed=${processed} succeeded=${succeeded} ` +
      `failed=${failed} skipped=${skipped} (no_access=${skippedNoAccess}, still pending) duration=${durationMs}ms`,
  );
  if (skippedNoAccess > 0) {
    console.warn(
      `[job:${opts.jobContext.jobId}] ${skippedNoAccess} file(s) were not accessible to this token and remain ` +
        `pending. Re-run under a token with broader Box visibility to pick them up.`,
    );
  }

  return {
    jobId: opts.jobContext.jobId,
    processed,
    succeeded,
    failed,
    skipped,
    skippedNoAccess,
    durationMs,
  };
}

