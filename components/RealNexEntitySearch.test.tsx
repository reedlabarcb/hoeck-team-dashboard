// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RealNexEntitySearch } from './RealNexEntitySearch';
import type { EntityResult } from '@/lib/realnex/format';

// Two resolver results with DISTINCT keys — the whole point of these tests is that selecting a
// given row hands the caller back THAT row's key untouched (P3.6 writes history to entity.key).
const CONTACT: EntityResult = {
  type: 'contact',
  key: 'CONTACT-KEY-0001',
  displayName: 'Maria Alvarez',
  companyName: 'Acme Corp',
  email: 'maria@acme.com',
};
const COMPANY: EntityResult = {
  type: 'company',
  key: 'COMPANY-KEY-0002',
  displayName: 'Acme Corp',
  companyName: 'Acme Corp',
  email: null,
};

let fetchMock: ReturnType<typeof vi.fn>;

function renderEl(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ results: [CONTACT, COMPANY] }) }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('RealNexEntitySearch — debounce', () => {
  it('collapses a burst of keystrokes into a single resolver hit', async () => {
    const onQueryChange = vi.fn();
    const user = userEvent.setup();
    renderEl(<RealNexEntitySearch type="both" onSelect={vi.fn()} onQueryChange={onQueryChange} debounceMs={200} />);

    await user.type(screen.getByRole('combobox'), 'acme');
    // Debounce window hasn't elapsed yet (typing 4 chars is far faster than 200ms).
    expect(onQueryChange).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();

    // Once results appear, the debounce has settled.
    await screen.findAllByRole('option', {}, { timeout: 2000 });
    // One onQueryChange with the final value, one resolver call — not one per keystroke.
    expect(onQueryChange).toHaveBeenCalledTimes(1);
    expect(onQueryChange).toHaveBeenCalledWith('acme');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('RealNexEntitySearch — keyboard selection returns the correct entity', () => {
  it('ArrowDown+Enter selects the first result and returns its exact key', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    renderEl(<RealNexEntitySearch type="both" onSelect={onSelect} debounceMs={200} />);

    await user.type(screen.getByRole('combobox'), 'acme');
    await screen.findAllByRole('option', {}, { timeout: 2000 });
    expect(screen.getAllByRole('option')).toHaveLength(2);

    await user.keyboard('{ArrowDown}'); // highlight index 0 = the contact
    await user.keyboard('{Enter}');

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(CONTACT);
    // The critical guarantee for P3.6: the payload's key is the resolved entity's key, verbatim.
    expect(onSelect.mock.calls[0][0].key).toBe('CONTACT-KEY-0001');
  });

  it('ArrowDown twice selects the second result (its own key, not the first)', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    renderEl(<RealNexEntitySearch type="both" onSelect={onSelect} debounceMs={200} />);

    await user.type(screen.getByRole('combobox'), 'acme');
    await screen.findAllByRole('option', {}, { timeout: 2000 });

    await user.keyboard('{ArrowDown}{ArrowDown}'); // index 1 = the company
    await user.keyboard('{Enter}');

    expect(onSelect).toHaveBeenCalledWith(COMPANY);
    expect(onSelect.mock.calls[0][0].key).toBe('COMPANY-KEY-0002');
  });

  it('clicking a result returns that exact entity', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    renderEl(<RealNexEntitySearch type="both" onSelect={onSelect} debounceMs={200} />);

    await user.type(screen.getByRole('combobox'), 'acme');
    const options = await screen.findAllByRole('option', {}, { timeout: 2000 });

    await user.click(options[1]);
    expect(onSelect.mock.calls[0][0].key).toBe('COMPANY-KEY-0002');
  });

  it('Escape closes the dropdown without selecting', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    renderEl(<RealNexEntitySearch type="both" onSelect={onSelect} debounceMs={200} />);

    await user.type(screen.getByRole('combobox'), 'acme');
    await screen.findAllByRole('option', {}, { timeout: 2000 });

    await user.keyboard('{Escape}');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('RealNexEntitySearch — type filter passes through to the resolver', () => {
  it.each(['contact', 'company', 'both'] as const)('type=%s is sent to the resolver', async (t) => {
    const user = userEvent.setup();
    renderEl(<RealNexEntitySearch type={t} onSelect={vi.fn()} debounceMs={200} />);

    await user.type(screen.getByRole('combobox'), 'acme');
    await screen.findAllByRole('option', {}, { timeout: 2000 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('type=' + t);
    expect(url).toContain('q=acme');
  });
});

describe('RealNexEntitySearch — clear', () => {
  it('the clear button empties the input and fires onClear (resets an exact-key filter)', async () => {
    const onClear = vi.fn();
    const user = userEvent.setup();
    renderEl(<RealNexEntitySearch type="company" onSelect={vi.fn()} onClear={onClear} debounceMs={200} />);

    const input = screen.getByRole('combobox') as HTMLInputElement;
    await user.type(input, 'acme');

    await user.click(screen.getByRole('button', { name: /clear/i }));
    expect(input.value).toBe('');
    expect(onClear).toHaveBeenCalled();
  });
});
