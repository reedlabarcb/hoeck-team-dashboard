'use client';

/**
 * <LastSyncedBadge /> — small grey badge showing RealNex MIRROR freshness (the last sync's
 * completedAt + who triggered it), distinct from <LastUpdated> which shows when this page last
 * fetched. Reads the latest sync job via useRealnexSyncStatus.
 */

import { useRealnexSyncStatus } from '@/lib/hooks/useRealnexSyncStatus';
import { syncStatusLabel } from '@/lib/realnex/format';

export function LastSyncedBadge() {
  const { job } = useRealnexSyncStatus({ enabled: true });
  const active = job?.status === 'queued' || job?.status === 'running';
  const dot =
    job?.status === 'failed' ? 'bg-red-400' : active ? 'bg-blue-400 animate-pulse' : job ? 'bg-green-400' : 'bg-gray-300';
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-gray-500"
      title="RealNex mirror freshness (last sync)"
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
      {syncStatusLabel(job)}
    </span>
  );
}
