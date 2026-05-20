'use client';

/**
 * <UpdatesAvailableBadge query={...} table="notes" />
 *
 * Amber pill that appears near LastUpdated when /api/system/last-write reports the relevant
 * table has been updated MORE RECENTLY than the current view's `dataUpdatedAt`.
 *
 * Click → invalidates the query and the data refreshes.
 *
 * Difference vs <LastUpdated />:
 *   - LastUpdated is always visible (timestamp + manual refresh).
 *   - UpdatesAvailableBadge only appears when there's something to update to. It's the visual
 *     cue that says "someone else changed this — click here to pull their changes."
 *
 * Lineage: golf-bd "Brandon never saw Reed's changes" → polling tells us the data is stale,
 * the badge tells the user, the click pulls the fix.
 */

import { useEffect, useState } from 'react';
import { UseQueryResult, useQueryClient } from '@tanstack/react-query';

interface Props {
  /** Query whose data freshness we're tracking. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: Pick<UseQueryResult<any>, 'dataUpdatedAt' | 'refetch'>;
  /** Which system_state table name to watch. e.g. "notes", "companies_mirror" */
  table: string;
}

export function UpdatesAvailableBadge({ query, table }: Props) {
  const queryClient = useQueryClient();
  const [serverUpdatedAt, setServerUpdatedAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const res = await fetch('/api/system/last-write', { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { tables?: Record<string, string | null> };
        const v = data.tables?.[table];
        setServerUpdatedAt(v ? new Date(v).getTime() : null);
      } catch {
        // ignore
      }
    }
    void tick();
    const id = setInterval(tick, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [table]);

  const dataAt = query.dataUpdatedAt ?? 0;
  const shouldShow = serverUpdatedAt && serverUpdatedAt > dataAt;
  if (!shouldShow) return null;

  return (
    <button
      type="button"
      onClick={() => {
        void queryClient.invalidateQueries();
        void query.refetch();
      }}
      className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900 hover:bg-amber-100 border border-amber-200"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />
      New changes available — click to refresh
    </button>
  );
}
