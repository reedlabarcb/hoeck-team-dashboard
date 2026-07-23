'use client';

/**
 * /contacts — RealNex contacts list, read from the local mirror (P3.5.3). Sibling of
 * /companies: same React Query cadence (60s poll + refetch-on-focus), same badges/banner,
 * same table conventions.
 *
 * Display name comes from full_name → "first last" → "(no name)" (contactDisplayName) — the
 * user never sees a raw key. Each row links to its company on /companies (by name search,
 * since detail views are deferred); the ~101 contacts with no resolved company_key show
 * "(no company)" and render no link — no broken href, no error.
 *
 * Two filters beyond search: by company (exact company_key, options = companies that actually
 * have contacts) and by group (the contact's own object_groups membership, matched by name).
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LastUpdated } from '@/components/LastUpdated';
import { LastSyncedBadge } from '@/components/LastSyncedBadge';
import { ConnectRealNexBanner } from '@/components/ConnectRealNexBanner';
import { RealNexEntitySearch } from '@/components/RealNexEntitySearch';
import { useRealnexSyncStatus } from '@/lib/hooks/useRealnexSyncStatus';
import { ContactRow, type ContactRowData } from '@/components/ContactRow';
import { AddContact } from '@/components/AddContact';

interface ContactsResponse { contacts: ContactRowData[]; total: number }
interface GroupsResponse { groups: { key: string; name: string | null }[] }

async function fetchContacts(q: string, companyKey: string, group: string): Promise<ContactsResponse> {
  const p = new URLSearchParams();
  if (q) p.set('q', q);
  if (companyKey) p.set('companyKey', companyKey);
  if (group) p.set('group', group);
  p.set('limit', '100');
  const res = await fetch(`/api/realnex/contacts?${p.toString()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Contacts fetch failed: ${res.status}`);
  return res.json();
}
async function fetchGroups(): Promise<GroupsResponse> {
  const res = await fetch('/api/realnex/groups', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Groups fetch failed: ${res.status}`);
  return res.json();
}

export default function ContactsPage() {
  const [q, setQ] = useState('');
  const [companyKey, setCompanyKey] = useState('');
  const [group, setGroup] = useState('');
  const { job, isLoading: syncLoading } = useRealnexSyncStatus({ enabled: true });

  // Deep-link support (e.g. the Log Note success "View [name]" link → /contacts?q=<name>). Read
  // once for the search typeahead's initialQuery; SSR-guarded so it's only a prop, never rendered.
  const [initialQ] = useState(() =>
    typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('q') ?? '',
  );

  const contacts = useQuery({
    queryKey: ['realnex', 'contacts', { q, companyKey, group }],
    queryFn: () => fetchContacts(q, companyKey, group),
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
  const rows = contacts.data?.contacts ?? [];
  const total = contacts.data?.total ?? 0;
  const truncated = total > rows.length;

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Contacts</h1>
          <p className="mt-0.5 text-xs text-gray-500">
            {contacts.data ? `${total.toLocaleString()} contacts` : 'RealNex contacts'} &middot; from the local mirror
          </p>
        </div>
        <div className="flex items-start gap-3">
          <AddContact />
          <div className="flex flex-col items-end gap-1">
            <LastSyncedBadge />
            <LastUpdated query={contacts} />
          </div>
        </div>
      </div>

      {noSyncYet ? (
        <ConnectRealNexBanner />
      ) : (
        <>
          <div className="mb-3 flex gap-2">
            <RealNexEntitySearch
              type="contact"
              placeholder="Search contacts by name or email…"
              initialQuery={initialQ}
              onQueryChange={setQ}
              onSelect={(e) => setQ(e.displayName)}
              className="flex-1"
            />
            <RealNexEntitySearch
              type="company"
              placeholder="Filter by company…"
              onSelect={(e) => setCompanyKey(e.key)}
              onClear={() => setCompanyKey('')}
              className="w-56 shrink-0"
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

          {contacts.isLoading ? (
            <div className="p-6 text-sm text-gray-500">Loading contacts…</div>
          ) : contacts.isError ? (
            <div className="p-6 text-sm text-red-700">Failed to load contacts.</div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-sm text-gray-500">
              {q || companyKey || group ? 'No contacts match your search.' : 'No contacts in the mirror yet.'}
            </div>
          ) : (
            <>
              <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-3 py-2 text-left">Name</th>
                      <th className="px-3 py-2 text-left">Title</th>
                      <th className="px-3 py-2 text-left">Company</th>
                      <th className="px-3 py-2 text-right">SF</th>
                      <th className="px-3 py-2 text-left">Lease Exp</th>
                      <th className="px-3 py-2 text-left">Email</th>
                      <th className="px-3 py-2 text-left">Phone</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {rows.map((c) => (
                      <ContactRow key={c.key} contact={c} />
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
