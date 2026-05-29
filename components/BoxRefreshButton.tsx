'use client';

/* eslint-disable react-hooks/refs, react-hooks/purity --
 * This component intentionally uses the canonical "elapsed timer" pattern:
 * a ref to capture the start moment + a setInterval that re-renders every 1s + Date.now()
 * in render. React 19's stricter hook rules misclassify this UI pattern; the implementation
 * is correct (a timer UI is supposed to read wall-clock time during render).
 */

/**
 * "Refresh from Box" button on /files.
 *
 * Behavior matrix:
 *   - No active job  → label "Refresh from Box", click POSTs /api/box/sync
 *   - Status=queued  → label "Queued… NN:NN" with spinner; click disabled
 *   - Status=running → label "Syncing… NN:NN" with spinner; click disabled
 *                      Progress text underneath: "N folders / M files · current_path"
 *   - Status=completed → returns to idle state (parent renders a banner separately)
 *   - Status=failed    → returns to idle state (parent renders error + Retry separately)
 *
 * mm:ss counter starts from the in-component first-pending moment, not from job.startedAt,
 * because the user's perceived "I clicked it just now" is what matters here.
 */

import { useEffect, useRef, useState } from 'react';

interface ProgressDetails {
  foldersWalked: number;
  filesIndexed: number;
  currentPath: string | null;
  syncMode: 'full' | 'incremental';
}

interface Props {
  onClick: () => void;
  /** True while POST /api/box/sync is in flight OR a job is queued/running. */
  isPending: boolean;
  /** Walker progress when isPending — driven by the polling hook. */
  progress?: ProgressDetails | null;
  disabled?: boolean;
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function compactNumber(n: number): string {
  return n.toLocaleString('en-US');
}

export function BoxRefreshButton({ onClick, disabled, isPending, progress }: Props) {
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
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || isPending}
        className="inline-flex items-center gap-1.5 rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        title="Trigger an incremental sync from Box (full walk on first run, then incremental)"
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
            Syncing… <span className="font-mono text-xs text-gray-500">{formatElapsed(elapsedMs)}</span>
          </span>
        ) : (
          'Refresh from Box'
        )}
      </button>
      {isPending && progress && (
        <div
          className="max-w-md text-right text-[11px] leading-tight text-gray-600"
          title={progress.currentPath ?? undefined}
        >
          <div>
            {compactNumber(progress.foldersWalked)} folders · {compactNumber(progress.filesIndexed)} files
            {progress.syncMode === 'full' && (
              <span className="ml-1 rounded bg-amber-50 px-1 text-[10px] uppercase tracking-wide text-amber-800 border border-amber-200">
                full
              </span>
            )}
          </div>
          {progress.currentPath && (
            <div
              className="overflow-hidden text-ellipsis whitespace-nowrap text-gray-500"
              style={{ direction: 'rtl', textAlign: 'right' }}
            >
              {/* RTL trick keeps the END of long paths visible (the leaf folder), which is what
                  the user wants to see — they know they're inside Tenants - ChapmanHoeck. */}
              <bdo dir="ltr">{progress.currentPath}</bdo>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
