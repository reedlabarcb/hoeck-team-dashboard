/**
 * Behavioral tests for the access-failure branch in runTextExtraction.
 *
 * The assertion that matters is the NEGATIVE one: on a 403/404 the worker must write
 * NOTHING to the row, leaving extraction_status pending/NULL so a later run under a
 * broader Box token retries it. Writing 'failed' there would bury the file permanently
 * (the batch predicate excludes 'failed' and nothing retries it).
 *
 * Lives in its own file because it mocks @/lib/db — text-extractor.test.ts needs the REAL
 * db proxy to render toSQL(), and the two can't share a module registry.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any */

const h = vi.hoisted(() => ({
  rows: [] as any[],
  updates: [] as any[], // every db.update().set(...) payload the worker writes
  downloadError: null as unknown,
}));

vi.mock('@/lib/db', () => ({
  db: {
    select: () => {
      const chain: any = {
        from: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: () => Promise.resolve(h.rows),
      };
      return chain;
    },
    update: () => ({
      set: (values: any) => ({
        where: () => {
          h.updates.push(values);
          return Promise.resolve();
        },
      }),
    }),
  },
}));

// downloadFile throws BEFORE any filesystem/subprocess work, so this is the only Box
// dependency the failure paths reach.
vi.mock('./safe', () => ({
  downloadFile: vi.fn(async () => {
    if (h.downloadError) throw h.downloadError;
    return {} as any;
  }),
}));

import { runTextExtraction } from './text-extractor';

const ctx = () => ({ jobId: 'JOB-1', walkId: 'WALK-1', reportProgress: vi.fn(async () => {}) }) as any;
const run = () => runTextExtraction({ userId: 'user-1', jobContext: ctx(), maxItems: 10 });

// The exact message shape lib/external/box/safe.ts downloadFile throws.
const downloadFileError = (status: number) =>
  new Error(`Box downloadFile B1 failed: HTTP ${status} — {"code":"x"}`);

beforeEach(() => {
  h.rows = [{ boxId: 'B1', name: 'Lease Abstract.docx', pathSegments: ['Clients', 'Acme'] }];
  h.updates = [];
  h.downloadError = null;
  vi.clearAllMocks();
});

describe('403 / 404 — permission failures are NOT terminal', () => {
  it('403 leaves the row completely untouched and counts as skippedNoAccess', async () => {
    h.downloadError = downloadFileError(403);
    const res = await run();

    expect(h.updates).toHaveLength(0); // THE point: no status write at all
    expect(res.skippedNoAccess).toBe(1);
    expect(res.failed).toBe(0);
    expect(res.skipped).toBe(1); // no-access rolls into skipped
    expect(res.processed).toBe(1); // still processed/advanced
  });

  it('404 (invisible to this token) behaves the same', async () => {
    h.downloadError = downloadFileError(404);
    const res = await run();

    expect(h.updates).toHaveLength(0);
    expect(res.skippedNoAccess).toBe(1);
    expect(res.failed).toBe(0);
  });

  it('the row stays eligible: nothing was written, so the next run re-selects it', async () => {
    h.downloadError = downloadFileError(403);
    await run();
    // No extraction_status was set → the row is still pending/NULL → the batch predicate
    // (pending OR NULL) picks it up again. Simulate the next run under a working token.
    h.downloadError = null;
    h.updates = [];
    const res2 = await run();
    expect(res2.skippedNoAccess).toBe(0); // retried, not skipped this time
  });
});

describe('real failures stay terminal', () => {
  it('a 500 writes extraction_status=failed with the error preserved', async () => {
    h.downloadError = downloadFileError(500);
    const res = await run();

    expect(res.failed).toBe(1);
    expect(res.skippedNoAccess).toBe(0);
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0].extractionStatus).toBe('failed');
    expect(String(h.updates[0].extractionError)).toContain('HTTP 500');
  });

  it('a non-HTTP error (network/spawn) is also terminal', async () => {
    h.downloadError = new Error('socket hang up');
    const res = await run();

    expect(res.failed).toBe(1);
    expect(res.skippedNoAccess).toBe(0);
    expect(h.updates[0].extractionStatus).toBe('failed');
  });
});

describe('counter invariant', () => {
  it('processed = succeeded + failed + skipped across a mixed batch', async () => {
    h.rows = [
      { boxId: 'B1', name: 'a.docx', pathSegments: [] },
      { boxId: 'B2', name: 'b.xlsx', pathSegments: [] },
    ];
    h.downloadError = downloadFileError(403);
    const res = await run();

    expect(res.processed).toBe(res.succeeded + res.failed + res.skipped);
    expect(res.skippedNoAccess).toBe(2);
    expect(h.updates).toHaveLength(0);
  });
});
