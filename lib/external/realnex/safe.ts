/**
 * RealNex Safe Wrapper
 *
 * Allow-list — these are the ONLY methods that may exist in this file:
 *
 *   Reads:
 *     - listCompanies
 *     - getCompany
 *     - listContacts
 *     - getContact
 *     - listActivities
 *     - getActivity
 *     - listGroups
 *
 *   Creates:
 *     - createCompany
 *     - createContact
 *     - createActivity
 *
 * Forbid-list — these methods MUST NEVER exist in this file:
 *
 *   - updateCompany, updateContact, updateActivity, updateGroup
 *   - deleteCompany, deleteContact, deleteActivity, deleteGroup
 *   - patchCompany, patchContact, patchActivity, patchGroup
 *   - putCompany, putContact, putActivity, putGroup
 *   - Any HTTP PATCH, PUT, or DELETE call against any RealNex entity
 *
 * Every dashboard-created RealNex record MUST be tagged `Source: Dashboard`.
 *
 * Lineage:
 *   - BUILD_SPEC.md § "Safety Rules → RealNex"
 *   - docs/LESSONS_LEARNED.md
 *
 * Phase 1: stubs only. Real implementation lands in Phase 3.
 */

// TODO(phase-3): listCompanies(): Promise<Company[]>
// TODO(phase-3): getCompany(id: string): Promise<Company | null>
// TODO(phase-3): listContacts(opts?: { companyId?: string }): Promise<Contact[]>
// TODO(phase-3): getContact(id: string): Promise<Contact | null>
// TODO(phase-3): listActivities(opts?: { contactId?: string }): Promise<Activity[]>
// TODO(phase-3): getActivity(id: string): Promise<Activity | null>
// TODO(phase-3): listGroups(): Promise<Group[]>
// TODO(phase-3): createCompany(input: NewCompany): Promise<Company>  // tags Source: Dashboard
// TODO(phase-3): createContact(input: NewContact): Promise<Contact>  // tags Source: Dashboard
// TODO(phase-3): createActivity(input: NewActivity): Promise<Activity>  // tags Source: Dashboard

export const __SAFE_WRAPPER_VERSION = 'phase-1-stub';
