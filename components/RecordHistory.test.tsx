// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RecordHistory } from './RecordHistory';

/* eslint-disable @typescript-eslint/no-explicit-any */
function renderEl(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
const ok = (page: any) => ({ ok: true, json: async () => page });
const mkItems = (n: number, prefix: string, opts: { userName?: string | null } = {}) =>
  Array.from({ length: n }, (_, i) => ({
    historyKey: `${prefix}-${i}`,
    eventTypeKey: 18,
    eventTypeName: 'Note',
    subject: `${prefix}-${i}`,
    notes: 'body text',
    date: '2025-06-10T15:49:00',
    userKey: 'k',
    userName: opts.userName ?? null,
  }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('RecordHistory', () => {
  it('loading: shows a skeleton status while the fetch is pending', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))); // never resolves
    renderEl(<RecordHistory objectKey="K1" />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText(/loading notes/i)).toBeTruthy();
  });

  it('notes: renders newest-first feed with type, date, body, and author labels (resolved + neutral)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({
      totalCount: 2,
      pageNumber: 1,
      items: [
        { historyKey: 'h1', eventTypeName: 'Meeting', subject: 'Lunch with Maria', notes: 'went well', date: '2027-04-30T00:00:00', userName: 'Mike Hoeck' },
        { historyKey: 'h2', eventTypeName: 'Note', subject: 'Colleague note', notes: 'from RealNex', date: '2024-01-15T00:00:00', userName: null },
      ],
    })));
    renderEl(<RecordHistory objectKey="K1" />);
    await screen.findByText('Lunch with Maria');
    expect(screen.getByText('went well')).toBeTruthy();
    expect(screen.getByText('04/30/2027')).toBeTruthy(); // MM/DD/YYYY
    expect(screen.getByText(/by Mike Hoeck/)).toBeTruthy(); // resolved author
    expect(screen.getByText(/logged in RealNex/)).toBeTruthy(); // neutral, unresolved
    expect(screen.getByText('Notes (2)')).toBeTruthy();
  });

  it('empty: shows the empty state + a Log Note link when a href is given', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({ totalCount: 0, pageNumber: 1, items: [] })));
    renderEl(<RecordHistory objectKey="K1" logNoteHref="/activities?type=company&key=K1&name=Procopio" />);
    await screen.findByText(/No notes logged yet/i);
    const link = screen.getByRole('link', { name: /log a note/i }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/activities?type=company&key=K1&name=Procopio');
  });

  it('error: shows an isolated error + Retry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502, json: async () => ({}) })));
    renderEl(<RecordHistory objectKey="K1" />);
    await screen.findByText(/Couldn.t load notes from RealNex/i);
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
  });

  it('load-older: appends the next page and hides the button when exhausted', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const page = new URL(url, 'http://t').searchParams.get('page');
      return page === '2'
        ? ok({ totalCount: 30, pageNumber: 2, items: mkItems(5, 'older') })
        : ok({ totalCount: 30, pageNumber: 1, items: mkItems(25, 'recent') });
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderEl(<RecordHistory objectKey="K1" />);

    await screen.findByText('recent-0');
    const loadMore = await screen.findByRole('button', { name: /load older notes \(5 remaining\)/i });
    await user.click(loadMore);

    await screen.findByText('older-0'); // page 2 appended
    expect(screen.queryByRole('button', { name: /load older/i })).toBeNull(); // exhausted (30/30)
  });
});
