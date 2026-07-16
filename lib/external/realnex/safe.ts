/**
 * RealNex Safe Wrapper — Phase 3.
 *
 * The ONLY module application code uses to touch RealNex. Reads go through `realnexGet`; the one
 * write goes through `realnexAppendObjectHistory` (both from ./client). Those are the ONLY two
 * HTTP primitives that exist — no PUT/PATCH/DELETE, no generic POST — so the list below is the
 * COMPLETE and EXHAUSTIVE contract, enforced BY CONSTRUCTION, not by convention.
 *
 * ┌────────────────────────────────────────────────────────────────────────────────────┐
 * │ WHAT THE DASHBOARD CAN DO TO RealNex — the entire contract:                          │
 * │                                                                                      │
 * │  READ (12 GETs): getClientInfo, listGroups, listEventTypes, listHistoryStatuses,     │
 * │    listUsers, getCompany, getContact, searchContacts, getObjectHistory,              │
 * │    listCompanies, listContacts, getCompanyContacts.                                  │
 * │                                                                                      │
 * │  ADD A NOTE (1 create): appendActivity — POSTs a NEW History child onto an EXISTING  │
 * │    company/contact (POST /object/{key}/history). CREATES a child activity; does NOT  │
 * │    touch the parent's fields. Nadya's Workflow 3 needs exactly this.                 │
 * │                                                                                      │
 * │ WHAT THE DASHBOARD CAN *NEVER* DO — not now, not ever, and NOT EXPRESSIBLE in code:  │
 * │  • EDIT / MODIFY any field on any existing company, contact, history, or group       │
 * │    — no PUT/PATCH primitive exists.                                                  │
 * │  • DELETE anything — no DELETE primitive exists.                                     │
 * │  • MOVE / RE-PARENT anything — change a contact's company, move a history to another │
 * │    object, add/remove group membership. "Moving" is an edit; no primitive expresses  │
 * │    it.                                                                               │
 * │                                                                                      │
 * │ Adding a note is an APPEND (a new child object), NEVER a touch to the parent record. │
 * └────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Enforced in FOUR independent layers:
 *   1. HTTP client (./client) exposes only realnexGet + realnexAppendObjectHistory (path-LOCKED
 *      to /object/{key}/history) — edit/delete/move/re-parent are UNEXPRESSIBLE, not just banned.
 *   2. This wrapper exports EXACTLY the 13 methods listed above — nothing that mutates a parent.
 *   3. .husky/pre-commit greps forbidden method names + verbs (incl. move/re-parent) outside
 *      lib/external/, and blocks any raw sync.realnex.com reference outside this dir.
 *   4. safe.test.ts asserts the surface by SET-EQUALITY (adding ANY method fails) + an explicit
 *      forbidden-list (update/delete/put/patch/move/re-parent all toBeUndefined()).
 *
 * ⚠️ READ vs WRITE CASING — RealNex READS are PascalCase (OrganizationId, Address1, City, WebSite);
 *    CREATE bodies are camelCase, the EXACT INVERSE (organization, address1, city, webSite). When the
 *    create wrappers land (P3.7/P3.8: createCompany/createContact) they build camelCase bodies per the
 *    CreateCompany/CreateContact schemas. NEVER build a create body from a read-side (PascalCase)
 *    shape — RealNex silently ignores unknown keys and creates a blank record. See the "CASING
 *    INVERSION" banner in ./types.ts (CreateCompanyInput / CreateContactInput).
 *
 * Endpoints DELIBERATELY NOT WRAPPED (and never to be — they edit / delete / move / re-parent):
 *   • PUT  /api/v1/Crm/company/{key}            (PutEditCompanyAsync)   — edit company
 *   • PUT  /api/v1/Crm/company/{key}/notes      (PutCompanyNotesAsync)  — edit company notes
 *   • PUT  /api/v1/Crm/company/{key}/details    (PutCompanyDetailsAsync)— edit company details
 *   • DELETE /api/v1/Crm/company/{key}          (DeleteCompanyAsync)
 *   • PUT  /api/v1/Crm/contact/{key}            (PutEditContactAsync)   — edit contact (incl. its
 *                                                                          company → this is a MOVE)
 *   • PUT  /api/v1/Crm/contact/{key}/notes      (PutContactNotesAsync)
 *   • PUT  /api/v1/Crm/contact/{key}/{personal|agent|investor|tenant|vendor}  — edit contact subresources
 *   • DELETE /api/v1/Crm/contact/{key}          (DeleteContactAsync)
 *   • PUT/DELETE on /api/v1/Crm/contact/{key}/address/...                       — edit/delete addresses
 *   • PUT  /api/v1/Crm/history/{key}            (PutHistoryAsync)       — edit history
 *   • DELETE /api/v1/Crm/history/{key}          (DeleteHistoryAsync)
 *   • POST /api/v1/Crm/history/{key}/object     (PostHistoryObjectsAsync) — RE-LINK a history to
 *                                                                          another object (a MOVE)
 *   • DELETE /api/v1/Crm/history/{key}/object/{objectKey}                       — unlink history
 *   • POST /api/v1/Crm/group/{key}/members      (PostObjectGroupMembersAsync) — add group membership
 *                                                                          (RE-PARENT into a group)
 *   • PUT/DELETE on /api/v1/Crm/group/{key} and /members/...                    — edit/delete groups + membership
 * If you think you need one of these, you don't — re-read the contract above.
 *
 * Lineage: BUILD_SPEC.md § "Safety Rules → RealNex"; docs/PHASE3_BUILD_PLAN.md
 *          "RealNex Write Safety — Enforced in Code"; docs/RealNex_API_Discovery.md.
 */

import { realnexGet, realnexAppendObjectHistory } from './client';
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
  AppendActivityInput,
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

// ----- Create methods (create-only — NO update / delete / move / re-parent, ever) -----

/**
 * appendActivity — CREATE a new History child on an EXISTING company or contact.
 *
 * ADD-ONLY. POSTs a brand-new History object linked to `objectKey`; it does NOT read back, edit,
 * move, re-parent, or delete the parent, and touches NONE of the parent's fields. `objectKey` is
 * the parent's RealNex object key (a company or contact key — the same key the P3.5.4 resolver
 * returns). It calls the path-LOCKED realnexAppendObjectHistory primitive, so it can only ever
 * hit POST /api/v1/Crm/object/{key}/history — never any other endpoint.
 *
 * The write body is the EditHistory model (shape confirmed against the live API): the event type
 * is the NUMERIC `eventTypeKey` (e.g. 18 = Note; see REALNEX_EVENT_TYPE), plus subject/notes and
 * start/end timestamps (default now). No parent identifier beyond objectKey is sent, so there is
 * no field on the parent this could possibly change.
 */
export function appendActivity(objectKey: string, input: AppendActivityInput): Promise<unknown> {
  const now = new Date().toISOString().slice(0, 19); // "YYYY-MM-DDTHH:mm:ss" — RealNex stores naive-local
  const start = input.startDate ?? now;
  const body = {
    eventTypeKey: input.eventTypeKey,
    subject: input.subject,
    notes: input.notes ?? '',
    startDate: start,
    endDate: input.endDate ?? start,
    timeless: input.timeless ?? false,
    published: input.published ?? false,
  };
  return realnexAppendObjectHistory<unknown>(objectKey, body);
}

// createCompany / createContact are intentionally NOT here — note-logging doesn't need them, and
// every write method is risk on a live CRM. They belong with their forms (P3.7/P3.8) and would get
// their own narrow create primitives + a safe.test set-equality update if/when those are built.

/** Read methods + the single create (appendActivity). Bumped from phase-3.4-readonly (P3.6). */
export const __SAFE_WRAPPER_VERSION = 'phase-3.6-append-activity';
