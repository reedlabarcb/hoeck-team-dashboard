// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ContactProfile } from './ContactProfile';

/* eslint-disable @typescript-eslint/no-explicit-any */
const contact = {
  key: 'CK1',
  fullName: 'Britni Stone',
  firstName: 'Britni',
  lastName: 'Stone',
  title: 'VP Real Estate',
  email: 'britni@gensler.com',
  work: '619-555-0100',
  mobile: '619-555-0199',
  home: null,
  fax: null,
  website: null,
  companyKey: 'CO1',
  companyName: 'Gensler',
  // REAL mirror shape: RealNex/OData PascalCase sub-fields, stored verbatim by the sync (contacts too).
  address: { Address1: '525 B Street', Address2: 'Ste 2200', City: 'San Diego', State: 'CA', Country: 'US', ZipCode: '92101' },
  leaseExpiry: '2027-04-30',
  sqFt: 21347,
  tenant: true,
  prospect: false,
  investor: false,
  agent: false,
  vendor: false,
  personal: false,
  objectGroups: [{ Key: 'g1', Name: 'Tenant Rep' }],
  lastActivityAt: null,
} as any;

afterEach(cleanup);

describe('ContactProfile', () => {
  it('renders mirror profile fields (name/title/LXD/SF/address/groups/flag) + links', () => {
    render(<ContactProfile contact={contact} />);
    expect(screen.getByText('Britni Stone')).toBeTruthy();
    expect(screen.getByText('VP Real Estate')).toBeTruthy();
    expect(screen.getByText('21,347')).toBeTruthy(); // SF
    expect(screen.getByText('04/30/2027')).toBeTruthy(); // LXD
    expect(screen.getByText('525 B Street, Ste 2200, San Diego, CA 92101')).toBeTruthy();
    expect(screen.getByText('Tenant Rep')).toBeTruthy(); // group
    expect(screen.getByText('Tenant')).toBeTruthy(); // flag badge (exact, not "Tenant Rep")

    const company = screen.getByRole('link', { name: 'Gensler' }) as HTMLAnchorElement;
    expect(company.getAttribute('href')).toBe('/companies/CO1');
    const email = screen.getByRole('link', { name: 'britni@gensler.com' }) as HTMLAnchorElement;
    expect(email.getAttribute('href')).toBe('mailto:britni@gensler.com');
  });

  it('degrades gracefully: no company link when unlinked; — for blanks', () => {
    const bare = {
      ...contact,
      title: null,
      companyKey: null,
      companyName: null,
      email: null,
      work: null,
      mobile: null,
      leaseExpiry: null,
      sqFt: null,
      address: null,
      objectGroups: [],
      tenant: false,
    } as any;
    render(<ContactProfile contact={bare} />);
    expect(screen.queryByRole('link', { name: 'Gensler' })).toBeNull();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
