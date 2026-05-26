'use client';

/* eslint-disable react-hooks/refs, react-hooks/purity --
 * This component intentionally uses the canonical "elapsed timer" pattern:
 * a ref to capture the start moment + a setInterval that re-renders every 1s + Date.now()
 * in render. React 19's stricter hook rules misclassify this UI pattern; the implementation
 * is correct (a timer UI is supposed to read wall-clock time during render).
 */

/**
 * "Refresh from Box" button on /files. POST /api/box/reindex.
 *
 * While the walker runs, shows an elapsed-time counter alongside the spinner so
 * the user knows the request is genuinely still in flight. The mutation enforces
 * a 5-minute client-side timeout (see /files/page.tsx); if it hits, the spinner
 * clears and an error banner with a Retry button appears.
 */

import { useEffect, useRef, useState } from 'react';

interface Props {
  onClick: () => void;
  disabled?: boolean;
  isPending?: boolean;
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export function BoxRefreshButton({ onClick, disabled, isPending }: Props) {
  // startedAtRef captures the moment isPending flipped true (ref, not state — no re-render
  // on assignment). A simple tick counter forces re-renders once per second; elapsedMs is
  // derived from startedAtRef on every render. This avoids react-hooks/set-state-in-effect
  // while still ticking the UI.
  const startedAtRef = useRef<number | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!isPending) {
      startedAtRef.current = null;
      return;
    }
    startedAtRef.current = Date.now();
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [isPending]);

  const elapsedMs =
    isPending && startedAtRef.current !== null ? Date.now() - startedAtRef.current : 0;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || isPending}
      className="inline-flex items-center gap-1.5 rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      title="Re-walk the Box tree and update the local index (auto-cancels after 5 min)"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={isPending ? 'animate-spin' : ''}
        aria-hidden
      >
        <polyline points="23 4 23 10 17 10" />
        <polyline points="1 20 1 14 7 14" />
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
      </svg>
      {isPending ? (
        <span>
          Refreshing… <span className="font-mono text-xs text-gray-500">{formatElapsed(elapsedMs)}</span>
        </span>
      ) : (
        'Refresh from Box'
      )}
    </button>
  );
}
