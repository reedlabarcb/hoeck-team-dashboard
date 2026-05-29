'use client';

/**
 * <FullWalkConfirmModal /> — confirmation dialog before triggering a full re-walk.
 *
 * Why a modal instead of just a button click:
 *   - A full walk re-touches every folder in Tenants - ChapmanHoeck (~27k items, ~30 min).
 *   - During that time, the active-job guard returns 409 — no other sync can start.
 *   - Accidental clicks would lock the index for half an hour and frustrate the team.
 *
 * UX details:
 *   - Cancel button has the initial focus (autoFocus). Pressing Enter immediately cancels.
 *   - Escape key dismisses (Cancel).
 *   - Confirm requires a deliberate click of the second button.
 */

import { useEffect, useRef } from 'react';

interface Props {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  /** Approximate item count, e.g. "27k+ folders". Used in the body copy. */
  approxItemDescription?: string;
  /** Approximate walk duration in plain English, e.g. "~30 minutes". */
  approxDuration?: string;
}

export function FullWalkConfirmModal({
  open,
  onCancel,
  onConfirm,
  approxItemDescription = '27k+ folders',
  approxDuration = '~30 minutes',
}: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Esc to cancel.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  // Focus Cancel on open so a stray Enter is a no-op cancel, not a confirm.
  useEffect(() => {
    if (open) {
      // Defer to next tick so the element is in the DOM.
      const id = setTimeout(() => cancelRef.current?.focus(), 0);
      return () => clearTimeout(id);
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="full-walk-title"
      onClick={(e) => {
        // Clicking the overlay (not the dialog) cancels.
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg border border-gray-200">
        <h2 id="full-walk-title" className="text-lg font-semibold text-gray-900">
          Run a full walk?
        </h2>
        <p className="mt-2 text-sm text-gray-700">
          This re-walks all {approxItemDescription} in <code className="text-xs">Tenants - ChapmanHoeck</code>{' '}
          and takes {approxDuration}. During the walk, no other sync can start — Mike, Jack, and Nadya
          will see a &ldquo;sync in progress&rdquo; message if they hit Refresh.
        </p>
        <p className="mt-2 text-sm text-gray-700">
          Only do this if you suspect the index is stale (e.g., folders were deleted in Box and aren&apos;t
          gone from <code className="text-xs">/files</code> yet) or you want to verify a clean state.
          Most refreshes should use the regular incremental Refresh button.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded bg-amber-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-800"
          >
            Yes, run full walk
          </button>
        </div>
      </div>
    </div>
  );
}
