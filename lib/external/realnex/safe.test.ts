import { describe, test, expect } from 'vitest';
import * as realnexSafe from './safe';

/**
 * RealNex safe-wrapper guardrail tests. Required by BUILD_SPEC.md § "Enforcement"
 * and docs/PHASE3_BUILD_PLAN.md "RealNex Write Safety — Enforced in Code".
 *
 * These MUST stay green. Two layers:
 *   1. SET-EQUALITY — the exported function surface must EXACTLY equal the allowlist.
 *      This fails if ANY method is added (not just a forbidden one), forcing a
 *      deliberate update here + review whenever the wrapper surface changes.
 *   2. FORBIDDEN — explicit belt-and-suspenders that named destructive methods are absent.
 */

// The EXACT set of methods the wrapper may export at this phase.
// P3.1 = 9 read methods. P3.4 added EXACTLY 3 more GET-only reads for the mirror
// sync (listCompanies, listContacts, getCompanyContacts) — still read-only, no
// create/update/delete. When create methods land in P3.6/P3.9, add EXACTLY
// 'createCompany', 'createContact', 'appendActivity' here — nothing else.
const ALLOWED = [
  'getClientInfo',
  'listGroups',
  'listEventTypes',
  'listHistoryStatuses',
  'listUsers',
  'getCompany',
  'getContact',
  'searchContacts',
  'getObjectHistory',
  // P3.4 read-only mirror-sync reads (GET only):
  'listCompanies',
  'listContacts',
  'getCompanyContacts',
] as const;

const FORBIDDEN = [
  // Companies — no edit/delete, ever
  'updateCompany', 'patchCompany', 'putCompany', 'editCompany', 'deleteCompany',
  // Contacts
  'updateContact', 'patchContact', 'putContact', 'editContact', 'deleteContact',
  // Activities / History
  'updateActivity', 'patchActivity', 'putActivity', 'deleteActivity',
  'updateHistory', 'putHistory', 'deleteHistory',
  // Groups + membership
  'updateGroup', 'patchGroup', 'putGroup', 'deleteGroup', 'deleteGroupMember',
] as const;

describe('realnex safe wrapper — exported surface', () => {
  test('exports EXACTLY the allowlisted methods (set-equality)', () => {
    const exportedFns = Object.keys(realnexSafe)
      .filter((k) => typeof (realnexSafe as Record<string, unknown>)[k] === 'function')
      .sort();
    expect(exportedFns).toEqual([...ALLOWED].sort());
  });
});

describe('realnex safe wrapper — forbidden methods are absent', () => {
  for (const method of FORBIDDEN) {
    test(`does not export "${method}"`, () => {
      expect((realnexSafe as Record<string, unknown>)[method]).toBeUndefined();
    });
  }
});
