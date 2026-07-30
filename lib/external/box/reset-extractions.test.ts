import { describe, it, expect, vi, beforeEach } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any */

const h = vi.hoisted(() => ({
  /** Rows affected per successive db.execute() call — models draining then exhausting. */
  rowCounts: [] as number[],
  calls: [] as string[],
}));

vi.mock('@/lib/db', () => ({
  db: {
    execute: (q: any) => {
      // Render the drizzle SQL object loosely, just enough to assert the filter is present.
      h.calls.push(JSON.stringify(q?.queryChunks ?? q ?? {}));
      const n = h.rowCounts.shift() ?? 0;
      return Promise.resolve({ rowCount: n });
    },
  },
}));

import { resetFailedExtractions, resetPredicate, ACCESS_ERROR_SQL } from './reset-extractions';

beforeEach(() => {
  h.rowCounts = [];
  h.calls = [];
  vi.clearAllMocks();
});

describe('resetPredicate — what gets requeued', () => {
  it("only targets rows that are actually 'failed', and never soft-deleted ones", () => {
    for (const mode of ['access', 'all'] as const) {
      expect(resetPredicate(mode)).toContain("extraction_status = 'failed'");
      expect(resetPredicate(mode)).toContain('deleted_at IS NULL');
    }
  });

  it("access mode (the DEFAULT) filters to permission failures only", () => {
    const p = resetPredicate('access');
    expect(p).toContain("extraction_error LIKE '%HTTP 403%'");
    expect(p).toContain("extraction_error LIKE '%HTTP 404%'");
    expect(p).toContain(ACCESS_ERROR_SQL);
  });

  it('all mode drops the error filter — genuinely corrupt files come back too', () => {
    const p = resetPredicate('all');
    expect(p).not.toContain('extraction_error');
    expect(p).not.toContain('HTTP 403');
  });

  it('access mode is strictly narrower than all mode', () => {
    expect(resetPredicate('access').length).toBeGreaterThan(resetPredicate('all').length);
    expect(resetPredicate('access').startsWith(resetPredicate('all'))).toBe(true);
  });
});

describe('resetFailedExtractions', () => {
  it('defaults to the FILTERED reset, not a blanket one', async () => {
    h.rowCounts = [0];
    const res = await resetFailedExtractions();
    expect(res.mode).toBe('access');
  });

  it('ignores a bogus mode and still defaults to access', async () => {
    h.rowCounts = [0];
    const res = await resetFailedExtractions({ mode: 'nonsense' as any });
    expect(res.mode).toBe('access');
  });

  it('chunks until a pass affects zero rows, summing the total', async () => {
    h.rowCounts = [500, 500, 23, 0];
    const res = await resetFailedExtractions({ chunkSize: 500 });
    expect(res.updated).toBe(1023);
    expect(res.chunks).toBe(4); // three draining passes + the terminating zero pass
    expect(res.truncated).toBe(false);
  });

  it('is IDEMPOTENT — a re-run after everything is flipped matches nothing', async () => {
    h.rowCounts = [12, 0];
    const first = await resetFailedExtractions();
    expect(first.updated).toBe(12);

    // Re-run: rows are no longer 'failed', so the predicate matches nothing.
    h.rowCounts = [0];
    const second = await resetFailedExtractions();
    expect(second.updated).toBe(0);
    expect(second.chunks).toBe(1);
  });

  it('clamps the chunk size into a sane range', async () => {
    h.rowCounts = [0];
    await expect(resetFailedExtractions({ chunkSize: 0 })).resolves.toBeTruthy();
    h.rowCounts = [0];
    await expect(resetFailedExtractions({ chunkSize: 10_000_000 })).resolves.toBeTruthy();
  });

  it('the UPDATE clears the stale error and requeues as pending', async () => {
    h.rowCounts = [1, 0];
    await resetFailedExtractions();
    const sqlText = h.calls.join(' ');
    expect(sqlText).toContain('pending');
    expect(sqlText).toContain('extraction_error');
    expect(sqlText).toContain('reset_extractions');
  });
});
