'use client';

/**
 * Minimal modal shell for the create dialogs — reuses the FullWalkConfirmModal pattern (fixed overlay,
 * role="dialog"/aria-modal, Esc-to-close, overlay-click-to-close) with a header + scrollable body +
 * footer. Presentational; the dialog owns the step/mutation state.
 */
import { useEffect, type ReactNode } from 'react';

interface Props {
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer: ReactNode;
}

export function CreateModalShell({ onClose, title, children, footer }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg border border-gray-200 bg-white shadow-lg">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-3">{footer}</div>
      </div>
    </div>
  );
}
