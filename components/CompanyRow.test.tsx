// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { CompanyRow, type CompanyRowData } from './CompanyRow';

const c: CompanyRowData = {
  key: 'CO1',
  name: 'Gensler',
  city: 'San Diego',
  state: 'CA',
  address: { address1: '525 B Street', address2: 'Ste 2200', city: 'San Diego', state: 'CA', zipCode: '92101' },
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
    // Regression (P3.13 nav bug): the name links to the detail page by key, NOT /companies?q=.
    expect(name.getAttribute('href')).toBe('/companies/CO1');
    expect(name.getAttribute('href')).not.toContain('?q=');
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

  it('shows the full street address (same formatting as the detail page)', () => {
    render(
      <table>
        <tbody>
          <CompanyRow company={c} />
        </tbody>
      </table>,
    );
    expect(screen.getByText('525 B Street, Ste 2200, San Diego, CA 92101')).toBeTruthy();
  });

  it('degrades gracefully for a partial address — shows what it has, no stray comma', () => {
    render(
      <table>
        <tbody>
          <CompanyRow company={{ ...c, address: { city: 'San Diego' } }} />
        </tbody>
      </table>,
    );
    // getByText does an exact (normalized) match, so this passing proves the cell is exactly
    // "San Diego" — no leading/trailing comma from the empty street/state/zip fields.
    expect(screen.getByText('San Diego')).toBeTruthy();
  });

  it('shows an em-dash when the company has no address', () => {
    render(
      <table>
        <tbody>
          <CompanyRow company={{ ...c, address: null }} />
        </tbody>
      </table>,
    );
    expect(screen.getByText('—')).toBeTruthy();
  });
});
