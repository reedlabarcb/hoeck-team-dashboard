/**
 * RealNex Safe Wrapper — Phase 3.
 *
 * The ONLY module application code uses to touch RealNex. Reads go through `realnexGet`; writes go
 * through `realnexAppendObjectHistory` (append a History child) and `postCompany`/`postContact`
 * (create a new top-level record) — all path-locked in ./client. There is NO PUT/PATCH/DELETE and NO
 * generic POST primitive, so the list below is the COMPLETE and EXHAUSTIVE contract, enforced BY
 * CONSTRUCTION, not by convention.
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
 * │  CREATE RECORDS (2 creates, P3.7/P3.8): createCompany, createContact — a SINGLE      │
 * │    INLINE POST /Crm/company | /Crm/contact that ADDS a new top-level record. Creates │
 * │    a new record; touches NO existing record. camelCase body (inverse of read side).  │
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
 *   1. HTTP client (./client) exposes only realnexGet + realnexAppendObjectHistory + postCompany +
 *      postContact — each POST path-LOCKED to a fixed endpoint (no caller-supplied path) — so
 *      edit/delete/move/re-parent are UNEXPRESSIBLE, not just banned.
 *   2. This wrapper exports EXACTLY the 15 methods listed above — 12 reads + 3 creates; nothing that
 *      edits, deletes, or moves an existing record.
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

import { realnexGet, realnexAppendObjectHistory, postCompany, postContact } from './client';
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
  CreateCompany,
  CreateContact,
  CreateCompanyInput,
  CreateContactInput,
  CreateAddressInput,
  EditAddressPrincipal,
  RealNexCreateFlags,
  CreateResult,
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

// ----- Create RECORDS (P3.7/P3.8) — create-only: a NEW top-level company/contact via a SINGLE
//       INLINE POST (address nested, flags booleans, companyKey inline, objectGroups string[]). NO
//       edit/delete/move/re-parent; touches no existing record. Bodies are camelCase — the INVERSE of
//       the PascalCase read side (see ./types.ts "CASING INVERSION"). -----

const CREATE_FLAG_KEYS = ['investor', 'tenant', 'agent', 'vendor', 'prospect', 'personal'] as const;

/** Only set flags the caller explicitly turned on (true); omit the rest so the server defaults them. */
function flagBody(input: RealNexCreateFlags): Partial<RealNexCreateFlags> {
  const out: Partial<RealNexCreateFlags> = {};
  for (const f of CREATE_FLAG_KEYS) if (input[f] === true) out[f] = true;
  return out;
}

/**
 * Build the INLINE EditAddressPrincipal from our CreateAddressInput — only the six fields our form
 * exposes; latitude/longitude/timeZoneKey/company are omitted so the server defaults/geocodes. Returns
 * undefined when nothing meaningful was entered (so we omit `address` entirely rather than send {}).
 */
function toAddressBody(a?: CreateAddressInput): EditAddressPrincipal | undefined {
  if (!a) return undefined;
  const out: EditAddressPrincipal = {};
  for (const k of ['address1', 'address2', 'city', 'state', 'zipCode', 'country'] as const) {
    const v = a[k]?.trim();
    if (v) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * createCompany — CREATE a new company (single inline POST /api/v1/Crm/company). Maps our
 * CreateCompanyInput → the camelCase CreateCompany body: `organization` (the name), inline address,
 * inline flags, inline objectGroups. `organization` is REQUIRED at runtime (not just in TS). Returns
 * the new key. userKey/teamKey are left UNSET → RealNex attributes the record to the JWT identity
 * (Mike) — the documented single-identity tradeoff; we have no configured user/team key to thread.
 */
export async function createCompany(input: CreateCompanyInput): Promise<CreateResult> {
  const organization = input.organization?.trim();
  if (!organization) throw new Error('createCompany: organization (company name) is required');
  const address = toAddressBody(input.address);
  const body: CreateCompany = {
    organization,
    ...(input.subsidiary?.trim() ? { subsidiary: input.subsidiary.trim() } : {}),
    ...(input.phone?.trim() ? { phone: input.phone.trim() } : {}),
    ...(input.fax?.trim() ? { fax: input.fax.trim() } : {}),
    ...(input.email?.trim() ? { email: input.email.trim() } : {}),
    ...(input.webSite?.trim() ? { webSite: input.webSite.trim() } : {}),
    ...flagBody(input),
    ...(address ? { address } : {}),
    ...(input.objectGroups?.length ? { objectGroups: input.objectGroups } : {}),
  };
  const { key } = await postCompany(body);
  return { key, warnings: [] };
}

/**
 * createContact — CREATE a new contact (single inline POST /api/v1/Crm/contact). Maps our
 * CreateContactInput → the camelCase CreateContact body: name (fullName OR firstName/lastName),
 * `companyKey` INLINE (the parent link — no separate call), work/mobile/home/fax inline (a contact has
 * NO `phone`), inline flags, inline objectGroups. Name is REQUIRED at runtime. `useCompanyAddress`
 * true → the inline `address` is OMITTED (inherit from the company) AND a companyKey is REQUIRED (a
 * contact cannot inherit an address from a company it isn't linked to) — throws otherwise.
 */
export async function createContact(input: CreateContactInput): Promise<CreateResult> {
  const fullName = input.fullName?.trim();
  const firstName = input.firstName?.trim();
  const lastName = input.lastName?.trim();
  if (!fullName && !firstName && !lastName) {
    throw new Error('createContact: a name is required (fullName, or firstName and/or lastName)');
  }
  if (input.useCompanyAddress && !input.companyKey?.trim()) {
    throw new Error(
      'createContact: useCompanyAddress requires a companyKey — a contact cannot inherit an address from a company it is not linked to',
    );
  }
  const address = input.useCompanyAddress ? undefined : toAddressBody(input.address);
  const body: CreateContact = {
    ...(fullName ? { fullName } : {}),
    ...(firstName ? { firstName } : {}),
    ...(lastName ? { lastName } : {}),
    ...(input.title?.trim() ? { title: input.title.trim() } : {}),
    ...(input.salutation?.trim() ? { salutation: input.salutation.trim() } : {}),
    ...(input.greeting?.trim() ? { greeting: input.greeting.trim() } : {}),
    ...(input.companyKey?.trim() ? { companyKey: input.companyKey.trim() } : {}),
    ...(input.useCompanyAddress ? { useCompanyAddress: true } : {}),
    ...flagBody(input),
    ...(input.work?.trim() ? { work: input.work.trim() } : {}),
    ...(input.mobile?.trim() ? { mobile: input.mobile.trim() } : {}),
    ...(input.home?.trim() ? { home: input.home.trim() } : {}),
    ...(input.fax?.trim() ? { fax: input.fax.trim() } : {}),
    ...(input.email?.trim() ? { email: input.email.trim() } : {}),
    ...(input.webSite?.trim() ? { webSite: input.webSite.trim() } : {}),
    ...(address ? { address } : {}),
    ...(input.objectGroups?.length ? { objectGroups: input.objectGroups } : {}),
  };
  const { key } = await postContact(body);
  return { key, warnings: [] };
}

/** Read methods + the 3 creates (appendActivity + createCompany + createContact). */
export const __SAFE_WRAPPER_VERSION = 'phase-3.7-create-company-contact';
