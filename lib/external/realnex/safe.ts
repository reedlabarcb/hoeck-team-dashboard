/**
 * RealNex Safe Wrapper — Phase 3.
 *
 * The ONLY module application code uses to touch RealNex. It calls `realnexGet`
 * (read) from ./client. The HTTP client exposes no PUT/PATCH/DELETE primitive at
 * all, so the wrapper physically cannot mutate or delete — see ./client header.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WRITE POLICY (enforced here + in ./client + .husky/pre-commit + safe.test) │
 * │                                                                            │
 * │ ALLOWED:                                                                   │
 * │   • Create a new Company            (P3.6: createCompany)                  │
 * │   • Create a new Contact            (P3.6: createContact)                  │
 * │   • Append a NEW History/Activity to an EXISTING Company/Contact           │
 * │     (P3.9: appendActivity) — this CREATES a child object; it does NOT      │
 * │     edit the parent's fields. Nadya's Workflow 3 requires it.              │
 * │                                                                            │
 * │ FORBIDDEN — permanently:                                                   │
 * │   • Modifying ANY field on an existing Company/Contact (no PUT/PATCH)      │
 * │   • Deleting ANYTHING (no DELETE)                                          │
 * │                                                                            │
 * │ THIS PHASE (P3.1) IS READ-ONLY. No create methods yet; they arrive in P3.6 │
 * │ behind this same enforcement.                                              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Endpoints DELIBERATELY NOT WRAPPED (and never to be — they mutate/delete):
 *   • PUT  /api/v1/Crm/company/{key}            (PutEditCompanyAsync)   — edit company
 *   • PUT  /api/v1/Crm/company/{key}/notes      (PutCompanyNotesAsync)  — edit company notes
 *   • PUT  /api/v1/Crm/company/{key}/details    (PutCompanyDetailsAsync)— edit company details
 *   • DELETE /api/v1/Crm/company/{key}          (DeleteCompanyAsync)
 *   • PUT  /api/v1/Crm/contact/{key}            (PutEditContactAsync)   — edit contact
 *   • PUT  /api/v1/Crm/contact/{key}/notes      (PutContactNotesAsync)
 *   • PUT  /api/v1/Crm/contact/{key}/{personal|agent|investor|tenant|vendor}  — edit contact subresources
 *   • DELETE /api/v1/Crm/contact/{key}          (DeleteContactAsync)
 *   • PUT/DELETE on /api/v1/Crm/contact/{key}/address/...                       — edit/delete addresses
 *   • PUT  /api/v1/Crm/history/{key}            (PutHistoryAsync)       — edit history
 *   • DELETE /api/v1/Crm/history/{key}          (DeleteHistoryAsync)
 *   • DELETE /api/v1/Crm/history/{key}/object/{objectKey}                       — unlink history
 *   • PUT/DELETE on /api/v1/Crm/group/{key} and /members/...                    — edit/delete groups + membership
 * If you think you need one of these, you don't — re-read the WRITE POLICY above.
 *
 * Lineage: BUILD_SPEC.md § "Safety Rules → RealNex"; docs/PHASE3_BUILD_PLAN.md
 *          "RealNex Write Safety — Enforced in Code"; docs/RealNex_API_Discovery.md.
 */

import { realnexGet } from './client';
import type {
  RealNexClientInfo,
  RealNexGroupPage,
  RealNexLookupItem,
  RealNexContactAutocompleteItem,
  RealNexCompany,
  RealNexContact,
  RealNexHistoryPage,
  RealNexPaging,
} from './types';

const enc = encodeURIComponent;

// ----- Identity -----

/** GET /api/Client — the authed user/account (used by /api/health + connectivity probe). */
export function getClientInfo(): Promise<RealNexClientInfo> {
  return realnexGet<RealNexClientInfo>('/api/Client', { query: { 'api-version': '1.0' } });
}

// ----- Lookup tables (populate dropdowns) -----

/** GET /api/v1/Crm/group — Object Groups (Workflow 2 "Group" dropdown). Paginated. */
export function listGroups(paging: RealNexPaging = {}): Promise<RealNexGroupPage> {
  return realnexGet<RealNexGroupPage>('/api/v1/Crm/group', {
    query: { PageNumber: paging.pageNumber ?? 1, PageSize: paging.pageSize ?? 200, Order: paging.order },
  });
}

/** GET /api/v1/Crm/eventtypes — History event-type options (Note/Call/Email/Meeting/…). */
export function listEventTypes(): Promise<RealNexLookupItem[] | Record<string, unknown>> {
  return realnexGet('/api/v1/Crm/eventtypes');
}

/** GET /api/v1/Crm/historystatuses — History status options. */
export function listHistoryStatuses(): Promise<RealNexLookupItem[] | Record<string, unknown>> {
  return realnexGet('/api/v1/Crm/historystatuses');
}

/** GET /api/v1/Crm/users — CRM users. */
export function listUsers(): Promise<RealNexLookupItem[]> {
  return realnexGet<RealNexLookupItem[]>('/api/v1/Crm/users');
}

// ----- Entity reads -----

/** GET /api/v1/Crm/company/{key}/full — rich read view of one company. */
export function getCompany(companyKey: string): Promise<RealNexCompany> {
  return realnexGet<RealNexCompany>(`/api/v1/Crm/company/${enc(companyKey)}/full`);
}

/** GET /api/v1/Crm/contact/{key}/full — rich read view of one contact. */
export function getContact(contactKey: string): Promise<RealNexContact> {
  return realnexGet<RealNexContact>(`/api/v1/Crm/contact/${enc(contactKey)}/full`);
}

/** GET /api/v1/Crm/contact/autocomplete — contact search by term. */
export function searchContacts(term: string, size = 10): Promise<RealNexContactAutocompleteItem[]> {
  return realnexGet<RealNexContactAutocompleteItem[]>('/api/v1/Crm/contact/autocomplete', {
    query: { Term: term, Size: size },
  });
}

/** GET /api/v1/Crm/object/{key}/history — the activity feed for a company OR contact. */
export function getObjectHistory(objectKey: string, paging: RealNexPaging = {}): Promise<RealNexHistoryPage> {
  return realnexGet<RealNexHistoryPage>(`/api/v1/Crm/object/${enc(objectKey)}/history`, {
    query: { PageNumber: paging.pageNumber ?? 1, PageSize: paging.pageSize ?? 50, Order: paging.order },
  });
}

// ----- Create methods: NOT in P3.1 (read-only phase). Added in P3.6: -----
// TODO(P3.6): createCompany(input): POST /api/v1/Crm/company       — tags Source: Dashboard
// TODO(P3.6): createContact(input): POST /api/v1/Crm/contact       — tags Source: Dashboard
// TODO(P3.9): appendActivity(objectKey, input): POST /api/v1/Crm/object/{key}/history
//             — CREATES a child History on an existing record; NOT a parent edit.
// (Each requires adding `realnexPost` to ./client. No PUT/PATCH/DELETE primitive — ever.)

/** Read-only this phase. Bumped when create methods land (P3.6). */
export const __SAFE_WRAPPER_VERSION = 'phase-3.1-readonly';
