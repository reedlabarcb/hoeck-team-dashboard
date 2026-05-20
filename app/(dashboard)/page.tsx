/**
 * Dashboard home (Phase 1 placeholder).
 * Real content (recent activity feed, upcoming expirations, folder health, quick-add CTAs)
 * lands in Phase 8.
 */

import Link from 'next/link';

export default function DashboardHome() {
  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold text-gray-900">Welcome</h1>
      <p className="mt-2 text-sm text-gray-600">
        Phase 1 foundation is live. The integrations below are stubbed until later phases:
      </p>
      <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-gray-700">
        <li>
          <strong>Phase 2:</strong> Box folder index, file browser
        </li>
        <li>
          <strong>Phase 3:</strong> RealNex sync + four workflows (Company, Contact, Activity, Query)
        </li>
        <li>
          <strong>Phase 4:</strong> Master Excel reads (critical-date lookups)
        </li>
        <li>
          <strong>Phase 5:</strong> Master Excel appends + lease filing
        </li>
        <li>
          <strong>Phase 6:</strong> Scoped Box folder rename
        </li>
        <li>
          <strong>Phase 7:</strong> Notes, tags, optimistic-lock conflict UI
        </li>
        <li>
          <strong>Phase 8:</strong> Home dashboard widgets, full backup UI, system status
        </li>
      </ul>
      <p className="mt-6 text-sm text-gray-700">
        Verify system status at{' '}
        <Link href="/health" className="text-blue-700 underline hover:text-blue-900">
          /health
        </Link>
        . Download a backup with the button in the top-right.
      </p>
    </div>
  );
}
