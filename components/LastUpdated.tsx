'use client';

/**
 * <LastUpdated query={...} />
 *
 * Renders a small grey timestamp in the corner of any list/detail view:
 *   Updated 14:32:08 ↻
 *
 * Click the ↻ icon → React Query invalidates that query and forces a refetch.
 *
 * Required by AGENTS.md "React Query Rules" — every view component renders <LastUpdated />.
 * Lineage: golf-bd lesson — without a timestamp users can't tell if data is fresh.
 */

import { UseQueryResult } from '@tanstack/react-query';

interface Props {
  /** The React Query result whose data you want to time-stamp. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: Pick<UseQueryResult<any>, 'dataUpdatedAt' | 'refetch' | 'isFetching'>;
  /** Optional label override; defaults to "Updated". */
  label?: string;
}

function formatTime(ts: number | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  // HH:MM:SS in the user's local timezone — matches the spec's example.
  return d.toLocaleTimeString('en-US', { hour12: false });
}

export function LastUpdated({ query, label = 'Updated' }: Props) {
  const time = formatTime(query.dataUpdatedAt);
  return (
    <div className="inline-flex items-center gap-2 text-xs text-gray-500">
      <span>
        {label} {time}
      </span>
      <button
        type="button"
        onClick={() => void query.refetch()}
        disabled={query.isFetching}
        className="rounded p-0.5 hover:bg-gray-100 disabled:opacity-50"
        title="Refresh now"
        aria-label="Refresh now"
      >
        {/* circular-arrow / refresh glyph */}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={query.isFetching ? 'animate-spin' : ''}
        >
          <polyline points="23 4 23 10 17 10" />
          <polyline points="1 20 1 14 7 14" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
      </button>
    </div>
  );
}
