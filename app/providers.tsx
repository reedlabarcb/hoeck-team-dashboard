'use client';

/**
 * Root client-side providers: React Query + global 401 fetch wrapper.
 *
 * The global 401 wrapper is critical (golf-bd 1ca7202 lesson): when any /api/* call returns 401,
 * we trigger a full page reload so the login screen takes over. Without this, components show
 * cryptic "Unauthorized" errors and users have no path back to login.
 */

import { ReactNode, useEffect } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query-client';

function install401Handler() {
  if (typeof window === 'undefined') return;
  // Idempotent: only install once.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((window as any).__fetch401Installed) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__fetch401Installed = true;

  const orig = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const res = await orig(...args);
    if (res.status === 401) {
      // Only reload for our own API calls — don't reload on third-party 401s.
      const url = typeof args[0] === 'string' ? args[0] : args[0] instanceof Request ? args[0].url : '';
      if (url.includes('/api/') || url.startsWith('/api/')) {
        // Don't reload from /login itself — would loop.
        if (window.location.pathname !== '/login') {
          window.location.reload();
        }
      }
    }
    return res;
  };
}

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    install401Handler();
  }, []);

  const client = getQueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
