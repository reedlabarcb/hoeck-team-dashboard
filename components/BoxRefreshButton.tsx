'use client';

/**
 * "Refresh from Box" button on /files. POST /api/box/reindex.
 * Spinner while in flight.
 */

interface Props {
  onClick: () => void;
  disabled?: boolean;
  isPending?: boolean;
}

export function BoxRefreshButton({ onClick, disabled, isPending }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || isPending}
      className="inline-flex items-center gap-1.5 rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      title="Re-walk the Box tree and update the local index"
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
      {isPending ? 'Refreshing…' : 'Refresh from Box'}
    </button>
  );
}
