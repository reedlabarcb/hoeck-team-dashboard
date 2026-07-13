'use client';

/**
 * <RecordHistory> — a record's RealNex History/notes, read LIVE (P3.13). Mounted on the contact
 * & company detail pages beneath the mirror-rendered profile, so the profile stays visible while
 * only this panel loads/errors. Notes are always current (live getObjectHistory per view), never
 * from the mirror.
 *
 * Author display (single-JWT limitation — see MEMORY): resolved → "· by {name}" (dashboard-logged
 * notes authenticate as Mike → "by Mike Hoeck"); unresolved → "· logged in RealNex" (never
 * mislabel a colleague's note as Mike, never leave it blank-ambiguous).
 */

import { useInfiniteQuery } from '@tanstack/react-query';
import type { HistoryPage } from '@/lib/realnex/history';
import { formatLeaseExpiry } from '@/lib/realnex/format';

interface Props {
  objectKey: string;
  /** /activities?type=…&key=… link to log a note to this record (shown in the empty state). */
  logNoteHref?: string;
}

const PAGE_SIZE = 25;

async function fetchHistory(key: string, page: number): Promise<HistoryPage> {
  const res = await fetch(`/api/realnex/history?key=${encodeURIComponent(key)}&page=${page}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Notes fetch failed: ${res.status}`);
  return res.json();
}

/** MM/DD/YYYY from the note's ISO-naive date (reuses the date-part formatter). */
function noteDate(iso: string | null): string {
  return formatLeaseExpiry(iso);
}

export function RecordHistory({ objectKey, logNoteHref }: Props) {
  const q = useInfiniteQuery({
    queryKey: ['realnex', 'history', objectKey],
    queryFn: ({ pageParam }) => fetchHistory(objectKey, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((n, p) => n + p.items.length, 0);
      return loaded < (last.totalCount ?? 0) ? (last.pageNumber ?? all.length) + 1 : undefined;
    },
    refetchOnWindowFocus: true,
  });

  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const total = q.data?.pages[0]?.totalCount ?? 0;
  const remaining = Math.max(0, total - items.length);

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
        Notes{q.isSuccess ? ` (${total})` : ''}
      </h2>

      {q.isLoading ? (
        <div role="status" aria-live="polite" className="space-y-3">
          <span className="sr-only">Loading notes…</span>
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="mb-2 h-3 w-40 animate-pulse rounded bg-gray-200" />
              <div className="h-4 w-3/4 animate-pulse rounded bg-gray-100" />
            </div>
          ))}
        </div>
      ) : q.isError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm">
          <span className="text-red-800">Couldn&apos;t load notes from RealNex.</span>
          <button
            type="button"
            onClick={() => void q.refetch()}
            className="ml-2 rounded border border-red-300 px-2 py-0.5 text-xs font-medium text-red-800 hover:bg-red-100"
          >
            Retry
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-5 text-sm text-gray-500">
          No notes logged yet.
          {logNoteHref && (
            <a href={logNoteHref} className="ml-2 font-medium text-blue-700 hover:underline">
              Log a note →
            </a>
          )}
        </div>
      ) : (
        <>
          <ul className="space-y-3">
            {items.map((n, i) => (
              <li key={n.historyKey ?? i} className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
                  <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 font-medium text-gray-700">
                    {n.eventTypeName ?? 'Note'}
                  </span>
                  <span className="tabular-nums">{noteDate(n.date)}</span>
                  <span>· {n.userName ? `by ${n.userName}` : 'logged in RealNex'}</span>
                </div>
                {n.subject && <div className="text-sm font-medium text-gray-900">{n.subject}</div>}
                {n.notes && <div className="mt-0.5 whitespace-pre-wrap text-sm text-gray-700">{n.notes}</div>}
              </li>
            ))}
          </ul>
          {q.hasNextPage && (
            <button
              type="button"
              onClick={() => void q.fetchNextPage()}
              disabled={q.isFetchingNextPage}
              className="mt-3 rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
            >
              {q.isFetchingNextPage ? 'Loading…' : `Load older notes (${remaining} remaining)`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
