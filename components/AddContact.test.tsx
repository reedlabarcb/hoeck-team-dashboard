// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FeatureFlagsProvider } from '@/components/FeatureFlags';

// The company picker is the existing read-side typeahead. Stub it to a single button that
// selects a fixed company, so these tests exercise AddContact's own logic (the companyKey link
// and the useCompanyAddress rule), not the search widget.
vi.mock('@/components/RealNexEntitySearch', () => ({
  RealNexEntitySearch: ({
    onSelect,
    onCreateNew,
  }: {
    onSelect: (e: { key: string; displayName: string }) => void;
    onCreateNew?: (typed: string) => void;
  }) => (
    <>
      <button type="button" onClick={() => onSelect({ key: 'CO-123', displayName: 'Acme Corp' })}>
        pick-company
      </button>
      {/* Stands in for the real dropdown's "+ Create new company" row (its own rendering — on zero
          matches and below results — is covered in RealNexEntitySearch.test.tsx). */}
      <button type="button" onClick={() => onCreateNew?.('Typed New Co')}>
        create-new-company
      </button>
    </>
  ),
}));

// eslint-disable-next-line import/first
import { AddContact } from './AddContact';

/* eslint-disable @typescript-eslint/no-explicit-any */
let posts: Array<{ url: string; body: any }>;

function mkFetch(status = 200, body: unknown = { key: 'CT-1', warnings: [] }) {
  return vi.fn(async (url: string, init: any) => {
    posts.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : undefined });
    return { ok: status < 400, status, json: async () => body };
  });
}
/**
 * Endpoint-routing fetch for the chaining tests: the company create and the contact create are two
 * separate writes, so each needs its own status/body (that's how the orphan case is reproduced).
 */
function mkRouter(o: { companyStatus?: number; companyBody?: unknown; contactStatus?: number; contactBody?: unknown } = {}) {
  return vi.fn(async (url: string, init: any) => {
    const u = String(url);
    posts.push({ url: u, body: init?.body ? JSON.parse(init.body) : undefined });
    if (u.includes('/api/realnex/company')) {
      const s = o.companyStatus ?? 200;
      return { ok: s < 400, status: s, json: async () => o.companyBody ?? { key: 'CO-NEW-9', warnings: [] } };
    }
    const s = o.contactStatus ?? 200;
    return { ok: s < 400, status: s, json: async () => o.contactBody ?? { key: 'CT-1', warnings: [] } };
  });
}
const companyDialog = () => screen.getByRole('dialog', { name: 'Add Company' });
const orgInput = () => screen.getByPlaceholderText('e.g. Full Swing Golf') as HTMLInputElement;

function renderIt(flag = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FeatureFlagsProvider value={{ realnexCreateEnabled: flag }}>
        <AddContact />
      </FeatureFlagsProvider>
    </QueryClientProvider>,
  );
}
const firstNameInput = () => screen.getAllByRole('textbox')[0];

beforeEach(() => {
  posts = [];
  vi.stubGlobal('fetch', mkFetch());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AddContact — feature flag', () => {
  it('renders NOTHING when the flag is off', () => {
    renderIt(false);
    expect(screen.queryByRole('button', { name: /Add Contact/ })).toBeNull();
  });
  it('renders the button when the flag is on', () => {
    renderIt(true);
    expect(screen.getByRole('button', { name: /Add Contact/ })).toBeTruthy();
  });
});

describe('AddContact — confirm gate + validation', () => {
  it('Continue blocked until a name is entered; no POST until Confirm', async () => {
    const user = userEvent.setup();
    renderIt();
    await user.click(screen.getByRole('button', { name: /Add Contact/ }));
    const cont = screen.getByRole('button', { name: /Continue/ }) as HTMLButtonElement;
    expect(cont.disabled).toBe(true); // no name yet
    await user.type(firstNameInput(), 'Jane');
    expect(cont.disabled).toBe(false);
    expect(posts).toHaveLength(0);

    await user.click(cont);
    expect(posts).toHaveLength(0); // still nothing until Confirm
    expect(screen.getByText(/creates a NEW contact/i)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Create contact/ }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].url).toContain('/api/realnex/contact');
    expect(posts[0].body.firstName).toBe('Jane');
  });

  it('success closes the dialog and shows a created banner', async () => {
    const user = userEvent.setup();
    renderIt();
    await user.click(screen.getByRole('button', { name: /Add Contact/ }));
    await user.type(firstNameInput(), 'Jane');
    await user.click(screen.getByRole('button', { name: /Continue/ }));
    await user.click(screen.getByRole('button', { name: /Create contact/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText(/Created Jane/)).toBeTruthy();
  });
});

describe('AddContact — company picker + useCompanyAddress rule', () => {
  it('useCompanyAddress is disabled until a company is selected', async () => {
    const user = userEvent.setup();
    renderIt();
    await user.click(screen.getByRole('button', { name: /Add Contact/ }));
    await user.type(firstNameInput(), 'Jane');

    const inherit = screen.getByRole('checkbox', { name: /Use the company/i }) as HTMLInputElement;
    expect(inherit.disabled).toBe(true); // no company → can't inherit

    await user.click(screen.getByRole('button', { name: 'pick-company' }));
    expect(screen.getByText('Acme Corp')).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: /Use the company/i }) as HTMLInputElement).disabled).toBe(false);
  });

  it('checking useCompanyAddress hides the address section and confirms as inherited', async () => {
    const user = userEvent.setup();
    renderIt();
    await user.click(screen.getByRole('button', { name: /Add Contact/ }));
    await user.type(firstNameInput(), 'Jane');
    await user.click(screen.getByRole('button', { name: 'pick-company' }));
    await user.click(screen.getByRole('checkbox', { name: /Use the company/i }));

    // Reveal the optional section — the address inputs must NOT be there while inheriting.
    await user.click(screen.getByRole('button', { name: /Add title, contact info/i }));
    expect(screen.queryByPlaceholderText('Street')).toBeNull();
    expect(screen.queryByPlaceholderText('City')).toBeNull();

    await user.click(screen.getByRole('button', { name: /Continue/ }));
    expect(screen.getByText(/Inherited from the company/i)).toBeTruthy();
    const body = { companyKey: 'CO-123', useCompanyAddress: true };
    await user.click(screen.getByRole('button', { name: /Create contact/ }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].body).toMatchObject(body);
    expect(posts[0].body.address).toBeUndefined();
  });

  it('single-flight: Create disabled while pending; a second click does not double-fire', async () => {
    let resolve: () => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: any) => {
        posts.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : undefined });
        return new Promise((r) => {
          resolve = () => r({ ok: true, status: 200, json: async () => ({ key: 'CT-1', warnings: [] }) });
        });
      }),
    );
    const user = userEvent.setup();
    renderIt();
    await user.click(screen.getByRole('button', { name: /Add Contact/ }));
    await user.type(firstNameInput(), 'Jane');
    await user.click(screen.getByRole('button', { name: /Continue/ }));
    await user.click(screen.getByRole('button', { name: /Create contact/ }));
    const pending = (await screen.findByRole('button', { name: /Creating/ })) as HTMLButtonElement;
    expect(pending.disabled).toBe(true);
    await user.click(pending);
    expect(posts).toHaveLength(1);
    resolve();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('AddContact — inline company create (P3.9 W1→W2 chaining)', () => {
  const addContact = () => screen.getByRole('button', { name: /Add Contact/ });
  const createNew = () => screen.getByRole('button', { name: 'create-new-company' });

  it('opens the company dialog prefilled with the typed name, writing nothing yet', async () => {
    vi.stubGlobal('fetch', mkRouter());
    const user = userEvent.setup();
    renderIt();
    await user.click(addContact());
    await user.type(firstNameInput(), 'Jane');
    await user.click(createNew());

    expect(companyDialog()).toBeTruthy();
    expect(orgInput().value).toBe('Typed New Co'); // prefilled from what was typed into the picker
    expect(posts).toHaveLength(0); // nothing written yet — the confirm gate is still ahead
  });

  it('attaches the RETURNED key, preserves every contact field, and still requires the contact confirm', async () => {
    vi.stubGlobal('fetch', mkRouter());
    const user = userEvent.setup();
    renderIt();
    await user.click(addContact());

    // Fill the contact, including the optional section.
    await user.type(firstNameInput(), 'Jane');
    await user.type(screen.getAllByRole('textbox')[1], 'Doe');
    await user.click(screen.getByRole('button', { name: /Add title, contact info/i }));
    await user.type(screen.getAllByRole('textbox')[2], 'VP Real Estate'); // Title
    await user.type(screen.getByPlaceholderText('Street'), '525 B Street');

    // Detour through the nested company create.
    await user.click(createNew());
    await user.click(within(companyDialog()).getByRole('button', { name: /Continue/ }));
    await user.click(screen.getByRole('button', { name: /Create company/ }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add Company' })).toBeNull());

    // Company attached and flagged as new.
    expect(screen.getByText('Typed New Co')).toBeTruthy();
    expect(screen.getByText('just created')).toBeTruthy();

    // EVERY field typed before the detour survived it (the whole point of the feature).
    expect((screen.getAllByRole('textbox')[0] as HTMLInputElement).value).toBe('Jane');
    expect((screen.getAllByRole('textbox')[1] as HTMLInputElement).value).toBe('Doe');
    expect(screen.getByDisplayValue('VP Real Estate')).toBeTruthy();
    expect((screen.getByPlaceholderText('Street') as HTMLInputElement).value).toBe('525 B Street');

    // Exactly ONE write so far — the company. The contact was NOT auto-submitted.
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toContain('/api/realnex/company');

    // Two irreversible writes, two confirmations: the contact keeps its own gate.
    await user.click(screen.getByRole('button', { name: /Continue/ }));
    expect(screen.getByText(/creates a NEW contact/i)).toBeTruthy();
    expect(posts).toHaveLength(1); // still nothing written on the contact
    await user.click(screen.getByRole('button', { name: /Create contact/ }));
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1].url).toContain('/api/realnex/contact');
    expect(posts[1].body.companyKey).toBe('CO-NEW-9'); // linked by the key the create RETURNED
  });

  it('contact failure after a company success KEEPS the company attached and explains (no duplicate on retry)', async () => {
    vi.stubGlobal(
      'fetch',
      mkRouter({ contactStatus: 502, contactBody: { error: 'realnex_write_failed', status: 500, problem: { detail: 'upstream boom' } } }),
    );
    const user = userEvent.setup();
    renderIt();
    await user.click(addContact());
    await user.type(firstNameInput(), 'Jane');

    await user.click(createNew());
    await user.click(within(companyDialog()).getByRole('button', { name: /Continue/ }));
    await user.click(screen.getByRole('button', { name: /Create company/ }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add Company' })).toBeNull());

    await user.click(screen.getByRole('button', { name: /Continue/ }));
    await user.click(screen.getByRole('button', { name: /Create contact/ }));

    // The company is permanent in RealNex — say so, and keep it selected so a retry attaches to it.
    await waitFor(() => expect(screen.getByText(/was created in RealNex/i)).toBeTruthy());
    expect(screen.getAllByText(/Typed New Co/).length).toBeGreaterThan(0); // never silently cleared
    expect(screen.getByRole('dialog', { name: 'Add Contact' })).toBeTruthy(); // stays open to retry
  });

  it('company-create failure stays in the nested dialog and leaves the contact form untouched behind it', async () => {
    vi.stubGlobal(
      'fetch',
      mkRouter({ companyStatus: 502, companyBody: { error: 'realnex_write_failed', status: 500, problem: { detail: 'upstream boom' } } }),
    );
    const user = userEvent.setup();
    renderIt();
    await user.click(addContact());
    await user.type(firstNameInput(), 'Jane');

    await user.click(createNew());
    await user.click(within(companyDialog()).getByRole('button', { name: /Continue/ }));
    await user.click(screen.getByRole('button', { name: /Create company/ }));

    // Error surfaces INSIDE the nested dialog, which stays open.
    await waitFor(() => expect(screen.getByText(/MAY have been created/)).toBeTruthy());
    expect(companyDialog()).toBeTruthy();

    // Close it: the contact form is exactly as it was, with no company attached.
    await user.click(within(companyDialog()).getByRole('button', { name: /Close.*verify in RealNex/i }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add Company' })).toBeNull());
    expect((screen.getAllByRole('textbox')[0] as HTMLInputElement).value).toBe('Jane');
    expect(createNew()).toBeTruthy(); // picker still showing ⇒ no company got attached
    expect(posts).toHaveLength(1); // only the failed company attempt
  });
});
