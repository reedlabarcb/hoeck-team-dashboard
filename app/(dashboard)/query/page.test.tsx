// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MasterQueryPage from './page';

/* eslint-disable @typescript-eslint/no-explicit-any */
let fetchMock: ReturnType<typeof vi.fn>;
let queryUrls: string[];

const COMPANY = {
  key: 'CO1', name: 'Gensler', city: 'San Diego', state: 'CA',
  address: { City: 'San Diego', State: 'CA' }, leaseExpiry: '2027-04-30', sqFt: 21347,
  tenant: true, prospect: false, investor: false, agent: false, vendor: false, personal: false,
  objectGroups: [{ Key: 'g', Name: 'Architects' }],
};
const CONTACT = {
  key: 'CT1', fullName: 'Britni Stone', firstName: 'Britni', lastName: 'Stone', title: 'VP', companyName: 'Gensler', companyKey: 'CO1',
  address: { City: 'San Diego', State: 'CA' }, leaseExpiry: '2027-04-30', sqFt: 21347,
  tenant: true, prospect: false, investor: false, agent: false, vendor: false, personal: false, objectGroups: [],
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MasterQueryPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  queryUrls = [];
  fetchMock = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes('/api/realnex/query')) {
      queryUrls.push(u);
      const sp = new URL(u, 'http://test').searchParams;
      const entity = sp.get('entity') === 'contacts' ? 'contacts' : 'companies';
      const rows = entity === 'companies' ? [COMPANY] : [CONTACT];
      return { ok: true, json: async () => ({ rows, total: rows.length, entity }) };
    }
    if (u.includes('/api/realnex/groups')) return { ok: true, json: async () => ({ groups: [{ key: 'g', name: 'Architects' }] }) };
    return { ok: false, status: 404, json: async () => ({}) };
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const lastQueryUrl = () => queryUrls[queryUrls.length - 1] ?? '';

describe('Master Query page', () => {
  it('loads companies by default and renders a row', async () => {
    renderPage();
    expect(await screen.findByText('Gensler')).toBeTruthy();
    expect(lastQueryUrl()).toContain('entity=companies');
  });

  it('entity toggle re-runs the query as contacts and swaps columns', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Gensler');
    await user.click(screen.getByRole('button', { name: 'Contacts' }));
    expect(await screen.findByText('Britni Stone')).toBeTruthy();
    await waitFor(() => expect(lastQueryUrl()).toContain('entity=contacts'));
    expect(screen.getByText('Title')).toBeTruthy(); // contact-only column header appears
  });

  it('applying a city filter shows a chip and forwards it; clearing the chip removes it', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Gensler');

    await user.type(screen.getByPlaceholderText('City'), 'San Diego');
    // the applied filter appears as a removable chip (a button; the × is aria-hidden so the
    // accessible name is just the label), and reaches the fetch URL
    const chip = await screen.findByRole('button', { name: 'San Diego' });
    expect(chip).toBeTruthy();
    await waitFor(() => expect(lastQueryUrl()).toContain('city=San+Diego'));

    await user.click(chip);
    // chip gone, and the next fetch drops the city param
    await waitFor(() => expect(screen.queryByRole('button', { name: 'San Diego' })).toBeNull());
    await waitFor(() => expect(lastQueryUrl()).not.toContain('city='));
    expect((screen.getByPlaceholderText('City') as HTMLInputElement).value).toBe('');
  });
});
