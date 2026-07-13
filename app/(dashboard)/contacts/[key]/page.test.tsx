// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('@/lib/realnex/queries', () => ({ getContactByKey: vi.fn() }));
// The not-found branch doesn't render <RecordHistory>; stub it so this test never pulls in React
// Query / a live fetch.
vi.mock('@/components/RecordHistory', () => ({ RecordHistory: () => null }));

import ContactDetailPage from './page';
import { getContactByKey } from '@/lib/realnex/queries';

/* eslint-disable @typescript-eslint/no-explicit-any */
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ContactDetailPage', () => {
  it('renders a clean "Contact not found" when the key resolves to nothing', async () => {
    (getContactByKey as any).mockResolvedValue(null);
    const el = await ContactDetailPage({ params: Promise.resolve({ key: 'BADKEY' }) });
    render(el);
    expect(screen.getByText(/Contact not found/i)).toBeTruthy();
    expect(getContactByKey).toHaveBeenCalledWith('BADKEY');
  });

  it('renders the profile + a Log Note link prefilled to this contact', async () => {
    (getContactByKey as any).mockResolvedValue({
      key: 'CK1',
      fullName: 'Britni Stone',
      firstName: 'Britni',
      lastName: 'Stone',
      title: 'VP',
      email: null,
      work: null,
      mobile: null,
      home: null,
      fax: null,
      website: null,
      companyKey: 'CO1',
      companyName: 'Gensler',
      address: null,
      leaseExpiry: '2027-04-30',
      sqFt: 21347,
      tenant: true,
      prospect: false,
      investor: false,
      agent: false,
      vendor: false,
      personal: false,
      objectGroups: [],
      lastActivityAt: null,
    });
    const el = await ContactDetailPage({ params: Promise.resolve({ key: 'CK1' }) });
    render(el);
    expect(screen.getByText('Britni Stone')).toBeTruthy();
    const logNote = screen.getByRole('link', { name: /log note/i }) as HTMLAnchorElement;
    const href = logNote.getAttribute('href') ?? '';
    expect(href).toContain('/activities?');
    expect(href).toContain('type=contact');
    expect(href).toContain('key=CK1');
    expect(href).toContain('company=Gensler');
  });
});
