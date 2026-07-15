'use client';

/**
 * /query — "Master Query" (P3.11 / Workflow 4). One place to slice the mirror by stackable AND
 * filters, view the results, and (Step 3) export them. Reads GET /api/realnex/query (→ runQuery).
 * READ-ONLY. All filter state lives in one `filters` object; the chips above the table are the
 * single source of truth for what's applied.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { contactDisplayName, detailPath, formatLeaseExpiry, formatSqFt } from '@/lib/realnex/format';
import {
  QUERY_FLAGS,
  emptyFilters,
  filtersToParams,
  filtersToChips,
  clearChip,
  leaseWindow,
  type QueryEntity,
  type QueryFilters,
  type QueryFlag,
} from '@/lib/realnex/query-filters';

type Row = Record<string, unknown> & { key: string };
interface QueryResponse { rows: Row[]; total: number; entity: QueryEntity }
interface GroupsResponse { groups: { key: string; name: string | null }[] }

async function fetchQueryResults(filters: QueryFilters): Promise<QueryResponse> {
  const res = await fetch(`/api/realnex/query?${filtersToParams(filters).toString()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Query failed: ${res.status}`);
  return res.json();
}
async function fetchGroups(): Promise<GroupsResponse> {
  const res = await fetch('/api/realnex/groups', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Groups fetch failed: ${res.status}`);
  return res.json();
}

const INPUT = 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm text-gray-900 placeholder:text-gray-500 focus:border-gray-500 focus:outline-none';
const LABEL = 'mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500';

/** City/state per entity: companies have flat columns; contacts read the address jsonb (PascalCase). */
function locationOf(row: Row, entity: QueryEntity): string {
  if (entity === 'companies') return [row.city, row.state].filter(Boolean).join(', ');
  const a = (row.address ?? {}) as Record<string, unknown>;
  return [a.City, a.State].filter(Boolean).join(', '); // contacts: PascalCase jsonb keys
}
function groupsOf(row: Row): string {
  const gs = Array.isArray(row.objectGroups) ? (row.objectGroups as Array<Record<string, unknown>>) : [];
  return gs.map((g) => (typeof g?.Name === 'string' ? g.Name : null)).filter(Boolean).join(', '); // PascalCase Name
}

function FlagBadges({ row }: { row: Row }) {
  const on = QUERY_FLAGS.filter((f) => row[f.key]);
  if (!on.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {on.map((f) => (
        <span key={f.key} className="rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-900">
          {f.label}
        </span>
      ))}
    </span>
  );
}

export default function MasterQueryPage() {
  const [filters, setFilters] = useState<QueryFilters>(() => emptyFilters('companies'));
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const results = useQuery({
    queryKey: ['realnex', 'query', filters],
    queryFn: () => fetchQueryResults(filters),
    refetchOnWindowFocus: false,
  });
  const groups = useQuery({ queryKey: ['realnex', 'groups'], queryFn: fetchGroups, staleTime: 5 * 60_000 });

  const set = (patch: Partial<QueryFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const setEntity = (entity: QueryEntity) => setFilters((f) => ({ ...f, entity })); // filters carry over (all apply to both)
  const toggleFlag = (flag: QueryFlag) =>
    setFilters((f) => {
      const next = new Set(f.flags ?? []);
      if (next.has(flag)) next.delete(flag);
      else next.add(flag);
      const arr = [...next];
      return { ...f, flags: arr.length ? arr : undefined };
    });
  const applyPreset = (months: number) => set(leaseWindow(months, new Date()));

  // Export the CURRENT filtered set — same filters as the view, so what you see is what you export.
  async function onExport() {
    setExporting(true);
    setExportError('');
    try {
      const res = await fetch(`/api/realnex/query/export?${filtersToParams(filters).toString()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') ?? '';
      const filename = cd.match(/filename="(.+?)"/)?.[1] ?? `master-query-${filters.entity}.xlsx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setExportError('Export failed — please try again.');
    } finally {
      setExporting(false);
    }
  }

  const chips = filtersToChips(filters);
  const rows = results.data?.rows ?? [];
  const total = results.data?.total ?? 0;
  // Render columns for the entity the CURRENT ROWS belong to (avoids a flash during a pending switch).
  const entity: QueryEntity = results.data?.entity ?? filters.entity;
  const truncated = total > rows.length;

  return (
    <div className="mx-auto max-w-7xl p-6">
      <h1 className="text-2xl font-semibold text-gray-900">Master Query</h1>
      <p className="mt-0.5 text-xs text-gray-500">Slice the mirror by stackable filters, then export what&apos;s filtered.</p>

      <div className="mt-4 flex gap-6">
        {/* ---------- FILTER PANEL ---------- */}
        <aside className="w-64 shrink-0 space-y-4">
          <div className="flex rounded border border-gray-300 p-0.5 text-sm">
            {(['companies', 'contacts'] as const).map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setEntity(e)}
                className={`flex-1 rounded px-2 py-1 font-medium ${filters.entity === e ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'}`}
              >
                {e === 'companies' ? 'Companies' : 'Contacts'}
              </button>
            ))}
          </div>

          <div>
            <label className={LABEL}>Search</label>
            <input
              className={INPUT}
              value={filters.q ?? ''}
              onChange={(e) => set({ q: e.target.value || undefined })}
              placeholder={filters.entity === 'companies' ? 'Company name…' : 'Name or email…'}
            />
          </div>

          <div>
            <label className={LABEL}>Lease expiration</label>
            <div className="flex gap-1">
              {[6, 12, 24].map((m) => (
                <button key={m} type="button" onClick={() => applyPreset(m)} className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50">
                  {m}mo
                </button>
              ))}
            </div>
            <div className="mt-1 flex items-center gap-1">
              <input type="date" className={INPUT} aria-label="Lease from" value={filters.lxdFrom ?? ''} onChange={(e) => set({ lxdFrom: e.target.value || undefined })} />
              <span className="text-xs text-gray-400">→</span>
              <input type="date" className={INPUT} aria-label="Lease to" value={filters.lxdTo ?? ''} onChange={(e) => set({ lxdTo: e.target.value || undefined })} />
            </div>
          </div>

          <div>
            <label className={LABEL}>Square footage</label>
            <div className="flex items-center gap-1">
              <input type="number" className={INPUT} aria-label="SF min" placeholder="Min" value={filters.sfMin ?? ''} onChange={(e) => set({ sfMin: e.target.value === '' ? undefined : Number(e.target.value) })} />
              <span className="text-xs text-gray-400">–</span>
              <input type="number" className={INPUT} aria-label="SF max" placeholder="Max" value={filters.sfMax ?? ''} onChange={(e) => set({ sfMax: e.target.value === '' ? undefined : Number(e.target.value) })} />
            </div>
          </div>

          <div>
            <label className={LABEL}>Location</label>
            <input className={INPUT} placeholder="City" value={filters.city ?? ''} onChange={(e) => set({ city: e.target.value || undefined })} />
            <input className={`${INPUT} mt-1`} placeholder="State" value={filters.state ?? ''} onChange={(e) => set({ state: e.target.value || undefined })} />
            <input className={`${INPUT} mt-1`} placeholder="Address contains…" value={filters.address ?? ''} onChange={(e) => set({ address: e.target.value || undefined })} />
          </div>

          <div>
            <label className={LABEL}>Type</label>
            <div className="space-y-1">
              {QUERY_FLAGS.map((f) => (
                <label key={f.key} className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={filters.flags?.includes(f.key) ?? false} onChange={() => toggleFlag(f.key)} />
                  {f.label}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className={LABEL}>Group</label>
            <select className={INPUT} aria-label="Filter by group" value={filters.group ?? ''} onChange={(e) => set({ group: e.target.value || undefined })}>
              <option value="">All groups</option>
              {groups.data?.groups.filter((g) => g.name).map((g) => (
                <option key={g.key} value={g.name as string}>{g.name}</option>
              ))}
            </select>
          </div>
        </aside>

        {/* ---------- RESULTS ---------- */}
        <section className="min-w-0 flex-1">
          <div className="mb-2 flex items-center justify-between gap-4">
            <p className="text-sm text-gray-600">
              {results.isLoading
                ? 'Running…'
                : truncated
                  ? `Showing first ${rows.length} of ${total.toLocaleString()} — filter to narrow, or Export for all`
                  : `${total.toLocaleString()} ${entity === 'companies' ? 'companies' : 'contacts'}`}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              {exportError && <span className="text-xs text-red-600">{exportError}</span>}
              <button
                type="button"
                onClick={onExport}
                disabled={exporting || results.isLoading || total === 0}
                title={total === 0 ? 'No records to export' : 'Download the current filtered set as Excel'}
                className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
              >
                {exporting ? 'Exporting…' : 'Export ▾'}
              </button>
            </div>
          </div>

          {chips.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              {chips.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setFilters((f) => clearChip(f, c.key))}
                  className="inline-flex items-center gap-1 rounded-full border border-gray-300 bg-gray-50 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-100"
                >
                  {c.label} <span aria-hidden>×</span>
                </button>
              ))}
              <button type="button" onClick={() => setFilters((f) => emptyFilters(f.entity))} className="ml-1 text-xs text-blue-700 hover:underline">
                Clear all
              </button>
            </div>
          )}

          {results.isError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">Failed to run the query.</div>
          ) : rows.length === 0 && !results.isLoading ? (
            <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-500">No records match these filters.</div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Name</th>
                    {entity === 'contacts' && <th className="px-3 py-2 text-left">Company</th>}
                    {entity === 'contacts' && <th className="px-3 py-2 text-left">Title</th>}
                    <th className="px-3 py-2 text-right">SF</th>
                    <th className="px-3 py-2 text-left">Lease Exp</th>
                    <th className="px-3 py-2 text-left">Location</th>
                    <th className="px-3 py-2 text-left">Groups</th>
                    <th className="px-3 py-2 text-left">Type</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((r) => {
                    const name = entity === 'companies' ? (r.name as string) || '(unnamed)' : contactDisplayName(r as never);
                    const href = detailPath({ type: entity === 'companies' ? 'company' : 'contact', key: r.key });
                    return (
                      <tr key={r.key} className="hover:bg-gray-50">
                        <td className="px-3 py-2">
                          <Link href={href} className="font-medium text-blue-700 hover:underline">{name}</Link>
                        </td>
                        {entity === 'contacts' && <td className="px-3 py-2 text-gray-600">{(r.companyName as string) || ''}</td>}
                        {entity === 'contacts' && <td className="px-3 py-2 text-gray-600">{(r.title as string) || ''}</td>}
                        <td className="px-3 py-2 text-right tabular-nums text-gray-600">{formatSqFt(r.sqFt as number | null)}</td>
                        <td className="px-3 py-2 tabular-nums text-gray-600">{formatLeaseExpiry(r.leaseExpiry as string | null)}</td>
                        <td className="px-3 py-2 text-gray-600">{locationOf(r, entity)}</td>
                        <td className="px-3 py-2 text-gray-600">{groupsOf(r)}</td>
                        <td className="px-3 py-2"><FlagBadges row={r} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
