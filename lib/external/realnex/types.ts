/**
 * RealNex types — Phase 1 placeholders.
 * Real shapes will be derived from the RealNex API spec in Phase 3.
 */

export interface Company {
  id: string;
  name: string;
  address?: string;
  leaseExpiration?: string; // ISO date
  spaceSizeSqft?: number;
  website?: string;
  isTenant: boolean;
  isProspect: boolean;
  source?: 'Dashboard' | string;
}

export interface Contact {
  id: string;
  companyId: string;
  firstName: string;
  lastName: string;
  title?: string;
  email?: string;
  workPhone?: string;
  isOccupier: boolean; // auto-derived from Company.isTenant
  isProspect: boolean; // auto-derived from Company.isProspect
  groupId: string;
  source?: 'Dashboard' | string;
}

export type EventType = 'Note' | 'Phone Call' | 'Cold Call' | 'Email' | 'Meeting' | 'Other';

export interface Activity {
  id: string;
  contactId: string;
  eventType: EventType;
  body: string;
  occurredAt: string; // ISO datetime
  source?: 'Dashboard' | string;
}

export interface Group {
  id: string;
  name: string;
}

export type NewCompany = Omit<Company, 'id' | 'source'>;
export type NewContact = Omit<Contact, 'id' | 'source' | 'isOccupier' | 'isProspect'>;
export type NewActivity = Omit<Activity, 'id' | 'source'>;

// ---------------------------------------------------------------------------
// RealNex SyncAPI raw shapes (Phase 3). The above are the dashboard/mirror
// domain model; these mirror what the API actually returns. Pragmatic typing:
// the SyncAPI schemas are large and some paginated wrappers aren't fully pinned
// until the P3.2 OData spike — each carries the fields we use + an index
// signature for the rest. Refine as phases land.
// ---------------------------------------------------------------------------

/** GET /api/Client — the authed user/account identity (smoke-test target). */
export interface RealNexClientInfo {
  id?: string;
  type?: string;
  clientName?: string;
  [k: string]: unknown;
}

/** A CRM Object Group (Workflow 2 "Group" dropdown source). */
export interface RealNexGroup {
  key?: string;
  name?: string;
  [k: string]: unknown;
}

/** GET /api/v1/Crm/group — ObjectGroupPageResponse (paginated). */
export interface RealNexGroupPage {
  items?: RealNexGroup[];
  pageNumber?: number;
  pageSize?: number;
  totalCount?: number;
  [k: string]: unknown;
}

/** A lookup-table row (eventtypes, historystatuses, users, …). */
export interface RealNexLookupItem {
  key?: string | number;
  name?: string;
  [k: string]: unknown;
}

/** GET /api/v1/Crm/contact/autocomplete item. */
export interface RealNexContactAutocompleteItem {
  key?: string;
  name?: string;
  companyName?: string;
  [k: string]: unknown;
}

/** GET /api/v1/Crm/company/{key}/full — rich read view. */
export interface RealNexCompany {
  key?: string;
  name?: string;
  [k: string]: unknown;
}

/** GET /api/v1/Crm/contact/{key}/full — rich read view. */
export interface RealNexContact {
  key?: string;
  firstName?: string;
  lastName?: string;
  [k: string]: unknown;
}

/** GET /api/v1/Crm/object/{key}/history — HistoryPageResponse (paginated). */
export interface RealNexHistoryPage {
  items?: Array<Record<string, unknown>>;
  pageNumber?: number;
  pageSize?: number;
  totalCount?: number;
  [k: string]: unknown;
}

/**
 * Event-type numeric ids from GET /api/v1/Crm/eventtypes (probed 2026-07-10; 29 total, this is
 * the note-logging subset). The write body (EditHistory) takes the NUMERIC `eventTypeKey`, NOT
 * the name and NOT the read-side nested `eventType:{key,name}`. RealNex system ids — stable.
 */
export const REALNEX_EVENT_TYPE = {
  Note: 18,
  'Phone Call': 1,
  'Cold Call': 101,
  Email: 15,
  Meeting: 2,
  Other: 11,
} as const;

export type RealNexEventTypeName = keyof typeof REALNEX_EVENT_TYPE;

/**
 * Input to `appendActivity` — the EditHistory fields set when CREATING a History CHILD on an
 * existing object. Nothing here touches the parent record; `objectKey` (passed separately) only
 * identifies the parent to attach to. Shape confirmed by reading the live EditHistory model.
 */
export interface AppendActivityInput {
  /** Required. Numeric event-type id (see REALNEX_EVENT_TYPE), e.g. 18 = Note. */
  eventTypeKey: number;
  /** Headline shown in the RealNex activity feed. */
  subject: string;
  /** The verbatim note body. */
  notes?: string;
  /** ISO local "YYYY-MM-DDTHH:mm:ss"; defaults to now. */
  startDate?: string;
  /** Defaults to startDate. */
  endDate?: string;
  /** Default false. */
  timeless?: boolean;
  /** Default false (matches existing entries). */
  published?: boolean;
}

// ==========================================================================================
// WRITE-INPUT shapes (P3.7 / P3.8 create).
//
// ⚠️⚠️  CASING INVERSION — READ THIS BEFORE CONSTRUCTING ANY CREATE BODY  ⚠️⚠️
//   • The RealNex READ side (OData list items, /full reads, and the jsonb we mirror) is PascalCase:
//       OrganizationId, Address1, Address2, City, State, ZipCode, WebSite …
//   • The WRITE side (the POST create bodies below) is camelCase — the EXACT INVERSE:
//       organization, address1, address2, city, state, zipCode, webSite …
//   A create body written with the read-side PascalCase keys will still serialize + POST "fine",
//   but RealNex IGNORES the unknown keys and creates a BLANK record — a silent-data-loss bug of
//   exactly the kind that has bitten this codebase (addresses, group filter). These interfaces match
//   the CreateCompany / CreateContact swagger schemas VERBATIM (camelCase). Do NOT reuse the
//   PascalCase read names here, and do NOT hand-write a create body off a read type.
// ==========================================================================================

/** camelCase address for CREATE bodies (RealNex `EditAddressPrincipal`). NOT the PascalCase read shape. */
export interface CreateAddressInput {
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
}

/** The 6 RealNex classification flags — identical keys on both company + contact create bodies. */
export interface RealNexCreateFlags {
  investor?: boolean;
  tenant?: boolean;
  agent?: boolean;
  vendor?: boolean;
  prospect?: boolean;
  personal?: boolean;
}

/**
 * POST /api/v1/Crm/company body — the `CreateCompany` schema (camelCase). The company NAME is
 * `organization` (the READ side calls it `OrganizationId` — do NOT use that spelling here).
 * `organization` is the one field our form REQUIRES; the swagger marks nothing required, so the
 * name-only minimum is OUR rule (enforced in the route/UI). RealNex responds 202 + the created
 * `Company` (incl. its new `key`) — see the optimistic mirror-upsert note in the route.
 * (`userKey`/`teamKey` deliberately omitted — records attribute to the JWT's identity = Mike.)
 */
export interface CreateCompanyInput extends RealNexCreateFlags {
  /** REQUIRED (our rule): the company name → serialized as `organization`. */
  organization: string;
  subsidiary?: string;
  phone?: string;
  fax?: string;
  email?: string;
  webSite?: string; // capital S — camelCase per the schema (read side mirrors it as `website`)
  address?: CreateAddressInput;
  objectGroups?: string[];
}

/**
 * POST /api/v1/Crm/contact body — the `CreateContact` schema (camelCase). Name is `fullName` OR
 * `firstName`+`lastName`; VALIDATION requires at least one (kept optional at the type level since
 * it's an either/or). `companyKey` links the new contact to its parent company (the parent's RealNex
 * key). RealNex responds 202 + the created `Contact` (incl. `key`); that returned object carries NO
 * native company link, so the route sets `company_key`/`company_name` on the mirror-upsert from the
 * `companyKey` we sent here.
 */
export interface CreateContactInput extends RealNexCreateFlags {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  salutation?: string;
  greeting?: string;
  companyKey?: string; // parent company's RealNex key (the link)
  useCompanyAddress?: boolean;
  work?: string;
  mobile?: string;
  home?: string;
  fax?: string;
  email?: string;
  webSite?: string;
  address?: CreateAddressInput;
  objectGroups?: string[];
}

// ---- API WIRE BODIES — mirror the swagger CreateCompany / CreateContact / EditAddressPrincipal
// VERBATIM (camelCase). The Create*Input types above are OUR form shapes; the wrappers map them into
// THESE, and the primitives are typed to these so the camelCase-only guardrail checks the real
// contract. Everything is INLINE (address nested, flags booleans, companyKey inline, objectGroups
// string[]) — there is NO addressKey, NO `phone` on a contact, NO create-then-attach. ----

/** RealNex `EditAddressPrincipal` — the INLINE address object on both create bodies (verbatim). */
export interface EditAddressPrincipal {
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  timeZoneKey?: number;
  company?: string;
}

/** POST /api/v1/Crm/company body — the `CreateCompany` schema verbatim (20 props, camelCase). */
export interface CreateCompany {
  userKey?: string;
  teamKey?: string;
  organization?: string; // the company NAME (camelCase; the READ side calls it OrganizationId)
  subsidiary?: string;
  address?: EditAddressPrincipal;
  investor?: boolean;
  tenant?: boolean;
  agent?: boolean;
  vendor?: boolean;
  prospect?: boolean;
  personal?: boolean;
  phone?: string; // company HAS phone; a contact does NOT (contact uses work/mobile/home)
  fax?: string;
  email?: string;
  webSite?: string;
  doNotCall?: boolean;
  doNotEmail?: boolean;
  doNotFax?: boolean;
  doNotMail?: boolean;
  objectGroups?: string[];
}

/** POST /api/v1/Crm/contact body — the `CreateContact` schema verbatim (28 props, camelCase). */
export interface CreateContact {
  userKey?: string;
  teamKey?: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  salutation?: string;
  greeting?: string;
  title?: string;
  companyKey?: string; // the parent-company link — set INLINE on create (no separate call)
  useCompanyAddress?: boolean;
  address?: EditAddressPrincipal;
  investor?: boolean;
  tenant?: boolean;
  agent?: boolean;
  vendor?: boolean;
  prospect?: boolean;
  personal?: boolean;
  work?: string; // a contact's phones are work/mobile/home/fax — there is NO `phone` field
  fax?: string;
  mobile?: string;
  home?: string;
  email?: string;
  webSite?: string;
  doNotCall?: boolean;
  doNotEmail?: boolean;
  doNotFax?: boolean;
  doNotMail?: boolean;
  objectGroups?: string[];
}

/** RFC-7807 ProblemDetails — RealNex returns this on 4xx/5xx; surfaced via RealNexApiError.problem. */
export interface RealNexProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  [k: string]: unknown;
}

/**
 * Result of a create: the new record `key` + best-effort follow-up `warnings`. In v1 the create is a
 * SINGLE inline POST, so warnings is normally empty — it's reserved for a future groups-attach
 * fallback (POST /group/{key}/members) if the live-write step shows inline `objectGroups` don't attach.
 */
export interface CreateResult {
  key: string;
  warnings: string[];
}

/** Standard paging args for list endpoints (RealNex declares no defaults — always pass them). */
export interface RealNexPaging {
  pageNumber?: number;
  pageSize?: number;
  order?: string;
}

// ---------------------------------------------------------------------------
// OData list-item shapes (P3.4 mirror sync). The feeds GET /api/v1/CrmOData/
// Companies and /Contacts are ASP.NET Core OData endpoints: the response is the
// envelope { "@odata.context": ..., "value": [...] } (NOT a raw array). safe.ts
// odataArray() pulls `value`. Page with $skip/$top, stop under a full page ($top max 100).
//
// !!! GOTCHA: CompanyListItem has NO `name` field. The company name lives in
// `organizationId` (typed String, despite the Id suffix). See realnex-companies.ts.
// ---------------------------------------------------------------------------

/** A nested address object; shape is loose, we store it verbatim as jsonb. */
export type RealNexAddress = Record<string, unknown>;

/** GET /api/v1/CrmOData/Companies item. Company NAME is in `organizationId`. */
export interface RealNexCompanyListItem {
  key?: string;
  userKey?: string;
  teamKey?: string;
  organizationId?: string; // <- THE COMPANY NAME (not an id). See gotcha above.
  subsidiaryId?: string;
  investor?: boolean;
  tenant?: boolean;
  agent?: boolean;
  vendor?: boolean;
  personal?: boolean;
  prospect?: boolean;
  phone?: string;
  fax?: string;
  email?: string;
  webSite?: string;
  doNotCall?: boolean;
  doNotEmail?: boolean;
  doNotFax?: boolean;
  doNotMail?: boolean;
  address?: RealNexAddress;
  lastActivity?: Record<string, unknown>;
  objectGroups?: Array<Record<string, unknown>>;
  [k: string]: unknown;
}

/** GET /api/v1/CrmOData/Contacts item. */
export interface RealNexContactListItem {
  key?: string;
  userKey?: string;
  teamKey?: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  salutation?: string;
  greeting?: string;
  title?: string;
  investor?: boolean;
  tenant?: boolean;
  agent?: boolean;
  vendor?: boolean;
  personal?: boolean;
  prospect?: boolean;
  work?: string;
  fax?: string;
  mobile?: string;
  home?: string;
  email?: string;
  webSite?: string;
  doNotCall?: boolean;
  doNotEmail?: boolean;
  doNotFax?: boolean;
  doNotMail?: boolean;
  address?: RealNexAddress;
  mailingAddress?: RealNexAddress;
  lastActivity?: Record<string, unknown>;
  objectGroups?: Array<Record<string, unknown>>;
  [k: string]: unknown;
}

/**
 * GET /api/v1/Crm/company/{key}/contacts — ContactListItemPageResponse.
 * The inversion-walk envelope: RealNex's own PageNumber/PageSize paging.
 */
export interface RealNexContactListItemPage {
  items?: RealNexContactListItem[];
  pageNumber?: number;
  pageSize?: number;
  totalCount?: number;
  [k: string]: unknown;
}
