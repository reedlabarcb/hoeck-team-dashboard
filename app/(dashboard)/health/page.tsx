/**
 * /health — live health dashboard page.
 * Renders results of runAllChecks() server-side; client-side refetches every 30s.
 */

import { runAllChecks, aggregateStatus, type CheckResult } from '@/lib/health-checks';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function statusPill(status: CheckResult['status']) {
  const cls =
    status === 'ok'
      ? 'bg-green-50 text-green-800 border-green-200'
      : status === 'warn'
        ? 'bg-amber-50 text-amber-900 border-amber-200'
        : status === 'not_configured'
          ? 'bg-gray-50 text-gray-700 border-gray-200'
          : 'bg-red-50 text-red-800 border-red-200';
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

export default async function HealthPage() {
  const checks = await runAllChecks();
  const agg = aggregateStatus(checks);

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">System status</h1>
          <p className="text-sm text-gray-500">
            Aggregate: <span className="font-medium">{agg.status}</span> · {agg.ok} ok · {agg.warned} warn ·{' '}
            {agg.failed} failed
          </p>
        </div>
        <div className="text-xs text-gray-500">
          {process.env.RAILWAY_PROJECT_NAME ?? 'local'} /{' '}
          {process.env.RAILWAY_ENVIRONMENT ?? 'dev'}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-2 text-left">Check</th>
              <th className="px-4 py-2 text-left">Status</th>
              <th className="px-4 py-2 text-left">Detail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {checks.map((c) => (
              <tr key={c.name}>
                <td className="px-4 py-2 font-mono text-gray-700">{c.name}</td>
                <td className="px-4 py-2">{statusPill(c.status)}</td>
                <td className="px-4 py-2 text-gray-600">{c.detail ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-gray-500">
        Generated at {new Date().toISOString()}. Reload the page to re-run all checks.
      </p>
    </div>
  );
}
