'use client';

/**
 * /realnex — RealNex mirror sync control + live status (P3.4).
 *
 * READ-ONLY sync: pulls RealNex (companies, contacts, groups) into our Postgres mirror and
 * materializes the contact->company link via the inversion walk. Writes NOTHING back to
 * RealNex. This page is how the first manual sync is triggered (the "Run sync" button POSTs
 * /api/realnex/sync) and how its progress — including rate_limit_hits, the concurrency
 * tuning signal — is watched live.
 *
 * The P3.5 read UIs (Companies / Contacts) will build on the mirror this populates.
 */

import { Suspense, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRealnexSyncStatus, type RealnexSyncJob } from '@/lib/hooks/useRealnexSyncStatus';

function fmtInt(n: number | null | undefined): string {
  return typeof n === 'number' ? n.toLocaleString('en-US') : '—';
}

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function fmtDateTime(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString('en-US');
}

const PHASE_LABEL: Record<string, string> = {
  companies: 'Companies',
  contacts: 'Contacts',
  groups: 'Groups',
  linking: 'Linking (inversion walk)',
};

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded border px-3 py-2 ${highlight ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-white'}`}>
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold tabular-nums ${highlight ? 'text-amber-800' : 'text-gray-900'}`}>
        {value}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: RealnexSyncJob['status'] }) {
  const map: Record<RealnexSyncJob['status'], string> = {
    queued: 'bg-gray-100 text-gray-700 border-gray-200',
    running: 'bg-blue-50 text-blue-800 border-blue-200',
    completed: 'bg-green-50 text-green-800 border-green-200',
    failed: 'bg-red-50 text-red-800 border-red-200',
  };
  return (
    <span className={`rounded border px-2 py-0.5 text-xs font-medium uppercase tracking-wide ${map[status]}`}>
      {status}
    </span>
  );
}

function RealnexSyncInner() {
  const queryClient = useQueryClient();
  const { job, isLoading } = useRealnexSyncStatus({ enabled: true });

  const [kicking, setKicking] = useState(false);
  const [kickErr, setKickErr] = useState<string | null>(null);

  // 1s tick so the elapsed clock advances while a job runs.
  const [, setTick] = useState(0);
  const isActive = job?.status === 'queued' || job?.status === 'running';
  useEffect(() => {
    if (!isActive) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [isActive]);

  async function runSync(force = false) {
    setKickErr(null);
    setKicking(true);
    try {
      const res = await fetch(`/api/realnex/sync${force ? '?force=true' : ''}`, { method: 'POST' });
      if (res.status === 401) {
        setKickErr('Not signed in.');
        return;
      }
      if (res.status === 412) {
        const d = await res.json().catch(() => ({}));
        setKickErr(d.message || 'RealNex is not configured (REALNEX_API_KEY missing).');
        return;
      }
      if (res.status === 409) {
        // A job is already active — nothing to do but poll it.
        await queryClient.invalidateQueries({ queryKey: ['realnex', 'sync', 'status'] });
        return;
      }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setKickErr(d.message || d.error || `Failed to start sync: ${res.status}`);
        return;
      }
      // 202 accepted.
      await queryClient.invalidateQueries({ queryKey: ['realnex', 'sync', 'status'] });
    } catch (e) {
      setKickErr(e instanceof Error ? e.message : 'kickoff failed');
    } finally {
      setKicking(false);
    }
  }

  const elapsedMs = job && isActive ? Date.now() - new Date(job.startedAt).getTime() : 0;
  const skippedCount =
    job?.metadata && typeof job.metadata === 'object' && 'skippedCount' in job.metadata
      ? Number((job.metadata as Record<string, unknown>).skippedCount)
      : 0;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-1 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">RealNex Sync</h1>
          <p className="mt-0.5 text-xs text-gray-500">
            Read-only mirror of RealNex (companies, contacts, groups) into Postgres, plus the
            contact&rarr;company inversion walk. Writes nothing back to RealNex.
          </p>
        </div>
        <button
          type="button"
          onClick={() => runSync(false)}
          disabled={isActive || kicking}
          className="inline-flex shrink-0 items-center gap-1.5 rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          title="Start a read-only RealNex -> Postgres mirror sync"
        >
          {isActive ? 'Sync running…' : kicking ? 'Starting…' : 'Run sync'}
        </button>
      </div>

      {kickErr && (
        <div className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {kickErr}
        </div>
      )}

      {isLoading && !job && (
        <div className="mt-6 rounded border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-500">
          Loading sync status…
        </div>
      )}

      {!isLoading && !job && (
        <div className="mt-6 rounded border border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-gray-600">
          No sync has run yet. Click <span className="font-medium">Run sync</span> to populate the
          mirror for the first time.
        </div>
      )}

      {job && (
        <div className="mt-6 rounded-lg border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <StatusPill status={job.status} />
              {isActive && job.currentPhase && (
                <span className="text-sm text-gray-600">
                  Phase: <span className="font-medium text-gray-900">{PHASE_LABEL[job.currentPhase] ?? job.currentPhase}</span>
                </span>
              )}
            </div>
            <div className="text-right text-xs text-gray-500">
              <div>Triggered by {job.triggeredBy}</div>
              <div>
                {isActive ? (
                  <>Elapsed <span className="font-mono">{fmtElapsed(elapsedMs)}</span></>
                ) : (
                  <>Finished {fmtDateTime(job.completedAt)}</>
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric
              label="Companies"
              value={job.totalCompanies ? `${fmtInt(job.companiesSynced)} / ${fmtInt(job.totalCompanies)}` : fmtInt(job.companiesSynced)}
            />
            <Metric
              label="Contacts"
              value={job.totalContacts ? `${fmtInt(job.contactsSynced)} / ${fmtInt(job.totalContacts)}` : fmtInt(job.contactsSynced)}
            />
            <Metric label="Groups" value={fmtInt(job.groupsSynced)} />
            <Metric label="Links resolved" value={fmtInt(job.linksResolved)} />
            <Metric label="API calls" value={fmtInt(job.apiCallsMade)} />
            <Metric label="Rate-limit hits (429)" value={fmtInt(job.rateLimitHits)} highlight={job.rateLimitHits > 0} />
            <Metric label="Skipped companies" value={fmtInt(skippedCount)} highlight={skippedCount > 0} />
            <Metric label="Started" value={fmtDateTime(job.startedAt)} />
          </div>

          {job.status === 'completed' && (
            <div className="mt-4 rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">
              Sync completed.{' '}
              {skippedCount > 0
                ? `${fmtInt(skippedCount)} company(ies) were skipped after retries (recorded in job metadata) — re-run to retry them.`
                : 'All companies linked cleanly.'}
            </div>
          )}
          {job.status === 'failed' && (
            <div className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              <div className="font-medium">Sync failed.</div>
              {job.errorMessage && <div className="mt-0.5 font-mono text-xs">{job.errorMessage}</div>}
              <button
                type="button"
                onClick={() => runSync(true)}
                disabled={kicking}
                className="mt-2 rounded border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                Retry (force)
              </button>
            </div>
          )}
          {job.status === 'running' && job.rateLimitHits > 0 && (
            <div className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Seeing 429s (rate-limit hits). If this climbs, lower{' '}
              <code className="font-mono">REALNEX_SYNC_CONCURRENCY</code> in Railway and re-kick — no
              redeploy needed (that would kill this worker).
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function RealnexSyncPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-gray-500">Loading…</div>}>
      <RealnexSyncInner />
    </Suspense>
  );
}
