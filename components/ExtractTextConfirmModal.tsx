'use client';

/**
 * <ExtractTextConfirmModal /> — confirmation dialog before kicking off PDF text extraction.
 *
 * Same shape as <FullWalkConfirmModal /> (Cancel autofocus, Esc dismisses) but
 * milder copy — text extraction is fully reversible (it just sets columns)
 * and can be interrupted at any time without leaving the index in a bad state.
 *
 * The pendingCount is shown in the body so the user knows the rough work scope
 * before saying yes.
 */

import { useEffect, useRef } from 'react';

interface Props {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  /** Number of PDFs currently in extraction_status='pending'. */
  pendingCount: number;
}

export function ExtractTextConfirmModal({ open, onCancel, onConfirm, pendingCount }: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  useEffect(() => {
    if (open) {
      const id = setTimeout(() => cancelRef.current?.focus(), 0);
      return () => clearTimeout(id);
    }
  }, [open]);

  if (!open) return null;

  // Rough estimate: ~1.5s per PDF (download + Python parse).
  const estMinutes = Math.max(1, Math.round((pendingCount * 1.5) / 60));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="extract-text-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg border border-gray-200">
        <h2 id="extract-text-title" className="text-lg font-semibold text-gray-900">
          Extract PDF text?
        </h2>
        <p className="mt-2 text-sm text-gray-700">
          We&apos;ll download each pending PDF from Box, pull text via{' '}
          <code className="text-xs">pdfplumber</code>, and index it for full-text search.
        </p>
        <p className="mt-2 text-sm text-gray-700">
          <span className="font-medium">{pendingCount.toLocaleString()}</span> PDFs in the queue
          — roughly <span className="font-medium">{estMinutes} min</span>. Scanned (image-only)
          PDFs will be skipped and flagged so we know to revisit them when OCR lands in Phase 2.5b.
        </p>
        <p className="mt-2 text-sm text-gray-700">
          You can navigate away — extraction runs in the background, and progress survives reloads.
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
            className="rounded bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800"
          >
            Yes, extract text
          </button>
        </div>
      </div>
    </div>
  );
}
