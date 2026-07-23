// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FeatureFlagsProvider } from '@/components/FeatureFlags';
import { AddCompany } from './AddCompany';

/* eslint-disable @typescript-eslint/no-explicit-any */
let posts: Array<{ url: string; body: any }>;

function mkFetch(status = 200, body: unknown = { key: 'CO-1', warnings: [] }) {
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
        <AddCompany />
      </FeatureFlagsProvider>
    </QueryClientProvider>,
  );
}
const ORG = 'e.g. Full Swing Golf';

beforeEach(() => {
  posts = [];
  vi.stubGlobal('fetch', mkFetch());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AddCompany — feature flag', () => {
  it('renders NOTHING when the flag is off', () => {
    renderIt(false);
    expect(screen.queryByRole('button', { name: /Add Company/ })).toBeNull();
  });
  it('renders the button when the flag is on', () => {
    renderIt(true);
    expect(screen.getByRole('button', { name: /Add Company/ })).toBeTruthy();
  });
});

describe('AddCompany — confirm gate + validation', () => {
  it('does NOT POST until Confirm; Continue blocked on empty organization', async () => {
    const user = userEvent.setup();
    renderIt();
    await user.click(screen.getByRole('button', { name: /Add Company/ }));
    expect(screen.getByRole('dialog')).toBeTruthy();

    const cont = screen.getByRole('button', { name: /Continue/ }) as HTMLButtonElement;
    expect(cont.disabled).toBe(true); // empty organization
    await user.type(screen.getByPlaceholderText(ORG), 'Acme');
    expect(cont.disabled).toBe(false);
    expect(posts).toHaveLength(0); // nothing posted while filling

    await user.click(cont); // → confirm step
    expect(posts).toHaveLength(0); // still nothing until Confirm
    expect(screen.getByText(/creates a NEW company/i)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Create company/ }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].url).toContain('/api/realnex/company');
    expect(posts[0].body.organization).toBe('Acme');
  });

  it('success closes the dialog and shows a created banner', async () => {
    const user = userEvent.setup();
    renderIt();
    await user.click(screen.getByRole('button', { name: /Add Company/ }));
    await user.type(screen.getByPlaceholderText(ORG), 'Acme');
    await user.click(screen.getByRole('button', { name: /Continue/ }));
    await user.click(screen.getByRole('button', { name: /Create company/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText(/Created Acme/)).toBeTruthy();
    expect(posts).toHaveLength(1);
  });

  it('200 + warnings is still success (warning shown, not an error)', async () => {
    vi.stubGlobal('fetch', mkFetch(200, { key: 'CO-1', warnings: ['address will sync shortly'] }));
    const user = userEvent.setup();
    renderIt();
    await user.click(screen.getByRole('button', { name: /Add Company/ }));
    await user.type(screen.getByPlaceholderText(ORG), 'Acme');
    await user.click(screen.getByRole('button', { name: /Continue/ }));
    await user.click(screen.getByRole('button', { name: /Create company/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText(/address will sync shortly/)).toBeTruthy();
  });

  it('single-flight: Create disabled while pending; a second click does not double-fire', async () => {
    let resolve: () => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: any) => {
        posts.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : undefined });
        return new Promise((r) => {
          resolve = () => r({ ok: true, status: 200, json: async () => ({ key: 'CO-1', warnings: [] }) });
        });
      }),
    );
    const user = userEvent.setup();
    renderIt();
    await user.click(screen.getByRole('button', { name: /Add Company/ }));
    await user.type(screen.getByPlaceholderText(ORG), 'Acme');
    await user.click(screen.getByRole('button', { name: /Continue/ }));
    await user.click(screen.getByRole('button', { name: /Create company/ }));
    const pending = (await screen.findByRole('button', { name: /Creating/ })) as HTMLButtonElement;
    expect(pending.disabled).toBe(true);
    await user.click(pending); // disabled → no-op
    expect(posts).toHaveLength(1);
    resolve();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('400 → dialog stays open, error shown', async () => {
    vi.stubGlobal('fetch', mkFetch(400, { error: 'invalid_input', field: 'organization', message: 'organization is required' }));
    const user = userEvent.setup();
    renderIt();
    await user.click(screen.getByRole('button', { name: /Add Company/ }));
    await user.type(screen.getByPlaceholderText(ORG), 'Acme');
    await user.click(screen.getByRole('button', { name: /Continue/ }));
    await user.click(screen.getByRole('button', { name: /Create company/ }));
    await waitFor(() => expect(screen.getByText(/organization is required/)).toBeTruthy());
    expect(screen.getByRole('dialog')).toBeTruthy(); // stays open
    expect(posts).toHaveLength(1);
  });

  it('502 → ambiguous: verify-before-retry message and NO one-click retry', async () => {
    vi.stubGlobal('fetch', mkFetch(502, { error: 'realnex_write_failed', status: 500, problem: { detail: 'upstream boom' } }));
    const user = userEvent.setup();
    renderIt();
    await user.click(screen.getByRole('button', { name: /Add Company/ }));
    await user.type(screen.getByPlaceholderText(ORG), 'Acme');
    await user.click(screen.getByRole('button', { name: /Continue/ }));
    await user.click(screen.getByRole('button', { name: /Create company/ }));
    await waitFor(() => expect(screen.getByText(/MAY have been created/)).toBeTruthy());
    expect(screen.getByRole('button', { name: /Close.*verify in RealNex/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Create company/ })).toBeNull(); // no re-fire path
  });
});
