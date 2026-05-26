'use client';

/**
 * /files — Box folder browser.
 *
 * Two states:
 *   1. User has no Box connection → show <ConnectBoxBanner /> + nothing else
 *   2. User is connected → show folder browser with breadcrumb + search + index data
 *
 * Data comes from box_folder_index (Postgres mirror), not from Box at click time.
 * For freshness: <LastUpdated /> + Refresh button which calls POST /api/box/reindex.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { LastUpdated } from '@/components/LastUpdated';
import { ConnectBoxBanner } from '@/components/ConnectBoxBanner';
import { BoxRefreshButton } from '@/components/BoxRefreshButton';

interface BoxFolderRow {
  id: string;
  boxId: string;
  boxType: 'file' | 'folder' | 'web_link';
  name: string;
  parentBoxId: string | null;
  depth: number;
  pathSegments: string[];
  boxModifiedAt: string | null;
  sizeBytes: number | null;
  webLinkUrl: string | null;
  isSubleaseShortcut: boolean;
  yearStart: number | null;
  yearEnd: number | null;
  dealType: 'Acquisition' | 'Disposition' | null;
  address: string | null;
  clientFolderName: string | null;
  isMtClient: boolean;
  marketSubfolder: string | null;
  lastSeenAt: string;
}

interface ConnectionState {
  connected: boolean;
  box_login?: string;
  refreshed_at?: string;
}

async function fetchConnection(): Promise<ConnectionState> {
  const res = await fetch('/api/box/connection', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Connection check failed: ${res.status}`);
  return res.json();
}

async function fetchFolders(opts: { parent?: string; q?: string }): Promise<BoxFolderRow[]> {
  const params = new URLSearchParams();
  if (opts.parent) params.set('parent', opts.parent);
  if (opts.q) params.set('q', opts.q);
  const res = await fetch(`/api/box/folders?${params.toString()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Folders fetch failed: ${res.status}`);
  const data = (await res.json()) as { entries: BoxFolderRow[] };
  return data.entries;
}

function fmtBytes(n: number | null): string {
  if (!n || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fmtDate(s: string | null): string {
  if (!s) return '';
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function boxUrl(row: BoxFolderRow): string {
  if (row.webLinkUrl) return row.webLinkUrl;
  if (row.boxType === 'folder') return `https://cbre.box.com/folder/${row.boxId}`;
  return `https://cbre.box.com/file/${row.boxId}`;
}

export default function FilesPage() {
  const queryClient = useQueryClient();
  const [parent, setParent] = useState<string | undefined>(undefined);
  const [breadcrumb, setBreadcrumb] = useState<{ boxId: string | undefined; name: string }[]>([
    { boxId: undefined, name: 'Tenants – ChapmanHoeck' },
  ]);
  const [query, setQuery] = useState('');

  const connection = useQuery({
    queryKey: ['box', 'connection'],
    queryFn: fetchConnection,
  });

  const folders = useQuery({
    queryKey: ['box', 'folders', { parent, q: query }],
    queryFn: () => fetchFolders({ parent, q: query || undefined }),
    enabled: connection.data?.connected === true,
  });

  // Cap a single reindex attempt at 5 min from the browser's perspective. The route's
  // own maxDuration is 300s; if it ever returns nothing within that window (proxy timeout,
  // crashed walker, etc.), the user shouldn't be stuck on an infinite spinner. AbortController
  // surfaces this as a TimeoutError the UI can show + offer to retry.
  const REINDEX_TIMEOUT_MS = 5 * 60 * 1000;
  const reindex = useMutation({
    mutationFn: async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REINDEX_TIMEOUT_MS);
      try {
        const res = await fetch('/api/box/reindex', {
          method: 'POST',
          signal: controller.signal,
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          if (res.status === 412 && data.error === 'box_not_connected') {
            throw new Error('Box not connected. Click "Connect Box" again.');
          }
          if (res.status === 412 && data.error === 'box_auth_expired') {
            throw new Error('Box session expired. Click "Connect Box" to reconnect.');
          }
          throw new Error(data.message || `Reindex failed: HTTP ${res.status}`);
        }
        return res.json();
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          throw new Error(
            'Walker timed out after 5 minutes. Check Activity Feed for details, then Retry.',
          );
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['box'] });
    },
  });

  if (connection.isLoading) {
    return <div className="p-8 text-sm text-gray-500">Loading…</div>;
  }

  if (!connection.data?.connected) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Files</h1>
        <p className="mt-1 text-sm text-gray-500">
          Browse <code className="text-xs">Tenants – ChapmanHoeck</code> from Box.
        </p>
        <div className="mt-6">
          <ConnectBoxBanner />
        </div>
      </div>
    );
  }

  function drillInto(row: BoxFolderRow) {
    if (row.boxType !== 'folder') {
      // Files / web links → open in Box (new tab).
      window.open(boxUrl(row), '_blank', 'noopener,noreferrer');
      return;
    }
    setParent(row.boxId);
    setBreadcrumb((b) => [...b, { boxId: row.boxId, name: row.name }]);
    setQuery('');
  }

  function navigateBreadcrumb(idx: number) {
    const target = breadcrumb[idx];
    setParent(target.boxId);
    setBreadcrumb((b) => b.slice(0, idx + 1));
    setQuery('');
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-gray-900">Files</h1>
          <p className="mt-0.5 text-xs text-gray-500">
            Connected as{' '}
            <span className="font-mono text-gray-700">{connection.data.box_login ?? '(box user)'}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <LastUpdated query={folders} />
          <BoxRefreshButton
            onClick={() => reindex.mutate()}
            disabled={reindex.isPending}
            isPending={reindex.isPending}
          />
        </div>
      </div>

      {/* Back button + Breadcrumb */}
      <div className="mb-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigateBreadcrumb(breadcrumb.length - 2)}
          disabled={breadcrumb.length <= 1}
          className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          title={breadcrumb.length <= 1 ? 'Already at the root folder' : `Back to ${breadcrumb[breadcrumb.length - 2]?.name}`}
          aria-label="Back one folder"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
        <nav className="flex items-center gap-1 text-sm text-gray-700">
          {breadcrumb.map((b, i) => (
            <span key={i} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => navigateBreadcrumb(i)}
                className="rounded px-1.5 py-0.5 hover:bg-gray-100"
              >
                {b.name}
              </button>
              {i < breadcrumb.length - 1 && <span className="text-gray-300">/</span>}
            </span>
          ))}
        </nav>
      </div>

      {/* Search */}
      <div className="mb-3">
        <input
          type="search"
          placeholder="Search across all indexed folders…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500 focus:border-gray-500 focus:outline-none"
        />
      </div>

      {/* Reindex error surface */}
      {reindex.isError && (
        <div className="mb-3 flex items-start justify-between gap-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <div className="min-w-0">
            <div className="font-medium">Refresh failed</div>
            <div className="mt-0.5 text-xs">{(reindex.error as Error).message}</div>
          </div>
          <button
            type="button"
            onClick={() => {
              reindex.reset();
              reindex.mutate();
            }}
            className="shrink-0 rounded border border-red-300 bg-white px-2 py-1 text-xs font-medium text-red-800 hover:bg-red-100"
          >
            Retry
          </button>
        </div>
      )}
      {reindex.isSuccess && reindex.data && (
        <div className="mb-3 rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          Indexed {reindex.data.indexedCount} items from{' '}
          <span className="font-mono">{reindex.data.rootFolderName}</span> in {reindex.data.durationMs}{' '}
          ms.
        </div>
      )}

      {/* Listing */}
      {folders.isLoading ? (
        <div className="p-6 text-sm text-gray-500">Loading folders…</div>
      ) : folders.isError ? (
        <div className="p-6 text-sm text-red-700">Failed to load folders.</div>
      ) : (folders.data?.length ?? 0) === 0 ? (
        <div className="p-6 text-sm text-gray-500">
          {query ? `No matches for "${query}"` : 'No items yet. Click "Refresh from Box" to index.'}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Convention</th>
                <th className="px-3 py-2 text-right">Modified</th>
                <th className="px-3 py-2 text-right">Size</th>
                <th className="px-3 py-2 text-right">Open</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {folders.data?.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => drillInto(row)}
                      className="flex items-center gap-2 text-left"
                    >
                      <span className="text-base">
                        {row.boxType === 'folder' ? '📁' : row.boxType === 'web_link' ? '🔗' : '📄'}
                      </span>
                      <span className="text-gray-900">{row.name}</span>
                      {row.isSubleaseShortcut && (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-900 border border-amber-200">
                          sublease shortcut
                        </span>
                      )}
                      {row.isMtClient && (
                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-900 border border-blue-200">
                          MT
                        </span>
                      )}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-600">
                    {row.dealType ? (
                      <span>
                        {row.yearStart}
                        {row.yearEnd ? `–${row.yearEnd}` : ''} {row.dealType}
                        {row.address ? ` · ${row.address}` : ''}
                      </span>
                    ) : row.clientFolderName && row.clientFolderName !== row.name ? (
                      <span className="text-gray-400">{row.clientFolderName}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right text-xs text-gray-500">
                    {fmtDate(row.boxModifiedAt)}
                  </td>
                  <td className="px-3 py-2 text-right text-xs text-gray-500">{fmtBytes(row.sizeBytes)}</td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={boxUrl(row)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-700 hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Box ↗
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
