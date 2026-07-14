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
  window.history.replaceState({}, '', '/'); // clean URL; pre-fill tests set their own params
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

describe('Log Note pre-fill from URL params (P3.13 Step 5)', () => {
  function setPrefillUrl(params: Record<string, string>) {
    window.history.replaceState({}, '', `/activities?${new URLSearchParams(params).toString()}`);
  }

  it('pre-selects the entity from URL params — the search step is skipped', async () => {
    setPrefillUrl({ type: 'company', key: 'CO-KEY-9', name: 'Gensler' });
    renderPage();
    // Entity already selected: the target card shows the name + a "change" affordance, and the
    // search box is NOT rendered — you land straight on the compose form for this record.
    expect(await screen.findByText('Gensler')).toBeTruthy();
    expect(screen.getByRole('button', { name: /change/i })).toBeTruthy();
    expect(screen.queryByPlaceholderText(SEARCH)).toBeNull();
  });

  it('a contact pre-fill carries the company label through', async () => {
    setPrefillUrl({ type: 'contact', key: 'CT-9', name: 'Britni Stone', company: 'Gensler' });
    renderPage();
    expect(await screen.findByText('Britni Stone')).toBeTruthy();
    expect(screen.getByText('Gensler')).toBeTruthy(); // company shown on the selected card
  });

  it('pre-fill does NOT skip the confirm gate — a pre-filled entity is confirmed like a searched one', async () => {
    const user = userEvent.setup();
    setPrefillUrl({ type: 'company', key: 'CO-KEY-9', name: 'Gensler' });
    renderPage();
    await screen.findByText('Gensler'); // pre-filled

    // Landing pre-filled does NOT auto-advance: still on compose, confirm panel absent, no write.
    expect(review()).toBeTruthy();
    expect(screen.queryByText(/Confirm — this writes to RealNex/i)).toBeNull();
    expect(activityCalls).toHaveLength(0);

    // The SAME gate as a searched entity: Review → the confirm panel restates the record + note,
    // and STILL nothing is written until "Confirm & Log".
    await user.type(screen.getByLabelText('Note'), 'intro call scheduled');
    await user.click(review());
    expect(screen.getByText(/Confirm — this writes to RealNex/i)).toBeTruthy();
    expect(screen.getByText('intro call scheduled')).toBeTruthy();
    expect(screen.getByText('CO-KEY-9')).toBeTruthy(); // the pre-filled target key, shown to confirm
    expect(activityCalls).toHaveLength(0); // confirm gate intact — nothing written yet
  });

  it('ignores malformed params (bad type) — falls back to the search box', async () => {
    setPrefillUrl({ type: 'bogus', key: 'X', name: 'Y' });
    renderPage();
    expect(await screen.findByPlaceholderText(SEARCH)).toBeTruthy();
  });
});
