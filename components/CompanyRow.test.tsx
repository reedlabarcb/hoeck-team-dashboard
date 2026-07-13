// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { CompanyRow, type CompanyRowData } from './CompanyRow';

const c: CompanyRowData = {
  key: 'CO1',
  name: 'Gensler',
  city: 'Los Angeles',
  state: 'CA',
  phone: '619-555-0000',
  email: 'i@x.com',
  website: 'gensler.com',
  leaseExpiry: '2027-04-30',
  sqFt: 21347,
  tenant: true,
  prospect: false,
};

afterEach(cleanup);

describe('CompanyRow', () => {
  it('name links to the company detail page; SF/LXD/website render', () => {
    render(
      <table>
        <tbody>
          <CompanyRow company={c} />
        </tbody>
      </table>,
    );
    const name = screen.getByRole('link', { name: 'Gensler' }) as HTMLAnchorElement;
    expect(name.getAttribute('href')).toBe('/companies/CO1');
    expect(screen.getByText('21,347')).toBeTruthy();
    expect(screen.getByText('04/30/2027')).toBeTruthy();
    const site = screen.getByRole('link', { name: /site/i }) as HTMLAnchorElement;
    expect(site.getAttribute('href')).toBe('https://gensler.com');
  });

  it('unnamed company still links to its detail page', () => {
    render(
      <table>
        <tbody>
          <CompanyRow company={{ ...c, name: null }} />
        </tbody>
      </table>,
    );
    const name = screen.getByRole('link', { name: '(unnamed)' }) as HTMLAnchorElement;
    expect(name.getAttribute('href')).toBe('/companies/CO1');
  });
});
