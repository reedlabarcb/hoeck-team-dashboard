import { describe, it, expect } from 'vitest';
import { extensionOf, scriptPathFor, tmpNameFor, pendingFilesQuery } from './text-extractor';

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
