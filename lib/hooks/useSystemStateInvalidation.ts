'use client';

/**
 * useSystemStateInvalidation
 *
 * Polls /api/system/last-write every 30s and invalidates any React Query whose data
 * was fetched BEFORE the relevant table's `updated_at`. This is the mechanism that fixes
 * the golf-bd "Brandon never saw Reed's changes on other tabs" failure:
 *   - User A writes a note → server bumps `system_state.last_write_at` and `tables.notes`
 *   - User B's frontend polls /api/system/last-write every 30s
 *   - User B sees `tables.notes` > their cached fetched_at → React Query invalidates the notes query
 *   - User B's view refreshes within ~30s without any manual action
 *
 * Mount this once in the dashboard root (already wired in app/(dashboard)/layout.tsx).
 */

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export interface LastWriteResponse {
  last_write_at: string | null;
  last_sync_at: string | null;
  tables: Record<string, string | null>;
}

// Map system_state table name → React Query key prefix used by views fetching that table.
const TABLE_TO_QUERY_KEY: Record<string, readonly string[]> = {
  activity_feed: ['activity_feed'],
  notes: ['notes'],
  tags: ['tags'],
  companies_mirror: ['companies'],
  contacts_mirror: ['contacts'],
};

export function useSystemStateInvalidation(intervalMs: number = 30_000) {
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    // Track when we last saw each table updated, so we only invalidate on transitions.
    const seen: Record<string, string | null> = {};

    async function tick() {
      try {
        const res = await fetch('/api/system/last-write', { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const data: LastWriteResponse = await res.json();
        for (const [table, queryKey] of Object.entries(TABLE_TO_QUERY_KEY)) {
          const next = data.tables?.[table] ?? null;
          if (next && seen[table] && next !== seen[table]) {
            queryClient.invalidateQueries({ queryKey: queryKey as unknown as readonly unknown[] });
          }
          seen[table] = next;
        }
      } catch {
        // Polling failures are OK — next tick will retry. Don't surface a toast.
      }
    }

    void tick(); // prime
    const id = setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [queryClient, intervalMs]);
}
