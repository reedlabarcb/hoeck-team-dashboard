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
  RealNexCompanyListItem,
  RealNexContactListItem,
  RealNexContactListItemPage,
} from './types';

const enc = encodeURIComponent;

/**
 * Extract the row array from a RealNex OData response. The CrmOData feeds are ASP.NET Core
 * OData ([EnableQuery]) endpoints returning the standard envelope
 * { "@odata.context": ..., "value": [...] } - NOT a raw array (that wrong assumption cost a
 * sync run: "TypeError: e is not iterable"). Accept a raw array too, and LOUDLY log any other
 * shape instead of silently syncing nothing.
 */
function odataArray<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (raw && typeof raw === 'object') {
    const v = (raw as { value?: unknown }).value;
    if (Array.isArray(v)) return v as T[];
    console.warn(
      `[realnex] unexpected OData response shape (keys: ${Object.keys(raw as object).join(', ') || 'none'}); treating as empty`,
    );
  }
  return [];
}

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

// ----- OData enumeration + inversion (P3.4 read-only mirror sync) -----

/**
 * GET /api/v1/CrmOData/Companies — one OData page of companies (READ-ONLY).
 * Response is the OData ENVELOPE { "@odata.context": ..., "value": [...] } (ASP.NET OData);
 * odataArray() pulls the `value` array. Page with $skip/$top, stop under a full page. RealNex HARD-CAPS
 * $top at 100 (HTTP 400 "The limit of '100' for Top query has been exceeded" above that),
 * so top defaults to 100. The company NAME is each item's `organizationId` (see
 * realnex-companies.ts gotcha).
 */
export async function listCompanies(skip = 0, top = 100): Promise<RealNexCompanyListItem[]> {
  const raw = await realnexGet<unknown>('/api/v1/CrmOData/Companies', {
    query: { '$skip': skip, '$top': top },
  });
  return odataArray<RealNexCompanyListItem>(raw);
}

/**
 * GET /api/v1/CrmOData/Contacts — one OData page of contacts (READ-ONLY).
 * Same OData {value:[...]} envelope + $skip/$top paging as listCompanies.
 */
export async function listContacts(skip = 0, top = 100): Promise<RealNexContactListItem[]> {
  const raw = await realnexGet<unknown>('/api/v1/CrmOData/Contacts', {
    query: { '$skip': skip, '$top': top },
  });
  return odataArray<RealNexContactListItem>(raw);
}

/**
 * GET /api/v1/Crm/company/{key}/contacts — contacts linked to one company (READ-ONLY).
 * The ONLY read-side path to the contact->company link (RealNex exposes no company
 * field on contact reads), so this drives the sync's inversion/linking phase.
 * Paginated via PageNumber/PageSize; returns a {items,totalCount} envelope.
 */
export function getCompanyContacts(
  companyKey: string,
  paging: RealNexPaging = {},
): Promise<RealNexContactListItemPage> {
  return realnexGet<RealNexContactListItemPage>(`/api/v1/Crm/company/${enc(companyKey)}/contacts`, {
    query: { PageNumber: paging.pageNumber ?? 1, PageSize: paging.pageSize ?? 200, Order: paging.order },
  });
}

// ----- Create methods: NOT in P3.1 (read-only phase). Added in P3.6: -----
// TODO(P3.6): createCompany(input): POST /api/v1/Crm/company       — tags Source: Dashboard
// TODO(P3.6): createContact(input): POST /api/v1/Crm/contact       — tags Source: Dashboard
// TODO(P3.9): appendActivity(objectKey, input): POST /api/v1/Crm/object/{key}/history
//             — CREATES a child History on an existing record; NOT a parent edit.
// (Each requires adding `realnexPost` to ./client. No PUT/PATCH/DELETE primitive — ever.)

/** Still read-only (P3.4 added GET-only OData reads). Bumped to *-writes when create methods land (P3.6). */
export const __SAFE_WRAPPER_VERSION = 'phase-3.4-readonly';
