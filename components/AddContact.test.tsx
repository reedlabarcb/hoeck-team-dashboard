// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FeatureFlagsProvider } from '@/components/FeatureFlags';

// The company picker is the existing read-side typeahead. Stub it to a single button that
// selects a fixed company, so these tests exercise AddContact's own logic (the companyKey link
// and the useCompanyAddress rule), not the search widget.
vi.mock('@/components/RealNexEntitySearch', () => ({
  RealNexEntitySearch: ({ onSelect }: { onSelect: (e: { key: string; displayName: string }) => void }) => (
    <button type="button" onClick={() => onSelect({ key: 'CO-123', displayName: 'Acme Corp' })}>
      pick-company
    </button>
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
