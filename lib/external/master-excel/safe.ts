/**
 * Master Excel Safe Wrapper — Phase 4 (reads only).
 *
 * Allow-list — ONLY these methods may exist in this file:
 *   - getCriticalDatesForClient(userId, client, market?)
 *   - getAllRows(userId)
 *   - getFileMetadata(userId)
 *   - runSmoke(userId)
 *
 * Forbid-list — these MUST NEVER exist (enforced by safe.test.ts + pre-commit hook):
 *   - writeMasterExcel*, updateMasterExcel*, deleteMasterExcel*, modifyMasterExcel*
 *   - overwriteMasterExcel*, replaceMasterExcel*, setMasterExcelCell, saveMasterExcel
 *   - Any direct mutation method against the xlsx
 *
 * Phase 5 will add ONE allow-listed write method — `appendMasterExcelRow` — which uses
 * `uploadNewVersion` from the Box safe wrapper (never an overwrite). v1 has zero writes.
 *
 * Data flow:
 *   1. Look up the Box file (TT Rep Master Client List xlsx).
 *   2. If cached and within TTL, reuse cached parsed result.
 *   3. If not, download the bytes to /tmp via Box safe wrapper, spawn the Python
 *      subprocess (scripts/python/master_excel_read.py) which reads with
 *      openpyxl(data_only=True) and returns JSON to stdout.
 *   4. Parse the JSON, translate snake_case → camelCase, return typed result.
 *
 * Lineage: docs/Box_Workflow.md § 5 "Master Excel — TT Rep Master Client List".
 */

import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { logActivity } from '@/lib/activity';
import { downloadFile, getFile } from '@/lib/external/box/safe';
import {
  getCacheEntry,
  setCacheEntry,
  bumpCacheTimestamp,
  setCachedParsedAll,
  getLocalTempDir,
} from './cache';
import type {
  MasterExcelAllRowsResult,
  MasterExcelLookupResult,
  MasterExcelRow,
  MasterExcelSmokeResult,
  MasterExcelSource,
  PythonAllResponse,
  PythonLookupResponse,
  PythonRowDict,
  PythonSmokeResponse,
} from './types';

const PYTHON_SCRIPT = resolve(process.cwd(), 'scripts/python/master_excel_read.py');
const PYTHON_BIN = process.env.PYTHON_BIN || 'python';

function requireFileIdEnv(): string {
  const v = process.env.BOX_MASTER_EXCEL_FILE_ID;
  if (!v) {
    throw new Error(
      'BOX_MASTER_EXCEL_FILE_ID is not set. ' +
        'Set it in Railway via `railway variables --set` to the numeric Box file ID.',
    );
  }
  return v;
}

function normalizeRow(p: PythonRowDict): MasterExcelRow {
  return {
    client: p.client,
    market: p.market,
    address: p.address,
    spaceSf: p.space_sf,
    leaseExpiration: p.lease_expiration,
    renewalWindowStart: p.renewal_window_start,
    renewalWindowEnd: p.renewal_window_end,
    renewalDeadline: p.renewal_deadline,
    terminationDeadline: p.termination_deadline,
    notes: p.notes,
    sourceRow: p.source_row,
  };
}

interface EnsuredFile {
  localPath: string;
  source: MasterExcelSource;
  cacheHit: boolean;
}

/**
 * Ensure we have a current local copy of the xlsx. Returns the local path + provenance.
 * Path decision tree:
 *   - cached + within TTL → return cached path, cacheHit=true (no Box hit)
 *   - cached but stale TTL → re-check etag against Box; if same, refresh TTL + return cached
 *   - cache miss or etag changed → download fresh, replace cache
 */
async function ensureLocalFile(userId: string): Promise<EnsuredFile> {
  const boxFileId = requireFileIdEnv();

  const cached = getCacheEntry(boxFileId);

  // Get current Box metadata to know the etag + filename. We always do this so that
  // cache hits within TTL are still authoritative against Box, just less expensive
  // (metadata call only, no body download).
  const meta = await getFile(userId, boxFileId);
  if (!meta) {
    throw new Error(
      `Box file ${boxFileId} not accessible. Verify BOX_MASTER_EXCEL_FILE_ID + that user ${userId} has Box read access to it.`,
    );
  }

  // Cache hit: still within TTL AND etag matches.
  if (cached && cached.etag === (meta.etag ?? null)) {
    bumpCacheTimestamp(boxFileId);
    return {
      localPath: cached.localFilePath,
      cacheHit: true,
      source: {
        boxFileId,
        etag: cached.etag,
        fetchedAt: new Date(cached.fetchedAt).toISOString(),
        cacheHit: true,
        fileName: meta.name,
        boxModifiedAt: meta.modifiedAt ?? null,
      },
    };
  }

  // Cache miss (no entry, stale TTL, or etag mismatch). Download fresh.
  const localPath = join(getLocalTempDir(), `${boxFileId}.xlsx`);
  const body = await downloadFile(userId, boxFileId);
  await pipeline(Readable.fromWeb(body as unknown as import('node:stream/web').ReadableStream), createWriteStream(localPath));

  const newEntry = setCacheEntry(boxFileId, meta.etag ?? null, localPath);

  return {
    localPath,
    cacheHit: false,
    source: {
      boxFileId,
      etag: newEntry.etag,
      fetchedAt: new Date(newEntry.fetchedAt).toISOString(),
      cacheHit: false,
      fileName: meta.name,
      boxModifiedAt: meta.modifiedAt ?? null,
    },
  };
}

interface RunPythonOpts {
  action: 'lookup' | 'all' | 'smoke';
  filePath: string;
  client?: string;
  market?: string;
}

async function runPython<T>(opts: RunPythonOpts): Promise<T> {
  const args = [PYTHON_SCRIPT, '--file-path', opts.filePath, '--action', opts.action];
  if (opts.action === 'lookup') {
    if (!opts.client) throw new Error('client is required for action=lookup');
    args.push('--client', opts.client);
    if (opts.market) args.push('--market', opts.market);
  }

  return new Promise<T>((resolvePromise, rejectPromise) => {
    const child = spawn(PYTHON_BIN, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    child.on('error', (err) => rejectPromise(err));
    child.on('close', (code) => {
      if (code !== 0 && code !== 1) {
        // 0 = success, 1 = parse/file error (still emits JSON), 2 = argparse error
        return rejectPromise(
          new Error(`Python ${opts.action} exited ${code}. stderr: ${stderr.slice(0, 500)}`),
        );
      }
      try {
        const parsed = JSON.parse(stdout) as T;
        resolvePromise(parsed);
      } catch (err) {
        rejectPromise(
          new Error(
            `Failed to parse Python output for action=${opts.action}: ${
              err instanceof Error ? err.message : 'unknown'
            }. stdout head: ${stdout.slice(0, 300)}`,
          ),
        );
      }
    });
  });
}

/**
 * Fetch ALL rows (with cache). Used by the UI to populate dropdowns + by lookup.
 * Pulls from the in-memory parsed cache if available; otherwise reparses.
 */
export async function getAllRows(userId: string): Promise<MasterExcelAllRowsResult> {
  const ensured = await ensureLocalFile(userId);
  const cached = getCacheEntry(ensured.source.boxFileId);
  if (cached?.parsedAll) {
    return { ...cached.parsedAll, source: ensured.source };
  }

  const response = await runPython<PythonAllResponse>({
    action: 'all',
    filePath: ensured.localPath,
  });

  if (response.status === 'error') {
    throw new Error(`Python action=all returned error: ${response.error ?? 'unknown'}`);
  }

  const result: MasterExcelAllRowsResult = {
    rows: (response.rows ?? []).map(normalizeRow),
    rowCount: response.row_count ?? 0,
    source: ensured.source,
    warnings: response.warnings ?? [],
  };

  setCachedParsedAll(ensured.source.boxFileId, result);
  return result;
}

/**
 * Look up critical dates for a single client (case-insensitive contains). Optional market.
 * Returns multiple_matches=true if more than one row matched — caller decides how to
 * present the disambiguation UI.
 */
export async function getCriticalDatesForClient(
  userId: string,
  client: string,
  market?: string,
): Promise<MasterExcelLookupResult> {
  if (!client) throw new Error('client is required for getCriticalDatesForClient');

  const ensured = await ensureLocalFile(userId);
  const response = await runPython<PythonLookupResponse>({
    action: 'lookup',
    filePath: ensured.localPath,
    client,
    market,
  });

  if (response.status === 'error') {
    throw new Error(`Python action=lookup returned error: ${response.error ?? 'unknown'}`);
  }

  const rows = (response.rows ?? []).map(normalizeRow);

  // Log the lookup for audit. Fire-and-forget — don't block the response on the write.
  void logActivity({
    actorUserId: userId,
    action: 'master_excel_lookup',
    entityType: 'master_excel_file',
    entityId: ensured.source.boxFileId,
    payload: {
      client,
      market: market ?? null,
      matchCount: response.match_count ?? rows.length,
      multipleMatches: response.multiple_matches ?? rows.length > 1,
      cacheHit: ensured.cacheHit,
      etag: ensured.source.etag,
    },
    status: 'ok',
  }).catch(() => {});

  return {
    rows,
    matchCount: response.match_count ?? rows.length,
    multipleMatches: response.multiple_matches ?? rows.length > 1,
    query: { client, market },
    source: ensured.source,
    warnings: response.warnings ?? [],
  };
}

/**
 * Smoke check used by /api/health to verify Box + openpyxl + the file are all working.
 * Returns sheet count + row count + file metadata; throws on any failure (the health
 * check converts that to status='warn' or 'fail').
 */
export async function runSmoke(userId: string): Promise<MasterExcelSmokeResult> {
  const ensured = await ensureLocalFile(userId);
  const response = await runPython<PythonSmokeResponse>({
    action: 'smoke',
    filePath: ensured.localPath,
  });

  if (response.status === 'error') {
    throw new Error(`Python smoke returned error: ${response.error ?? 'unknown'}`);
  }

  return {
    ok: true,
    sheetCount: response.sheet_count ?? 0,
    sheetNames: response.sheet_names ?? [],
    primarySheet: response.primary_sheet ?? '',
    primaryRowCount: response.primary_row_count ?? 0,
    source: ensured.source,
  };
}

/**
 * Just the Box metadata (no file download, no Python). Used by /master-excel UI to show
 * "Last modified in Box: …" + the file name without pulling rows.
 */
export async function getFileMetadata(userId: string) {
  const boxFileId = requireFileIdEnv();
  const meta = await getFile(userId, boxFileId);
  if (!meta) {
    throw new Error(`Box file ${boxFileId} not accessible to user ${userId}.`);
  }
  return {
    boxFileId,
    name: meta.name,
    etag: meta.etag ?? null,
    modifiedAt: meta.modifiedAt ?? null,
    sizeBytes: meta.size,
  };
}

export const __SAFE_WRAPPER_VERSION = 'phase-4-reads';
