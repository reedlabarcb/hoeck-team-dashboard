// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ContactRow, type ContactRowData } from './ContactRow';

const c: ContactRowData = {
  key: 'CK1',
  fullName: 'Britni Stone',
  firstName: 'Britni',
  lastName: 'Stone',
  title: 'VP',
  email: 'b@x.com',
  work: '619-555-0100',
  mobile: null,
  companyKey: 'CO1',
  companyName: 'Gensler',
  leaseExpiry: '2027-04-30',
  sqFt: 21347,
  tenant: true,
  prospect: false,
};

afterEach(cleanup);

describe('ContactRow', () => {
  it('name links to the contact detail page; shows SF/LXD/company', () => {
    render(
      <table>
        <tbody>
          <ContactRow contact={c} />
        </tbody>
      </table>,
    );
    const nameLink = screen.getByRole('link', { name: 'Britni Stone' }) as HTMLAnchorElement;
    expect(nameLink.getAttribute('href')).toBe('/contacts/CK1');
    expect(screen.getByText('21,347')).toBeTruthy();
    expect(screen.getByText('04/30/2027')).toBeTruthy();
    const company = screen.getByRole('link', { name: 'Gensler' }) as HTMLAnchorElement;
    // Regression (P3.13 nav bug): the company cell links to the company DETAIL page by key,
    // NOT the /companies list via ?q= (which is what made clicking a company land on the list).
    expect(company.getAttribute('href')).toBe('/companies/CO1');
    expect(company.getAttribute('href')).not.toContain('?q=');
  });

  it('renders a denormalized company name with no key as plain text (no broken link)', () => {
    render(
      <table>
        <tbody>
          <ContactRow contact={{ ...c, companyKey: null, companyName: 'Ghost Co' }} />
        </tbody>
      </table>,
    );
    // Unlinked company (name present, no mirrored key) — show the name, but not as a link.
    expect(screen.queryByRole('link', { name: 'Ghost Co' })).toBeNull();
    expect(screen.getByText('Ghost Co')).toBeTruthy();
  });

  it('shows (no company) when unlinked', () => {
    render(
      <table>
        <tbody>
          <ContactRow contact={{ ...c, companyKey: null, companyName: null }} />
        </tbody>
      </table>,
    );
    expect(screen.getByText('(no company)')).toBeTruthy();
  });
});
