'use client';

/**
 * Client-side feature-flag context. The (dashboard) layout (a server component) reads the flags
 * server-side via lib/flags and passes them into DashboardClientShell, which provides them here — the
 * same "server reads → prop → client" path the Header already uses for the session user. No fetch, no
 * build-time inlining; flipping REALNEX_CREATE_ENABLED is a runtime env change.
 */
import { createContext, useContext, type ReactNode } from 'react';

export interface FeatureFlags {
  realnexCreateEnabled: boolean;
}

const FeatureFlagsContext = createContext<FeatureFlags>({ realnexCreateEnabled: false });

export function FeatureFlagsProvider({ value, children }: { value: FeatureFlags; children: ReactNode }) {
  return <FeatureFlagsContext.Provider value={value}>{children}</FeatureFlagsContext.Provider>;
}

export function useFeatureFlags(): FeatureFlags {
  return useContext(FeatureFlagsContext);
}
