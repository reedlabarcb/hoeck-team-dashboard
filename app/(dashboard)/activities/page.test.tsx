// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LogNotePage from './page';
import type { EntityResult } from '@/lib/realnex/format';

const CONTACT: EntityResult = {
  type: 'contact',
  key: 'CONTACT-KEY-0001',
  displayName: 'Maria Alvarez',
  companyName: 'Acme Corp',
  email: 'maria@acme.com',
};

let fetchMock: ReturnType<typeof vi.fn>;
let activityCalls: Array<{ url: string; body: any }>;

// The search input and the event-type <select> BOTH expose role "combobox", and the dropdown
// results share role "option" with the <select> options — so target the search by placeholder and
// pick the result by its text.
const SEARCH = /search a contact or company/i;
const searchInput = () => screen.getByPlaceholderText(SEARCH);
const review = () => screen.getByRole('button', { name: /review/i }) as HTMLButtonElement;

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <LogNotePage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  activityCalls = [];
  fetchMock = vi.fn(async (url: string, opts?: any) => {
    const u = String(url);
    if (u.includes('/api/realnex/resolve')) return { ok: true, json: async () => ({ results: [CONTACT] }) };
    if (u.includes('/api/realnex/activity')) {
      activityCalls.push({ url: u, body: JSON.parse(opts?.body ?? '{}') });
      return { ok: true, json: async () => ({ ok: true }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function pickContact(user: ReturnType<typeof userEvent.setup>) {
  await user.type(searchInput(), 'mar');
  await user.click(await screen.findByText('Maria Alvarez', {}, { timeout: 2000 }));
}
async function fillForm(user: ReturnType<typeof userEvent.setup>) {
  await pickContact(user);
  await user.selectOptions(screen.getByLabelText('Event type'), '2'); // Meeting = 2
  await user.type(screen.getByLabelText('Note'), 'had lunch with Maria');
}

describe('Log Note page', () => {
  it('entity select populates the selected target and replaces the search box', async () => {
    const user = userEvent.setup();
    renderPage();
    await pickContact(user);
    expect(screen.getByText('Maria Alvarez')).toBeTruthy(); // the selected card
    expect(screen.queryByPlaceholderText(SEARCH)).toBeNull(); // search replaced by the card
  });

  it('the confirm step shows the right name, key, and note text — before any write', async () => {
    const user = userEvent.setup();
    renderPage();
    await fillForm(user);
    await user.click(review());

    expect(screen.getByText(/Confirm — this writes to RealNex/i)).toBeTruthy();
    expect(screen.getByText('had lunch with Maria')).toBeTruthy(); // exact note text (blockquote)
    expect(screen.getByText('CONTACT-KEY-0001')).toBeTruthy(); // exact target key
    expect(screen.getAllByText(/Maria Alvarez/).length).toBeGreaterThan(0);
    expect(activityCalls).toHaveLength(0); // nothing written yet
  });

  it('submit posts the right payload (eventTypeKey mapped from the dropdown) and shows success', async () => {
    const user = userEvent.setup();
    renderPage();
    await fillForm(user);
    await user.click(review());
    await user.click(screen.getByRole('button', { name: /confirm & log/i }));

    await screen.findByRole('button', { name: /log another/i }, { timeout: 2000 });
    expect(screen.getByText(/now in RealNex/i)).toBeTruthy();
    expect(activityCalls).toHaveLength(1);
    expect(activityCalls[0].body).toEqual({
      objectKey: 'CONTACT-KEY-0001',
      objectType: 'contact',
      eventTypeKey: 2, // Meeting — mapped from the dropdown selection
      notes: 'had lunch with Maria',
    });
  });

  it('Cancel from confirm returns to compose without writing', async () => {
    const user = userEvent.setup();
    renderPage();
    await fillForm(user);
    await user.click(review());
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(review()).toBeTruthy();
    expect(activityCalls).toHaveLength(0);
  });

  it('Review is disabled until an entity AND a note are present', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(review().disabled).toBe(true); // nothing yet
    await pickContact(user);
    expect(review().disabled).toBe(true); // entity but no note
    await user.type(screen.getByLabelText('Note'), 'x');
    expect(review().disabled).toBe(false);
  });
});
