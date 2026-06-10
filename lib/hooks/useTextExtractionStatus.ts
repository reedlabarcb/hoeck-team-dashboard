'use client';

/**
 * useTextExtractionStatus — polls /api/box/extract-text/status while a
 * text_extraction job is queued or running. Sibling of useBoxSyncStatus.
 *
 * Polling cadence: 5s during 'queued' / 'running'; stops on terminal states.
 *
 * localStorage handoff (separate key from walker so they don't collide):
 *   - 'hoeck.activeTextExtractionJobId' written when status enters running.
 *   - Cleared when terminal.
 */

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';

const STORAGE_KEY = 'hoeck.activeTextExtractionJobId';
const POLL_INTERVAL_MS = 5_000;

export interface TextExtractionJob {
  id: string;
  walkId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  jobType: 'folder_walk' | 'text_extraction';
  startedAt: string;
  completedAt: string | null;
  progressFilesProcessed: number;
  progressFilesSucceeded: number;
  progressFilesFailed: number;
  progressFilesSkipped: number;
  currentPath: string | null;
  errorMessage: string | null;
  triggeredBy: string;
}

interface StatusResponse {
  job: TextExtractionJob | null;
}

async function fetchStatus(): Promise<StatusResponse> {
  const res = await fetch('/api/box/extract-text/status', { cache: 'no-store' });
  if (!res.ok) {
    if (res.status === 401) throw new Error('unauthorized');
    throw new Error(`text-extraction status fetch failed: ${res.status}`);
  }
  return res.json();
}

function writeCachedJobId(jobId: string | null) {
  if (typeof window === 'undefined') return;
  try {
    if (jobId === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, jobId);
  } catch {
    /* localStorage may be disabled — best-effort. */
  }
}

export function useTextExtractionStatus(opts: { enabled: boolean }) {
  const query = useQuery<StatusResponse>({
    queryKey: ['box', 'extract-text', 'status'],
    queryFn: fetchStatus,
    enabled: opts.enabled,
    refetchInterval: (q) => {
      const data = q.state.data as StatusResponse | undefined;
      const status = data?.job?.status;
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

export { STORAGE_KEY as TEXT_EXTRACTION_LOCAL_STORAGE_KEY };
