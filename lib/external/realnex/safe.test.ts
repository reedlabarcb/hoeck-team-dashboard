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
// P3.1 = 9 reads. P3.4 added 3 GET-only reads (listCompanies, listContacts, getCompanyContacts).
// P3.6 added EXACTLY ONE create — 'appendActivity' (add-only child append). createCompany /
// createContact are deliberately NOT added (deferred to P3.7/P3.8); if they ever land, add them
// here too — this set-equality test forces that deliberate update + review.
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
  // P3.6 — the ONE create (add-only child History append; NO update/delete/move):
  'appendActivity',
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
  // Move / re-parent — "moving" a record is an EDIT; must be as impossible as delete
  'moveContact', 'moveCompany', 'reparentContact', 'reparentCompany',
  'setContactCompany', 'changeContactCompany', 'moveActivity', 'moveHistory',
  'reparentHistory', 'addGroupMember', 'removeGroupMember',
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
