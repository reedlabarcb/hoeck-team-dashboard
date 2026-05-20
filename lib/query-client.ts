/**
 * TanStack React Query — central config.
 *
 * Lineage:
 *   - golf-bd commit 9b4cf2b ("Auto-refresh Pipeline tab every 60s for multi-user sync")
 *     proved that stale-tab data is a real problem with 2+ editors. This config plus
 *     per-query polling intervals (defined in `query keys` files) is our answer.
 *
 * Defaults:
 *   - refetchOnWindowFocus: true  — catches "switched tabs" case
 *   - refetchOnReconnect:   true  — catches "laptop sleeping" case
 *   - refetchOnMount: 'always'    — catches "navigated back" case
 *   - staleTime: 30s              — fresh window before automatic refetch
 *   - retry: 1                    — transient failures
 *
 * Per-query overrides (set at `useQuery` callsite):
 *   - activity_feed:         refetchInterval: 30_000
 *   - companies/contacts:    refetchInterval: 60_000
 *   - notes on open record:  refetchInterval: 45_000
 *   - system_state polling:  refetchInterval: 30_000
 *   - master_excel lookup:   refetchInterval: undefined  (on-demand only)
 *   - box_folder_index:      refetchInterval: undefined  (indexed nightly)
 */

import { QueryClient } from '@tanstack/react-query';

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        refetchOnMount: 'always',
        staleTime: 30_000,
        retry: 1,
      },
      mutations: {
        retry: 0, // never silently retry a write — surface failures so we can show conflict UI
      },
    },
  });
}

// Browser-side singleton so navigations don't create new clients.
let browserQueryClient: QueryClient | undefined = undefined;

export function getQueryClient(): QueryClient {
  if (typeof window === 'undefined') {
    // Server: always make a new client (request-scoped).
    return makeQueryClient();
  }
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}
