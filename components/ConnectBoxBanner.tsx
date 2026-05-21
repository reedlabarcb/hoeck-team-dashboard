'use client';

/**
 * Shown when the calling user has no active Box OAuth connection.
 * Links to /api/auth/box/connect which redirects to Box for consent.
 */

interface Props {
  redirectAfter?: string; // where to send user post-callback; defaults to /files
}

export function ConnectBoxBanner({ redirectAfter = '/files' }: Props) {
  const href = `/api/auth/box/connect?redirect=${encodeURIComponent(redirectAfter)}`;
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-5">
      <div className="flex items-start gap-3">
        <span className="text-2xl" aria-hidden>
          📦
        </span>
        <div className="flex-1">
          <h2 className="text-base font-semibold text-blue-900">Connect Box to browse files</h2>
          <p className="mt-1 text-sm text-blue-800">
            The dashboard reads <code className="rounded bg-blue-100 px-1 text-xs">Tenants – ChapmanHoeck</code>{' '}
            directly from Box. You&apos;ll be redirected to Box to grant read + write access. This only
            happens once — tokens auto-refresh after that.
          </p>
          <a
            href={href}
            className="mt-3 inline-flex items-center gap-1.5 rounded bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800"
          >
            Connect Box →
          </a>
        </div>
      </div>
    </div>
  );
}
