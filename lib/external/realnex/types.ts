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
