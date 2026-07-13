// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { CompanyProfile } from './CompanyProfile';

/* eslint-disable @typescript-eslint/no-explicit-any */
const company = {
  key: 'CO1',
  name: 'Gensler',
  phone: '619-555-0000',
  fax: null,
  email: 'info@gensler.com',
  website: 'gensler.com',
  address: { address1: '500 S Figueroa', city: 'Los Angeles', state: 'CA', zipCode: '90071' },
  city: 'Los Angeles',
  state: 'CA',
  leaseExpiry: '2027-04-30',
  sqFt: 21347,
  tenant: true,
  prospect: false,
  investor: false,
  agent: false,
  vendor: false,
  personal: false,
  objectGroups: [{ Key: 'g', Name: 'Architects' }],
  lastActivityAt: null,
} as any;

afterEach(cleanup);

describe('CompanyProfile', () => {
  it('renders fields + normalized website + email links', () => {
    render(<CompanyProfile company={company} />);
    expect(screen.getByText('Gensler')).toBeTruthy();
    expect(screen.getByText('21,347')).toBeTruthy();
    expect(screen.getByText('04/30/2027')).toBeTruthy();
    expect(screen.getByText('500 S Figueroa, Los Angeles, CA 90071')).toBeTruthy();
    expect(screen.getByText('Architects')).toBeTruthy();
    const email = screen.getByRole('link', { name: 'info@gensler.com' }) as HTMLAnchorElement;
    expect(email.getAttribute('href')).toBe('mailto:info@gensler.com');
    const site = screen.getByRole('link', { name: 'gensler.com' }) as HTMLAnchorElement;
    expect(site.getAttribute('href')).toBe('https://gensler.com'); // normalized
  });

  it('unnamed + blanks degrade to (unnamed) / —', () => {
    render(
      <CompanyProfile
        company={{ ...company, name: null, email: null, website: null, address: null, objectGroups: [], phone: null, leaseExpiry: null, sqFt: null, tenant: false }}
      />,
    );
    expect(screen.getByText('(unnamed)')).toBeTruthy();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
