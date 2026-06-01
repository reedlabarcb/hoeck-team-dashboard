'use client';

/**
 * /master-excel — critical-date lookup against the TT Rep Master Client List.
 *
 * Data sources:
 *   - /api/master-excel/all      → market dropdown population (only real markets)
 *   - /api/master-excel/lookup   → search results
 *   - /api/master-excel/cross-check → "open the underlying lease in Box" button
 *
 * UI flow:
 *   1. User types client name → debounced lookup → render result card or
 *      disambiguation list when multiple matches.
 *   2. User can narrow with market dropdown (populated from /all).
 *   3. Each date renders with a relative-time tooltip ("in 4 months").
 *   4. "Cross-check vs. lease PDF" button → cross-check endpoint → opens
 *      the best-match file in Box (new tab).
 *
 * Auth enforced by the edge proxy.
 */

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LastUpdated } from '@/components/LastUpdated';
import { ConnectBoxBanner } from '@/components/ConnectBoxBanner';
import type {
  MasterExcelAllRowsResult,
  MasterExcelLookupResult,
  MasterExcelRow,
} from '@/lib/external/master-excel/types';

interface CrossCheckMatch {
  match: true;
  file: { boxId: string; name: string; url: string; path: string[]; modifiedAt: string | null; sizeBytes: number | null; executed: boolean };
  dealFolder: { boxId: string; name: string; url: string; path: string[] };
}
interface CrossCheckNoMatch {
  match: false;
  reason: string;
  message: string;
  candidates: { kind: string; boxId: string; name: string; url: string; path: string[] }[];
}
type CrossCheckResponse = CrossCheckMatch | CrossCheckNoMatch;

async function fetchAll(): Promise<MasterExcelAllRowsResult | { boxNotConnected: true }> {
  const res = await fetch('/api/master-excel/all', { cache: 'no-store' });
  if (res.status === 412) {
    return { boxNotConnected: true };
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || `Failed: ${res.status}`);
  }
  return res.json();
}

async function fetchLookup(client: string, market: string | undefined): Promise<MasterExcelLookupResult> {
  const params = new URLSearchParams({ client });
  if (market) params.set('market', market);
  const res = await fetch(`/api/master-excel/lookup?${params.toString()}`, { cache: 'no-store' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || `Lookup failed: ${res.status}`);
  }
  return res.json();
}

async function fetchCrossCheck(client: string, address: string | null): Promise<CrossCheckResponse> {
  const params = new URLSearchParams({ client });
  if (address) params.set('address', address);
  const res = await fetch(`/api/master-excel/cross-check?${params.toString()}`, { cache: 'no-store' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || `Cross-check failed: ${res.status}`);
  }
  return res.json();
}

function formatDate(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function relativeTime(s: string | null): string {
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  const diffMs = d.getTime() - Date.now();
  const days = Math.round(diffMs / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (Math.abs(days) < 60) return days > 0 ? `in ${days} days` : `${-days} days ago`;
  const months = Math.round(days / 30);
  if (Math.abs(months) < 24) return months > 0 ? `in ${months} months` : `${-months} months ago`;
  const years = Math.round(days / 365);
  return years > 0 ? `in ${years} years` : `${-years} years ago`;
}

function DateCell({ label, value }: { label: string; value: string | null }) {
  const rel = relativeTime(value);
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-0.5 text-sm font-medium text-gray-900" title={rel || undefined}>
        {formatDate(value)}
      </div>
      {rel && <div className="text-xs text-gray-500">{rel}</div>}
    </div>
  );
}

function ResultCard({
  row,
  onCrossCheck,
}: {
  row: MasterExcelRow;
  onCrossCheck: () => void;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            {row.client}
            {row.market && (
              <span className="ml-2 rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-900 border border-blue-200">
                {row.market}
              </span>
            )}
          </h2>
          <p className="mt-1 text-sm text-gray-600">{row.address ?? <span className="italic text-gray-400">No address on file</span>}</p>
          {row.spaceSf && (
            <p className="mt-0.5 text-xs text-gray-500">{row.spaceSf.toLocaleString()} SF</p>
          )}
        </div>
        <button
          type="button"
          onClick={onCrossCheck}
          className="shrink-0 rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          title="Find the underlying lease PDF in Box"
        >
          Cross-check vs. lease PDF ↗
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <DateCell label="Lease Expiration" value={row.leaseExpiration} />
        <DateCell label="Renewal Window Start" value={row.renewalWindowStart} />
        <DateCell label="Renewal Window End" value={row.renewalWindowEnd} />
        <DateCell label="Renewal Deadline" value={row.renewalDeadline} />
        <DateCell label="Termination Deadline" value={row.terminationDeadline} />
      </div>

      {row.notes && (
        <div className="mt-4 rounded bg-gray-50 px-3 py-2 text-xs text-gray-700">
          <span className="font-medium text-gray-900">Notes:</span> {row.notes}
        </div>
      )}

      <div className="mt-3 text-[11px] text-gray-400">
        Source row {row.sourceRow ?? '?'} in the xlsx.
      </div>
    </div>
  );
}

function CrossCheckBanner({ result }: { result: CrossCheckResponse }) {
  if (result.match) {
    return (
      <div className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">
        Opened latest lease PDF in Box:{' '}
        <a className="font-medium underline" href={result.file.url} target="_blank" rel="noopener noreferrer">
          {result.file.name}
        </a>
        {result.file.executed && (
          <span className="ml-2 rounded bg-green-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
            executed
          </span>
        )}
      </div>
    );
  }
  return (
    <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <div className="font-medium">Auto-find didn&apos;t resolve a lease PDF.</div>
      <div className="mt-0.5 text-xs">{result.message}</div>
      {result.candidates.length > 0 && (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs">
          {result.candidates.slice(0, 5).map((c) => (
            <li key={c.boxId}>
              <a className="underline" href={c.url} target="_blank" rel="noopener noreferrer">
                {c.name}
              </a>{' '}
              <span className="text-amber-700">({c.kind})</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MasterExcelInner() {
  const [client, setClient] = useState('');
  const [market, setMarket] = useState<string>('');
  const [crossCheck, setCrossCheck] = useState<CrossCheckResponse | null>(null);
  const [crossCheckErr, setCrossCheckErr] = useState<string | null>(null);

  // Debounce typed input → query string we actually send to the server.
  const [debouncedClient, setDebouncedClient] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedClient(client.trim()), 250);
    return () => clearTimeout(t);
  }, [client]);

  const allQuery = useQuery({
    queryKey: ['master-excel', 'all'],
    queryFn: fetchAll,
  });

  const lookupQuery = useQuery({
    queryKey: ['master-excel', 'lookup', debouncedClient, market],
    queryFn: () => fetchLookup(debouncedClient, market || undefined),
    enabled: debouncedClient.length >= 2,
  });

  const markets = useMemo(() => {
    if (!allQuery.data || 'boxNotConnected' in allQuery.data) return [] as string[];
    const set = new Set<string>();
    for (const r of allQuery.data.rows) if (r.market) set.add(r.market);
    return Array.from(set).sort();
  }, [allQuery.data]);

  if (allQuery.data && 'boxNotConnected' in allQuery.data) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Master Excel</h1>
        <p className="mt-1 text-sm text-gray-500">
          Critical-date lookups against{' '}
          <code className="text-xs">TT Rep Master Client List.xlsx</code>.
        </p>
        <div className="mt-6">
          <ConnectBoxBanner redirectAfter="/master-excel" />
        </div>
      </div>
    );
  }

  async function runCrossCheck(row: MasterExcelRow) {
    setCrossCheck(null);
    setCrossCheckErr(null);
    try {
      const r = await fetchCrossCheck(row.client ?? '', row.address);
      setCrossCheck(r);
      if (r.match) {
        window.open(r.file.url, '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      setCrossCheckErr(err instanceof Error ? err.message : 'cross-check failed');
    }
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Master Excel</h1>
          <p className="mt-0.5 text-xs text-gray-500">
            Critical-date lookups from <code className="text-xs">TT Rep Master Client List.xlsx</code>.
            {allQuery.data && !('boxNotConnected' in allQuery.data) && (
              <>
                {' · '}
                <span className="font-mono">{allQuery.data.source.fileName ?? '(unknown file)'}</span>
                {' · '}
                {allQuery.data.source.cacheHit ? 'cached' : 'fresh from Box'}
              </>
            )}
          </p>
        </div>
        <LastUpdated query={lookupQuery} />
      </div>

      {/* Search + market */}
      <div className="mb-4 flex gap-3">
        <input
          type="search"
          placeholder="Client name (try: Procopio)…"
          value={client}
          onChange={(e) => setClient(e.target.value)}
          className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500 focus:border-gray-500 focus:outline-none"
        />
        <select
          value={market}
          onChange={(e) => setMarket(e.target.value)}
          className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
          aria-label="Filter by market"
        >
          <option value="">All markets</option>
          {markets.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      {/* Cross-check status banner */}
      {crossCheckErr && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          Cross-check failed: {crossCheckErr}
        </div>
      )}
      {crossCheck && <div className="mb-3">{<CrossCheckBanner result={crossCheck} />}</div>}

      {/* Empty + loading + error states */}
      {debouncedClient.length < 2 && (
        <div className="rounded border border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-gray-600">
          Type a client name (2+ characters) to look up critical dates.
        </div>
      )}
      {debouncedClient.length >= 2 && lookupQuery.isLoading && (
        <div className="rounded border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-500">
          Looking up <span className="font-mono">{debouncedClient}</span>…
        </div>
      )}
      {lookupQuery.isError && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          Lookup failed: {(lookupQuery.error as Error).message}
        </div>
      )}

      {lookupQuery.data && lookupQuery.data.matchCount === 0 && (
        <div className="rounded border border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-gray-600">
          No matches for <span className="font-mono">{debouncedClient}</span>
          {market && (
            <>
              {' '}
              in market <span className="font-mono">{market}</span>
            </>
          )}
          .
          <div className="mt-1 text-xs text-gray-500">
            Try a shorter prefix, or check the All markets dropdown.
          </div>
        </div>
      )}

      {/* Disambiguation list */}
      {lookupQuery.data && lookupQuery.data.multipleMatches && (
        <div className="mb-3 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
          {lookupQuery.data.matchCount} matches — pick one to view dates (or narrow with the
          market filter above).
        </div>
      )}

      {/* Results */}
      {lookupQuery.data && lookupQuery.data.matchCount > 0 && (
        <div className="space-y-3">
          {lookupQuery.data.rows.map((row, i) => (
            <ResultCard key={`${row.client}-${row.market}-${row.sourceRow}-${i}`} row={row} onCrossCheck={() => runCrossCheck(row)} />
          ))}
        </div>
      )}

      {/* Warnings */}
      {lookupQuery.data?.warnings && lookupQuery.data.warnings.length > 0 && (
        <div className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <div className="font-medium">Parser warnings:</div>
          <ul className="mt-1 list-disc pl-5">
            {lookupQuery.data.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function MasterExcelPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-gray-500">Loading…</div>}>
      <MasterExcelInner />
    </Suspense>
  );
}
