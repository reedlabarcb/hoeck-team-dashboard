// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('@/lib/realnex/queries', () => ({ getCompanyByKey: vi.fn(), searchContacts: vi.fn() }));
vi.mock('@/components/RecordHistory', () => ({ RecordHistory: () => null }));

import CompanyDetailPage from './page';
import { getCompanyByKey, searchContacts } from '@/lib/realnex/queries';

/* eslint-disable @typescript-eslint/no-explicit-any */
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const company = {
  key: 'CO1',
  name: 'Gensler',
  phone: null,
  fax: null,
  email: null,
  website: null,
  address: null,
  city: null,
  state: null,
  leaseExpiry: null,
  sqFt: null,
  tenant: false,
  prospect: false,
  investor: false,
  agent: false,
  vendor: false,
  personal: false,
  objectGroups: [],
  lastActivityAt: null,
};

describe('CompanyDetailPage', () => {
  it('renders "Company not found" and does not fetch contacts when the key is unknown', async () => {
    (getCompanyByKey as any).mockResolvedValue(null);
    const el = await CompanyDetailPage({ params: Promise.resolve({ key: 'BAD' }) });
    render(el);
    expect(screen.getByText(/Company not found/i)).toBeTruthy();
    expect(searchContacts).not.toHaveBeenCalled();
  });

  it('renders profile + linked contacts (→ contact detail) + a prefilled Log Note link', async () => {
    (getCompanyByKey as any).mockResolvedValue(company);
    (searchContacts as any).mockResolvedValue({
      contacts: [{ key: 'CK1', fullName: 'Britni Stone', firstName: 'Britni', lastName: 'Stone', title: 'VP', email: null }],
      total: 1,
    });
    const el = await CompanyDetailPage({ params: Promise.resolve({ key: 'CO1' }) });
    render(el);
    expect(screen.getByText('Gensler')).toBeTruthy();
    const linked = screen.getByRole('link', { name: 'Britni Stone' }) as HTMLAnchorElement;
    expect(linked.getAttribute('href')).toBe('/contacts/CK1');
    const logNote = screen.getByRole('link', { name: /log note/i }) as HTMLAnchorElement;
    const href = logNote.getAttribute('href') ?? '';
    expect(href).toContain('type=company');
    expect(href).toContain('key=CO1');
    expect(searchContacts).toHaveBeenCalledWith({ companyKey: 'CO1', limit: 100 });
  });
});
