'use client';

/**
 * useRealnexSyncStatus — polls /api/realnex/sync/status while a job is queued or running.
 *
 * Mirrors useBoxSyncStatus: 5s cadence while 'queued'/'running', stops on terminal state,
 * localStorage handoff so a returning tab doesn't flash "no job" for one tick.
 */

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';

const STORAGE_KEY = 'hoeck.activeRealnexSyncJobId';
const POLL_INTERVAL_MS = 5_000;

export interface RealnexSyncJob {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  currentPhase: 'companies' | 'contacts' | 'groups' | 'linking' | null;
  companiesSynced: number;
  contactsSynced: number;
  groupsSynced: number;
  linksResolved: number;
  apiCallsMade: number;
  rateLimitHits: number;
  totalCompanies: number | null;
  totalContacts: number | null;
  startedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
  triggeredBy: string;
  metadata: Record<string, unknown> | null;
}

interface SyncStatusResponse {
  job: RealnexSyncJob | null;
}

async function fetchSyncStatus(): Promise<SyncStatusResponse> {
  const res = await fetch('/api/realnex/sync/status', { cache: 'no-store' });
  if (!res.ok) {
    if (res.status === 401) throw new Error('unauthorized');
    throw new Error(`RealNex sync status fetch failed: ${res.status}`);
  }
  return res.json();
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

export function useRealnexSyncStatus(opts: { enabled?: boolean } = {}) {
  const query = useQuery<SyncStatusResponse>({
    queryKey: ['realnex', 'sync', 'status'],
    queryFn: fetchSyncStatus,
    enabled: opts.enabled ?? true,
    refetchInterval: (q) => {
      const status = (q.state.data as SyncStatusResponse | undefined)?.job?.status;
      if (status === 'queued' || status === 'running') return POLL_INTERVAL_MS;
      return false;
    },
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const status = query.data?.job?.status;
    const jobId = query.data?.job?.id;
    if (status === 'queued' || status === 'running') {
      if (jobId) writeCachedJobId(jobId);
    } else if (status === 'completed' || status === 'failed') {
      writeCachedJobId(null);
    }
  }, [query.data]);

  return {
    job: query.data?.job ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
