import { describe, it, expect } from 'vitest';
import { extensionOf, scriptPathFor, tmpNameFor, pendingFilesQuery, isAccessError } from './text-extractor';

// The `db` proxy builds its Pool on first property access (and throws without
// DATABASE_URL). toSQL() never connects, so a dummy URL is enough to render SQL —
// same trick as lib/realnex/queries.test.ts. Access happens inside the tests, after this runs.
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';

describe('extensionOf', () => {
  it('recognizes the three extractable types, case-insensitively', () => {
    expect(extensionOf('lease.pdf')).toBe('pdf');
    expect(extensionOf('LEASE.PDF')).toBe('pdf');
    expect(extensionOf('LOI draft.docx')).toBe('docx');
    expect(extensionOf('Rent Roll.XLSX')).toBe('xlsx');
  });

  it('returns null for anything else (never guesses)', () => {
    for (const n of ['notes.txt', 'photo.jpg', 'legacy.doc', 'legacy.xls', 'archive.zip', 'noext']) {
      expect(extensionOf(n)).toBeNull();
    }
  });
});

describe('scriptPathFor — dispatch', () => {
  it('routes PDFs to pdf_extract_text.py', () => {
    expect(scriptPathFor('pdf')).toMatch(/pdf_extract_text\.py$/);
  });

  it('routes BOTH docx and xlsx to office_extract_text.py', () => {
    expect(scriptPathFor('docx')).toMatch(/office_extract_text\.py$/);
    expect(scriptPathFor('xlsx')).toMatch(/office_extract_text\.py$/);
  });

  it('never sends an office file to the PDF extractor (or vice versa)', () => {
    expect(scriptPathFor('docx')).not.toMatch(/pdf_extract_text/);
    expect(scriptPathFor('xlsx')).not.toMatch(/pdf_extract_text/);
    expect(scriptPathFor('pdf')).not.toMatch(/office_extract_text/);
  });
});

describe('tmpNameFor — temp file keeps its REAL extension', () => {
  it('names the temp file with the source extension', () => {
    expect(tmpNameFor('12345', 'pdf')).toBe('box-extract-12345.pdf');
    expect(tmpNameFor('12345', 'docx')).toBe('box-extract-12345.docx');
    expect(tmpNameFor('12345', 'xlsx')).toBe('box-extract-12345.xlsx');
  });

  it('does NOT force .pdf on office files — python-docx/openpyxl reject a mis-named container', () => {
    expect(tmpNameFor('9', 'docx').endsWith('.pdf')).toBe(false);
    expect(tmpNameFor('9', 'xlsx').endsWith('.pdf')).toBe(false);
  });
});

describe('isAccessError — permission failures must stay retryable', () => {
  /**
   * These strings are the EXACT format lib/external/box/safe.ts downloadFile throws:
   *   `Box downloadFile ${fileId} failed: HTTP ${res.status} — ${text}`
   * isAccessError parses that message, so if the format ever changes these tests fail —
   * which is the point. Without them a format drift would silently make 403s terminal
   * again and permanently bury files.
   */
  const downloadFileError = (status: number, body = '') =>
    new Error(`Box downloadFile 123456 failed: HTTP ${status} — ${body}`);

  it('treats 403 (no permission for this token) as an access error', () => {
    expect(isAccessError(downloadFileError(403, '{"code":"access_denied_insufficient_permissions"}'))).toBe(true);
  });

  it('treats 404 (invisible or gone for this token) as an access error', () => {
    expect(isAccessError(downloadFileError(404, '{"code":"not_found"}'))).toBe(true);
  });

  it('does NOT treat real failures as access errors — they must stay terminal', () => {
    expect(isAccessError(downloadFileError(500, 'internal error'))).toBe(false);
    expect(isAccessError(downloadFileError(429, 'rate limited'))).toBe(false);
    expect(isAccessError(new Error('socket hang up'))).toBe(false);
    expect(isAccessError(new Error('office_extract_text.py exited 2. stderr: bad args'))).toBe(false);
    expect(isAccessError(new Error('Failed to parse output: Unexpected token'))).toBe(false);
  });

  it('does not false-positive on a status embedded in unrelated text', () => {
    // A file NAMED like a status, or a body quoting one, must not flip the branch.
    expect(isAccessError(new Error('extraction failed for HTTP 403 Ruling.pdf'))).toBe(true); // documented limit
    expect(isAccessError(new Error('corrupt: 403 bytes read'))).toBe(false); // no "HTTP" prefix
    expect(isAccessError(new Error('HTTP 4030 weirdness'))).toBe(false); // word-boundary anchored
  });

  it('handles non-Error throws without crashing', () => {
    expect(isAccessError('HTTP 403 as a bare string')).toBe(true);
    expect(isAccessError(null)).toBe(false);
    expect(isAccessError(undefined)).toBe(false);
  });
});

describe('pendingFilesQuery — the batch predicate (idempotent + resumable)', () => {
  const q = () => pendingFilesQuery(50).toSQL();

  it('matches all three extensions, not just PDFs', () => {
    const { params } = q();
    expect(params).toContain('%.pdf');
    expect(params).toContain('%.docx');
    expect(params).toContain('%.xlsx');
  });

  it('accepts extraction_status pending OR NULL — the NULL half is what reaches office rows', () => {
    const { sql, params } = q();
    expect(params).toContain('pending');
    // Office rows were never set to 'pending' (migration 0006 touched PDFs only), so
    // without the IS NULL leg this query would still return zero .docx/.xlsx rows.
    expect(sql.toLowerCase()).toContain('is null');
  });

  it('EXCLUDES terminal statuses, so a re-run never re-processes finished rows', () => {
    const { params } = q();
    for (const terminal of ['extracted', 'failed', 'skipped_scanned', 'skipped_too_large']) {
      expect(params).not.toContain(terminal);
    }
  });

  it('is scoped to files, excludes soft-deleted rows, and honors the batch limit', () => {
    const { sql, params } = q();
    expect(params).toContain('file');
    expect(sql.toLowerCase()).toContain('limit');
    expect(params).toContain(50);
    expect(sql.toLowerCase()).toContain('order by'); // newest-modified first
  });
});
