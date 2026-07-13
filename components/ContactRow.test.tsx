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
    expect(company.getAttribute('href')).toContain('/companies?q=Gensler');
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
