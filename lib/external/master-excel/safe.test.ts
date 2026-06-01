import { describe, test, expect } from 'vitest';
import * as masterExcelSafe from './safe';

/**
 * Forbidden-method assertion test (defense in depth alongside the pre-commit hook grep).
 * Required by BUILD_SPEC.md § "Enforcement" + AGENTS.md Hard Rules.
 *
 * Phase 4 ships READ ONLY methods. Phase 5 will add EXACTLY ONE write method:
 * `appendMasterExcelRow` (which calls Box's uploadNewVersion, never an overwrite).
 * Any of the patterns below appearing in safe.ts is a Hard Rule violation.
 */

const FORBIDDEN = [
  // Generic mutation verbs against the xlsx
  'writeMasterExcel',
  'updateMasterExcel',
  'deleteMasterExcel',
  'modifyMasterExcel',
  'overwriteMasterExcel',
  'replaceMasterExcel',
  // Per-cell / per-row mutations
  'setMasterExcelCell',
  'updateMasterExcelCell',
  'updateRow',
  'updateMasterExcelRow',
  'deleteRow',
  'deleteMasterExcelRow',
  // Save / replace whole file
  'saveMasterExcel',
  'saveFile',
  'replaceFile',
  'overwriteFile',
] as const;

describe('master-excel safe wrapper — forbidden methods are absent', () => {
  for (const method of FORBIDDEN) {
    test(`does not export "${method}"`, () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((masterExcelSafe as any)[method]).toBeUndefined();
    });
  }
});

describe('master-excel safe wrapper — allow-listed read methods ARE exported (Phase 4)', () => {
  const ALLOWED_READS = [
    'getCriticalDatesForClient',
    'getAllRows',
    'getFileMetadata',
    'runSmoke',
  ] as const;
  for (const method of ALLOWED_READS) {
    test(`exports "${method}"`, () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(typeof (masterExcelSafe as any)[method]).toBe('function');
    });
  }
});

describe('master-excel safe wrapper — write methods are NOT yet allow-listed (Phase 5 adds appendMasterExcelRow)', () => {
  test('appendMasterExcelRow is not exported in v1', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((masterExcelSafe as any).appendMasterExcelRow).toBeUndefined();
  });
});
