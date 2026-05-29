'use client';

/**
 * useBoxSyncStatus — polls /api/box/sync/status while a job is queued or running.
 *
 * Polling cadence: 5s while status is 'queued' or 'running'. Stops when status becomes
 * 'completed' or 'failed' (terminal). Resumes if a fresh POST starts a new job.
 *
 * localStorage handoff:
 *   - When status becomes 'queued'/'running' we write the jobId to localStorage.
 *   - On page mount we read localStorage and seed the initial state, so a tab that
 *     navigated away mid-sync and came back doesn't show "no job" for one polling tick
 *     before re-fetching.
 *   - When status becomes terminal, we clear localStorage.
 *
 * Returns the latest job from the server (authoritative) — the localStorage value is
 * just a UI optimization for first paint.
 */

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';

const STORAGE_KEY = 'hoeck.activeBoxSyncJobId';
const POLL_INTERVAL_MS = 5_000;

export interface BoxSyncJob {
  id: string;
  walkId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  syncMode: 'full' | 'incremental';
  isForceFull: boolean;
  startedAt: string;
  completedAt: string | null;
  progressFoldersWalked: number;
  progressFilesIndexed: number;
  apiCallsMade: number;
  currentPath: string | null;
  totalFoldersInIndex: number | null;
  errorMessage: string | null;
  triggeredBy: string;
}

interface SyncStatusResponse {
  job: BoxSyncJob | null;
}

async function fetchSyncStatus(): Promise<SyncStatusResponse> {
  const res = await fetch('/api/box/sync/status', { cache: 'no-store' });
  if (!res.ok) {
    if (res.status === 401) throw new Error('unauthorized');
    throw new Error(`Sync status fetch failed: ${res.status}`);
  }
  return res.json();
}

function readCachedJobId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeCachedJobId(jobId: string | null) {
  if (typeof window === 'undefined') return;
  try {
    if (jobId === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, jobId);
  } catch {
    // localStorage may be disabled (private browsing, quota). Best-effort.
  }
}

export function useBoxSyncStatus(opts: { enabled: boolean }) {
  const query = useQuery<SyncStatusResponse>({
    queryKey: ['box', 'sync', 'status'],
    queryFn: fetchSyncStatus,
    enabled: opts.enabled,
    refetchInterval: (q) => {
      const data = q.state.data as SyncStatusResponse | undefined;
      const status = data?.job?.status;
      // Keep polling while queued or running; stop when terminal (or no job).
      if (status === 'queued' || status === 'running') return POLL_INTERVAL_MS;
      return false;
    },
    // Don't refetch on focus *while* polling — would double-tap when window regains focus
    // during an active sync. (Default would do refetchOnFocus.)
    refetchOnWindowFocus: false,
  });

  // Maintain the localStorage handoff alongside server state.
  useEffect(() => {
    const status = query.data?.job?.status;
    const jobId = query.data?.job?.id;
    if (status === 'queued' || status === 'running') {
      if (jobId) writeCachedJobId(jobId);
    } else if (status === 'completed' || status === 'failed') {
      writeCachedJobId(null);
    }
  }, [query.data]);

  // Expose the cached jobId for first-paint optimization (rare hot path, not on every render).
  const cachedJobId = typeof window !== 'undefined' ? readCachedJobId() : null;

  return {
    job: query.data?.job ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    cachedJobId,
    refetch: query.refetch,
  };
}

export { STORAGE_KEY as BOX_SYNC_LOCAL_STORAGE_KEY };
