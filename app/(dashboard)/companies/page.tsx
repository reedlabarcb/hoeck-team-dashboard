'use client';

/**
 * /companies — RealNex companies list, read from the local mirror (P3.5.2).
 *
 * Reads GET /api/realnex/companies (search + group filter) and GET /api/realnex/groups
 * (filter dropdown). React Query with 60s poll + refetch-on-focus. Company NAME comes from
 * RealNex's OrganizationId field but is stored/served as company_name — the user only ever
 * sees the real name ("Full Swing Golf"), never a GUID or the "OrganizationId" label.
 *
 * <ConnectRealNexBanner> shows if no sync has run yet (mirror empty / key missing).
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LastUpdated } from '@/components/LastUpdated';
import { LastSyncedBadge } from '@/components/LastSyncedBadge';
import { ConnectRealNexBanner } from '@/components/ConnectRealNexBanner';
import { RealNexEntitySearch } from '@/components/RealNexEntitySearch';
import { useRealnexSyncStatus } from '@/lib/hooks/useRealnexSyncStatus';

interface CompanyRow {
  key: string;
  name: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  tenant: boolean | null;
  prospect: boolean | null;
}
interface CompaniesResponse { companies: CompanyRow[]; total: number }
interface GroupsResponse { groups: { key: string; name: string | null }[] }

async function fetchCompanies(q: string, group: string): Promise<CompaniesResponse> {
  const p = new URLSearchParams();
  if (q) p.set('q', q);
  if (group) p.set('group', group);
  p.set('limit', '100');
  const res = await fetch(`/api/realnex/companies?${p.toString()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Companies fetch failed: ${res.status}`);
  return res.json();
}
async function fetchGroups(): Promise<GroupsResponse> {
  const res = await fetch('/api/realnex/groups', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Groups fetch failed: ${res.status}`);
  return res.json();
}

function fmtLocation(c: CompanyRow): string {
  return [c.city, c.state].filter(Boolean).join(', ');
}
function normalizeWebsite(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

export default function CompaniesPage() {
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('');
  const { job, isLoading: syncLoading } = useRealnexSyncStatus({ enabled: true });

  // Deep-link support: a contact's company link on /contacts lands here as /companies?q=<name>.
  // Read once for the typeahead's initialQuery (it seeds via an effect, so no hydration
  // mismatch). SSR-guarded; the value is only passed as a prop, never rendered by this page.
  const [initialQ] = useState(() =>
    typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('q') ?? '',
  );

  const companies = useQuery({
    queryKey: ['realnex', 'companies', { q, group }],
    queryFn: () => fetchCompanies(q, group),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const groups = useQuery({
    queryKey: ['realnex', 'groups'],
    queryFn: fetchGroups,
    staleTime: 5 * 60_000,
  });

  // Banner only once we KNOW no sync has run (avoid flashing it before status loads).
  const noSyncYet = !syncLoading && job === null;
  const rows = companies.data?.companies ?? [];
  const total = companies.data?.total ?? 0;
  const truncated = total > rows.length;

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Companies</h1>
          <p className="mt-0.5 text-xs text-gray-500">
            {companies.data ? `${total.toLocaleString()} companies` : 'RealNex companies'} &middot; from the local mirror
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <LastSyncedBadge />
          <LastUpdated query={companies} />
        </div>
      </div>

      {noSyncYet ? (
        <ConnectRealNexBanner />
      ) : (
        <>
          <div className="mb-3 flex gap-2">
            <RealNexEntitySearch
              type="company"
              placeholder="Search companies by name…"
              initialQuery={initialQ}
              onQueryChange={setQ}
              onSelect={(e) => setQ(e.displayName)}
              className="flex-1"
            />
            <select
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
              aria-label="Filter by group"
            >
              <option value="">All groups</option>
              {groups.data?.groups.filter((g) => g.name).map((g) => (
                <option key={g.key} value={g.name as string}>{g.name}</option>
              ))}
            </select>
          </div>

          {companies.isLoading ? (
            <div className="p-6 text-sm text-gray-500">Loading companies…</div>
          ) : companies.isError ? (
            <div className="p-6 text-sm text-red-700">Failed to load companies.</div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-sm text-gray-500">
              {q || group ? 'No companies match your search.' : 'No companies in the mirror yet.'}
            </div>
          ) : (
            <>
              <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-3 py-2 text-left">Company</th>
                      <th className="px-3 py-2 text-left">Location</th>
                      <th className="px-3 py-2 text-left">Phone</th>
                      <th className="px-3 py-2 text-left">Email</th>
                      <th className="px-3 py-2 text-right">Website</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {rows.map((c) => (
                      <tr key={c.key} className="hover:bg-gray-50">
                        <td className="px-3 py-2">
                          <span className={c.name ? 'text-gray-900' : 'italic text-gray-400'}>
                            {c.name || '(unnamed)'}
                          </span>
                          {c.tenant && (
                            <span className="ml-2 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-900">Tenant</span>
                          )}
                          {c.prospect && (
                            <span className="ml-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-900">Prospect</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-600">{fmtLocation(c)}</td>
                        <td className="px-3 py-2 text-gray-600">{c.phone}</td>
                        <td className="px-3 py-2 text-gray-600">
                          {c.email ? <a href={`mailto:${c.email}`} className="text-blue-700 hover:underline">{c.email}</a> : null}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {c.website ? (
                            <a href={normalizeWebsite(c.website)} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-700 hover:underline">site ↗</a>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {truncated && (
                <p className="mt-2 text-xs text-gray-500">
                  Showing first {rows.length} of {total.toLocaleString()} — search or filter to narrow.
                </p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
