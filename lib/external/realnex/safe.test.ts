import { describe, test, expect } from 'vitest';
import * as realnexSafe from './safe';

/**
 * Forbidden-method assertion test.
 * Required by BUILD_SPEC.md § "Enforcement".
 * This test MUST stay green. If it fails, a destructive RealNex method has leaked
 * into the safe wrapper — back it out before merging.
 */

const FORBIDDEN = [
  // Companies
  'updateCompany',
  'patchCompany',
  'putCompany',
  'deleteCompany',
  // Contacts
  'updateContact',
  'patchContact',
  'putContact',
  'deleteContact',
  // Activities
  'updateActivity',
  'patchActivity',
  'putActivity',
  'deleteActivity',
  // Groups
  'updateGroup',
  'patchGroup',
  'putGroup',
  'deleteGroup',
] as const;

describe('realnex safe wrapper — forbidden methods are absent', () => {
  for (const method of FORBIDDEN) {
    test(`does not export "${method}"`, () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((realnexSafe as any)[method]).toBeUndefined();
    });
  }
});
