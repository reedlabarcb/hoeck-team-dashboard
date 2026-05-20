'use client';

/**
 * Client-side wrapper that mounts useSystemStateInvalidation once for the whole dashboard.
 * Without this, no view would auto-refresh on other users' writes — defeats the whole point
 * of the React Query polling story (golf-bd "Brandon never saw Reed's changes" lesson).
 */

import { ReactNode } from 'react';
import { useSystemStateInvalidation } from '@/lib/hooks/useSystemStateInvalidation';

export function DashboardClientShell({ children }: { children: ReactNode }) {
  useSystemStateInvalidation();
  return <>{children}</>;
}
