'use client';

/**
 * Shown on /companies + /contacts when the RealNex mirror hasn't been synced yet — i.e. no
 * sync job exists (covers both "REALNEX_API_KEY missing" and "never synced"). Unlike Box,
 * RealNex has no per-user OAuth; the single server key is configured in Railway and the
 * mirror is populated by a sync on /realnex.
 */

import Link from 'next/link';

export function ConnectRealNexBanner() {
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-5">
      <div className="flex items-start gap-3">
        <span className="text-2xl" aria-hidden>🗂️</span>
        <div className="flex-1">
          <h2 className="text-base font-semibold text-blue-900">RealNex hasn&apos;t synced yet</h2>
          <p className="mt-1 text-sm text-blue-800">
            This page reads a local mirror of RealNex that&apos;s populated by a sync. No sync has run
            yet (or <code className="rounded bg-blue-100 px-1 text-xs">REALNEX_API_KEY</code> isn&apos;t
            set). Run the first sync on the RealNex Sync page.
          </p>
          <Link
            href="/realnex"
            className="mt-3 inline-flex items-center gap-1.5 rounded bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800"
          >
            Go to RealNex Sync →
          </Link>
        </div>
      </div>
    </div>
  );
}
