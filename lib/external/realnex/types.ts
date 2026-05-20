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
