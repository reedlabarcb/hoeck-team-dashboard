'use client';

/**
 * Client-side wrapper that mounts useSystemStateInvalidation once for the whole dashboard, and
 * provides server-read feature flags to client components via context.
 * Without the invalidation hook, no view would auto-refresh on other users' writes — defeats the
 * whole point of the React Query polling story (golf-bd "Brandon never saw Reed's changes" lesson).
 */

import { ReactNode } from 'react';
import { useSystemStateInvalidation } from '@/lib/hooks/useSystemStateInvalidation';
import { FeatureFlagsProvider } from '@/components/FeatureFlags';

export function DashboardClientShell({ children, realnexCreateEnabled }: { children: ReactNode; realnexCreateEnabled: boolean }) {
  useSystemStateInvalidation();
  return <FeatureFlagsProvider value={{ realnexCreateEnabled }}>{children}</FeatureFlagsProvider>;
}
