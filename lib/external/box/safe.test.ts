import { describe, test, expect } from 'vitest';
import * as boxSafe from './safe';
import { DEAL_FOLDER_PATTERN } from './safe';

/**
 * Forbidden-method assertion test.
 * Required by BUILD_SPEC.md § "Enforcement".
 * This test MUST stay green. If it fails, a destructive Box method has leaked
 * into the safe wrapper — back it out before merging.
 */

const FORBIDDEN = [
  'deleteFile',
  'deleteFolder',
  'moveFile',
  'moveFolder',
  'renameFile',
  // Generic renameFolder is forbidden — only renameDealFolder is allowed.
  'renameFolder',
  // No same-version overwrite. uploadNewVersion is allowed.
  'overwriteFile',
  'replaceFile',
] as const;

describe('box safe wrapper — forbidden methods are absent', () => {
  for (const method of FORBIDDEN) {
    test(`does not export "${method}"`, () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((boxSafe as any)[method]).toBeUndefined();
    });
  }
});

describe('box safe wrapper — allow-listed read methods ARE exported (Phase 2)', () => {
  const ALLOWED_READS = ['listFolder', 'getFolder', 'getFile', 'getFileVersions', 'downloadFile', 'searchFolderTree'] as const;
  for (const method of ALLOWED_READS) {
    test(`exports "${method}"`, () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(typeof (boxSafe as any)[method]).toBe('function');
    });
  }
});

describe('DEAL_FOLDER_PATTERN', () => {
  test.each([
    '2026 – Lease Acquisition',
    '2026 – Lease Acquisition – 350 10th Ave',
    '2026 – Lease Disposition – 350 10th Ave',
    '2018–2025 – Lease Acquisition – Lake Oswego',
    '2024-2026 - Lease Acquisition - Some Address',
  ])('matches valid deal folder name: "%s"', (name) => {
    expect(DEAL_FOLDER_PATTERN.test(name)).toBe(true);
  });

  test.each([
    'Some Random Folder',
    'Lease Acquisition – 350 10th Ave', // missing year
    '2026 – Lease Renewal – 350 10th Ave', // wrong deal type
    '26 – Lease Acquisition', // 2-digit year
    'Survey(s)', // wrong shape entirely
  ])('rejects invalid deal folder name: "%s"', (name) => {
    expect(DEAL_FOLDER_PATTERN.test(name)).toBe(false);
  });
});
