// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MasterExcelPage from './page';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Fixture dates are RELATIVE TO NOW, never hardcoded — an absolute date like "2026-08-28" is future
// today and past in two months, which would make these tests pass now and silently fail later.
// (Real timers throughout: fake timers hang userEvent in this repo.)
function isoInDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T00:00:00`;
}

const FUTURE_45 = '1901 L St NW';        // renewal window closes in 45 days
const DUE_TODAY = '4800 N Scottsdale Rd'; // closes today
const PAST_10 = '525 B Street';           // closed 10 days ago
const NO_DATE = '100 SW Main St';         // no renewal window date at all
const OTHER_CLIENT = '900 ACME Way';      // different client, closes in 200 days

const mkRow = (over: Record<string, unknown>) => ({
  client: 'Procopio',
  market: null,
  address: null,
  spaceSf: null,
  leaseExpiration: isoInDays(400),
  renewalWindowStart: isoInDays(-30),
  renewalWindowEnd: null,
  renewalDeadline: null,
  terminationDeadline: null,
  notes: null,
  sourceRow: 2,
  ...over,
});

const ROWS = [
  mkRow({ market: 'DC', address: FUTURE_45, renewalWindowEnd: isoInDays(45), sourceRow: 2 }),
  mkRow({ market: 'Scottsdale', address: DUE_TODAY, renewalWindowEnd: isoInDays(0), sourceRow: 3 }),
  mkRow({ market: 'San Diego', address: PAST_10, renewalWindowEnd: isoInDays(-10), sourceRow: 4 }),
  mkRow({ market: 'Portland', address: NO_DATE, renewalWindowEnd: null, sourceRow: 5 }),
  mkRow({ client: 'ACME', market: 'DC', address: OTHER_CLIENT, renewalWindowEnd: isoInDays(200), sourceRow: 9 }),
];

const SOURCE = { boxFileId: '1', etag: 'e1', fetchedAt: new Date().toISOString(), cacheHit: true, fileName: 'TT Rep Master Client List.xlsx', boxModifiedAt: null };

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MasterExcelPage />
    </QueryClientProvider>,
  );
}

const daysFilter = () => screen.getByLabelText('Filter by days to act');
const marketFilter = () => screen.getByLabelText('Filter by market');
const searchBox = () => screen.getByPlaceholderText(/client name/i);

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = new URL(String(url), 'http://t');
      if (u.pathname.endsWith('/api/master-excel/all')) {
        return { ok: true, status: 200, json: async () => ({ rows: ROWS, rowCount: ROWS.length, source: SOURCE, warnings: [] }) };
      }
      if (u.pathname.endsWith('/api/master-excel/lookup')) {
        // Emulate the server: case-insensitive client contains + exact market when supplied.
        const q = (u.searchParams.get('client') ?? '').toLowerCase();
        const mkt = u.searchParams.get('market');
        const rows = ROWS.filter(
          (r) => r.client.toLowerCase().includes(q) && (!mkt || r.market === mkt),
        );
        return { ok: true, status: 200, json: async () => ({ rows, matchCount: rows.length, multipleMatches: rows.length > 1, query: { client: q }, source: SOURCE, warnings: [] }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Days to Act — card display', () => {
  it('replaces the redundant Renewal Deadline cell with a Days to Act cell', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(searchBox(), 'Procopio');
    await screen.findByText(FUTURE_45, {}, { timeout: 2000 });

    expect(screen.queryByText('Renewal Deadline')).toBeNull(); // removed
    expect(screen.getAllByText('Days to Act').length).toBe(4); // one per lease
    // The other four date lines survive.
    expect(screen.getAllByText('Lease Expiration').length).toBe(4);
    expect(screen.getAllByText('Renewal Window Start').length).toBe(4);
    expect(screen.getAllByText('Renewal Window End').length).toBe(4);
    expect(screen.getAllByText('Termination Deadline').length).toBe(4);
  });

  it('future → "N days"; today → "due today"', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(searchBox(), 'Procopio');
    await screen.findByText(FUTURE_45, {}, { timeout: 2000 });

    expect(screen.getByText('45 days')).toBeTruthy();
    expect(screen.getByText('due today')).toBeTruthy();
  });

  it('PAST window stays visible and reads urgent — never hidden or clamped to 0', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(searchBox(), 'Procopio');
    await screen.findByText(PAST_10, {}, { timeout: 2000 }); // the lease is still on screen

    expect(screen.getByText('window closed (10 days ago)')).toBeTruthy();
    // "Past due" is also a filter-dropdown option label — assert the CARD badge specifically.
    const badges = screen.getAllByText('Past due').filter((el) => el.tagName !== 'OPTION');
    expect(badges).toHaveLength(1); // urgent treatment on the closed lease
    expect(screen.queryByText('0 days')).toBeNull(); // not clamped
  });

  it('null renewal window → "—" and the line still renders', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(searchBox(), 'Procopio');
    await screen.findByText(NO_DATE, {}, { timeout: 2000 });

    // Lease Expiration is populated on every fixture row, so any "—" here is the Days to Act cell.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Days to Act').length).toBe(4); // never hidden
  });
});

describe('Days to Act — filter buckets', () => {
  it('"Past due" shows ONLY already-closed windows', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(searchBox(), 'Procopio');
    await screen.findByText(FUTURE_45, {}, { timeout: 2000 });

    await user.selectOptions(daysFilter(), 'past');
    await waitFor(() => expect(screen.queryByText(FUTURE_45)).toBeNull());
    expect(screen.getByText(PAST_10)).toBeTruthy();
    expect(screen.queryByText(DUE_TODAY)).toBeNull(); // due today is not yet past
    expect(screen.queryByText(NO_DATE)).toBeNull();
  });

  it('"Under 30 days" INCLUDES past-due and due-today, excludes the 45-day lease', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(searchBox(), 'Procopio');
    await screen.findByText(FUTURE_45, {}, { timeout: 2000 });

    await user.selectOptions(daysFilter(), '30');
    await waitFor(() => expect(screen.queryByText(FUTURE_45)).toBeNull());
    expect(screen.getByText(PAST_10)).toBeTruthy(); // a closed window is the MOST urgent — must stay
    expect(screen.getByText(DUE_TODAY)).toBeTruthy();
    expect(screen.queryByText(NO_DATE)).toBeNull();
  });

  it('"Under 60 days" adds the 45-day lease; null-date lease still excluded', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(searchBox(), 'Procopio');
    await screen.findByText(FUTURE_45, {}, { timeout: 2000 });

    await user.selectOptions(daysFilter(), '60');
    await waitFor(() => expect(screen.queryByText(NO_DATE)).toBeNull());
    expect(screen.getByText(FUTURE_45)).toBeTruthy();
    expect(screen.getByText(DUE_TODAY)).toBeTruthy();
    expect(screen.getByText(PAST_10)).toBeTruthy();
  });

  it('"Any" (default) keeps every lease, including the one with no renewal window date', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(searchBox(), 'Procopio');
    await screen.findByText(NO_DATE, {}, { timeout: 2000 });

    for (const addr of [FUTURE_45, DUE_TODAY, PAST_10, NO_DATE]) {
      expect(screen.getByText(addr)).toBeTruthy();
    }
  });

  it('with no client typed, a days filter lists matching leases across ALL clients', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(daysFilter()).toBeTruthy());

    await user.selectOptions(daysFilter(), '90');
    // Cross-client view: the three Procopio leases inside 90 days; NOT the 200-day ACME lease,
    // NOT the null-date lease.
    await screen.findByText(PAST_10, {}, { timeout: 2000 });
    expect(screen.getByText(FUTURE_45)).toBeTruthy();
    expect(screen.getByText(DUE_TODAY)).toBeTruthy();
    expect(screen.queryByText(OTHER_CLIENT)).toBeNull();
    expect(screen.queryByText(NO_DATE)).toBeNull();
  });
});

describe('Days to Act — composes with the other filters', () => {
  it('search + market + days all apply together', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(searchBox(), 'Procopio');
    await screen.findByText(FUTURE_45, {}, { timeout: 2000 });

    // Market narrows (server-side) to the DC lease; days-to-act keeps it (45 < 90).
    await user.selectOptions(marketFilter(), 'DC');
    await user.selectOptions(daysFilter(), '90');
    await waitFor(() => expect(screen.queryByText(PAST_10)).toBeNull());
    expect(screen.getByText(FUTURE_45)).toBeTruthy();

    // Tighten days to under 30 → the 45-day DC lease drops out, leaving nothing.
    await user.selectOptions(daysFilter(), '30');
    await waitFor(() => expect(screen.queryByText(FUTURE_45)).toBeNull());
    expect(screen.getByText(/none match/i)).toBeTruthy(); // explains WHY it's empty
  });

  it('market + days compose on the cross-client view (no search term)', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(daysFilter()).toBeTruthy());

    await user.selectOptions(daysFilter(), '90');
    await screen.findByText(PAST_10, {}, { timeout: 2000 });

    await user.selectOptions(marketFilter(), 'DC');
    await waitFor(() => expect(screen.queryByText(PAST_10)).toBeNull()); // San Diego lease filtered out
    expect(screen.getByText(FUTURE_45)).toBeTruthy(); // DC + 45 days
  });
});
