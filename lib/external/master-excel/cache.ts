/**
 * In-memory cache for the Master Excel file: avoids re-downloading from Box on every
 * lookup. Key = box_file_id + etag. TTL = 5 minutes from last download.
 *
 * Why etag-keyed and not just TTL-keyed:
 *   The cache returns a HIT only if Box's current etag for the file matches our cached
 *   one. So if Mike edits the file in Box, the next request sees a new etag → cache miss
 *   → fresh download + parse, even before the 5-min TTL elapses. The TTL is a backstop
 *   for the opposite case: when we don't want to hit Box repeatedly for `etag` lookups
 *   either, we trust our cached etag for `CACHE_TTL_MS`.
 *
 * Strategy on each request:
 *   1. If we have a cached entry AND it's within TTL → return cached (no Box hit at all).
 *   2. Else: fetch file metadata from Box, compare etag.
 *      - same etag → refresh `fetchedAt` to extend TTL, return cached.
 *      - different etag (or no cache) → download + reparse, replace cache.
 *
 * Storage:
 *   - File bytes go to a temp directory (os.tmpdir() under "hoeck-master-excel/").
 *   - Parsed results live in memory.
 *   - Both rotate when etag changes.
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { MasterExcelAllRowsResult, MasterExcelLookupResult } from './types';

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  etag: string | null;
  fetchedAt: number; // ms epoch — Date.now()
  localFilePath: string;
  /** Lazily populated by the wrapper after first parse — keyed by python action. */
  parsedAll?: MasterExcelAllRowsResult;
  // Lookup results are derived from parsedAll client-side so we don't cache them per-query.
}

const cache = new Map<string, CacheEntry>();

export const MASTER_EXCEL_CACHE_TTL_MS = CACHE_TTL_MS;

export function getCacheEntry(boxFileId: string): CacheEntry | undefined {
  const entry = cache.get(boxFileId);
  if (!entry) return undefined;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    // Stale by time. Treat as miss; let caller decide whether to refresh via etag check.
    return undefined;
  }
  return entry;
}

export function setCacheEntry(boxFileId: string, etag: string | null, localFilePath: string): CacheEntry {
  const entry: CacheEntry = {
    etag,
    fetchedAt: Date.now(),
    localFilePath,
  };
  cache.set(boxFileId, entry);
  return entry;
}

export function bumpCacheTimestamp(boxFileId: string): void {
  const entry = cache.get(boxFileId);
  if (entry) entry.fetchedAt = Date.now();
}

export function setCachedParsedAll(boxFileId: string, parsed: MasterExcelAllRowsResult): void {
  const entry = cache.get(boxFileId);
  if (entry) entry.parsedAll = parsed;
}

/** Pure type re-export to clarify the lookup vs all relationship for IDE intellisense. */
export type CachedLookupOf<T extends MasterExcelLookupResult | MasterExcelAllRowsResult> = T;

export function getLocalTempDir(): string {
  const dir = join(tmpdir(), 'hoeck-master-excel');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Test-only — clears the cache so tests don't bleed state. */
export function __resetCache(): void {
  cache.clear();
}
