'use client';

/**
 * /files — Box folder browser.
 *
 * URL-driven navigation:
 *   - /files            → root (Tenants – ChapmanHoeck)
 *   - /files?folder=ID  → inside that folder
 *
 * Drilling in does `router.push('/files?folder=...')` so the browser back/forward
 * buttons work naturally and folder URLs are shareable. The ← Back button calls
 * `router.back()`. Direct deep-link loads work because the breadcrumb is fetched
 * from /api/box/folder-chain (a single recursive CTE query).
 *
 * Two render states:
 *   1. User has no Box connection → show <ConnectBoxBanner /> + nothing else
 *   2. User is connected → show folder browser with breadcrumb + search + index data
 *
 * Data comes from box_folder_index (Postgres mirror), not Box directly.
 * Freshness: <LastUpdated /> + Refresh button which calls POST /api/box/reindex.
 */

import { Suspense, useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { LastUpdated } from '@/components/LastUpdated';
import { ConnectBoxBanner } from '@/components/ConnectBoxBanner';
import { BoxRefreshButton } from '@/components/BoxRefreshButton';
import { FullWalkConfirmModal } from '@/components/FullWalkConfirmModal';
import { ExtractTextConfirmModal } from '@/components/ExtractTextConfirmModal';
import { useBoxSyncStatus } from '@/lib/hooks/useBoxSyncStatus';
import { useTextExtractionStatus } from '@/lib/hooks/useTextExtractionStatus';

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

interface ChainEntry {
  box_id: string;
  name: string;
  parent_box_id: string | null;
  depth: number;
}

interface SearchResults {
  query: string;
  filenames: BoxFolderRow[];
  contents: (BoxFolderRow & { match_snippet: string; match_rank: number })[];
}

interface ExtractionStats {
  totalPdfs: number;
  extracted: number;
  pending: number;
  failed: number;
  skippedScanned: number;
  skippedTooLarge: number;
  nullStatus: number;
  lastRunCompletedAt: string | null;
  lastRunJobId: string | null;
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

async function fetchCombinedSearch(q: string): Promise<SearchResults> {
  const res = await fetch(`/api/box/folders/search?q=${encodeURIComponent(q)}`, {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  return res.json();
}

async function fetchExtractionStats(): Promise<ExtractionStats> {
  const res = await fetch('/api/box/extract-text/stats', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Extraction stats fetch failed: ${res.status}`);
  return res.json();
}

function fmtRelativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.max(0, Math.round((now - then) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
}

async function fetchChain(folderId?: string): Promise<ChainEntry[]> {
  const params = new URLSearchParams();
  if (folderId) params.set('id', folderId);
  const res = await fetch(`/api/box/folder-chain?${params.toString()}`, { cache: 'no-store' });
  if (!res.ok) {
    if (res.status === 404) return []; // unknown folder — render just current segment with placeholder
    throw new Error(`Folder-chain fetch failed: ${res.status}`);
  }
  const data = (await res.json()) as { chain: ChainEntry[] };
  return data.chain;
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

function hrefForFolder(folderId?: string): string {
  return folderId ? `/files?folder=${encodeURIComponent(folderId)}` : '/files';
}

function formatDurationMin(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  const min = Math.round(ms / 60_000);
  return `${min} min`;
}

interface SearchResultsViewProps {
  search: ReturnType<typeof useQuery<SearchResults>>;
  query: string;
  drillInto: (row: BoxFolderRow) => void;
  boxUrl: (row: BoxFolderRow) => string;
}

function SearchResultsView({ search, query, drillInto, boxUrl }: SearchResultsViewProps) {
  if (search.isLoading) {
    return <div className="p-6 text-sm text-gray-500">Searching…</div>;
  }
  if (search.isError) {
    return <div className="p-6 text-sm text-red-700">Search failed.</div>;
  }
  const data = search.data;
  if (!data || (data.filenames.length === 0 && data.contents.length === 0)) {
    return (
      <div className="p-6 text-sm text-gray-500">
        No matches for &ldquo;{query}&rdquo; — neither filenames nor inside PDF text.
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {/* Section 1: File and folder name matches */}
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
          File and folder names ({data.filenames.length})
        </h2>
        {data.filenames.length === 0 ? (
          <p className="text-sm text-gray-500">No filename matches.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-gray-100">
                {data.filenames.map((row) => (
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
                      </button>
                      {row.pathSegments && row.pathSegments.length > 0 && (
                        <div className="ml-7 mt-0.5 text-[11px] text-gray-500">
                          {row.pathSegments.join(' / ')}
                        </div>
                      )}
                    </td>
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
      </section>

      {/* Section 2: Inside PDF documents (full-text content matches) */}
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Inside PDF documents ({data.contents.length}
          {data.contents.length === 50 ? '+, ranked' : ''})
        </h2>
        {data.contents.length === 0 ? (
          <p className="text-sm text-gray-500">No PDF content matches.</p>
        ) : (
          <ul className="space-y-2">
            {data.contents.map((row) => (
              <li
                key={row.id}
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 hover:border-gray-300"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-base">📄</span>
                      <span className="font-medium text-gray-900">{row.name}</span>
                    </div>
                    {row.pathSegments && row.pathSegments.length > 0 && (
                      <div className="ml-7 mt-0.5 text-[11px] text-gray-500">
                        {row.pathSegments.join(' / ')}
                      </div>
                    )}
                    {/* match_snippet is server-generated via ts_headline — we trust it
                        to wrap <mark> safely. Postgres' ts_headline escapes embedded HTML. */}
                    <p
                      className="ml-7 mt-1 text-xs leading-relaxed text-gray-700 [&_mark]:rounded [&_mark]:bg-yellow-100 [&_mark]:px-0.5 [&_mark]:py-0 [&_mark]:font-medium [&_mark]:text-gray-900"
                      dangerouslySetInnerHTML={{ __html: row.match_snippet }}
                    />
                  </div>
                  <Link
                    href={boxUrl(row)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Open in Box ↗
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function FilesPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  // The folder ID we're currently viewing. undefined = root.
  const folderId = searchParams.get('folder') ?? undefined;
  const [query, setQuery] = useState('');

  const connection = useQuery({
    queryKey: ['box', 'connection'],
    queryFn: fetchConnection,
  });

  // Ancestor chain for the breadcrumb (single recursive CTE on the server).
  const chain = useQuery({
    queryKey: ['box', 'chain', folderId ?? 'root'],
    queryFn: () => fetchChain(folderId),
    enabled: connection.data?.connected === true,
  });

  // Children of the current folder — only when NOT in search mode.
  const folders = useQuery({
    queryKey: ['box', 'folders', { parent: folderId }],
    queryFn: () => fetchFolders({ parent: folderId }),
    enabled: connection.data?.connected === true && !query,
  });

  // Combined filename + PDF content search — only when query is non-empty.
  // Phase 2.5a: this replaces the old /api/box/folders?q= path for search mode.
  const search = useQuery({
    queryKey: ['box', 'folders', 'search', query],
    queryFn: () => fetchCombinedSearch(query),
    enabled: connection.data?.connected === true && query.length > 0,
  });

  // PDF text-extraction stats for the status banner (refreshes every 30s and on
  // text_extraction job state changes).
  const stats = useQuery({
    queryKey: ['box', 'extract-text', 'stats'],
    queryFn: fetchExtractionStats,
    enabled: connection.data?.connected === true,
    refetchInterval: 30_000,
  });

  // Polling of the latest text_extraction job (mirrors useBoxSyncStatus for walker).
  const textExtraction = useTextExtractionStatus({ enabled: connection.data?.connected === true });
  const isTextExtractionActive =
    textExtraction.job?.status === 'queued' || textExtraction.job?.status === 'running';

  // Async background-job pattern (P2.15.x):
  //   - POST /api/box/sync returns 202 immediately with { jobId, status }
  //   - useBoxSyncStatus polls /api/box/sync/status every 5s while job is queued/running
  //   - When status flips to 'completed' / 'failed', polling stops + banner appears
  //   - 5-minute frontend timeout is gone — walks can take however long they need
  const sync = useBoxSyncStatus({ enabled: connection.data?.connected === true });
  const isJobActive = sync.job?.status === 'queued' || sync.job?.status === 'running';

  // Track which terminal jobIds the user has already "seen" via the banner so we don't
  // re-flash the banner if the user navigates away and back. The banner auto-dismisses
  // after 30 seconds either way.
  const [acknowledgedJobId, setAcknowledgedJobId] = useState<string | null>(null);
  const [bannerHidden, setBannerHidden] = useState(false);

  // Auto-dismiss the completion / failure banner after 30s of being visible.
  useEffect(() => {
    if (!sync.job || isJobActive) return;
    if (bannerHidden) return;
    const id = setTimeout(() => setBannerHidden(true), 30_000);
    return () => clearTimeout(id);
  }, [sync.job, isJobActive, bannerHidden]);

  // When a new job starts (different id), reset the banner-hidden flag so its completion
  // banner is allowed to show. The state-in-effect rule fires here, but this is the
  // canonical "respond to upstream change" pattern; the alternative (derive everything
  // from refs) is worse for readability.
  useEffect(() => {
    if (isJobActive && sync.job?.id && sync.job.id !== acknowledgedJobId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAcknowledgedJobId(sync.job.id);
      setBannerHidden(false);
    }
  }, [isJobActive, sync.job?.id, acknowledgedJobId]);

  // When polling reveals a completed job, invalidate the folder browser so it refetches.
  useEffect(() => {
    if (sync.job?.status === 'completed') {
      void queryClient.invalidateQueries({ queryKey: ['box', 'folders'] });
      void queryClient.invalidateQueries({ queryKey: ['box', 'chain'] });
      // Walker may have added or removed PDFs — bust extraction stats too.
      void queryClient.invalidateQueries({ queryKey: ['box', 'extract-text', 'stats'] });
    }
  }, [sync.job?.status, queryClient]);

  // When text extraction completes, the stats counts change AND any open search
  // result that included content matches becomes stale — refetch both.
  useEffect(() => {
    if (textExtraction.job?.status === 'completed') {
      void queryClient.invalidateQueries({ queryKey: ['box', 'extract-text', 'stats'] });
      void queryClient.invalidateQueries({ queryKey: ['box', 'folders', 'search'] });
    }
  }, [textExtraction.job?.status, queryClient]);

  const [fullWalkModalOpen, setFullWalkModalOpen] = useState(false);
  const [extractTextModalOpen, setExtractTextModalOpen] = useState(false);

  const startSync = useMutation({
    mutationFn: async (opts: { mode?: 'full' | 'incremental'; force?: boolean }) => {
      const params = new URLSearchParams();
      if (opts.mode) params.set('mode', opts.mode);
      if (opts.force) params.set('force', 'true');
      const url = `/api/box/sync${params.toString() ? `?${params.toString()}` : ''}`;
      const res = await fetch(url, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.status === 202) return data; // Success: 202 Accepted
      if (res.status === 409) {
        // Active job already running — just return the data; the polling hook will pick it up.
        return data;
      }
      if (res.status === 412 && data.error === 'box_not_connected') {
        throw new Error('Box not connected. Click "Connect Box" again.');
      }
      throw new Error(data.message || data.error || `Sync request failed: HTTP ${res.status}`);
    },
    onSuccess: () => {
      // Immediately refetch status so the UI flips to "Syncing…" without waiting 5s.
      void sync.refetch();
    },
  });

  const startFullWalk = () => {
    setFullWalkModalOpen(false);
    startSync.mutate({ mode: 'full' });
  };

  const startTextExtraction = useMutation({
    mutationFn: async (opts: { force?: boolean }) => {
      const params = new URLSearchParams();
      if (opts.force) params.set('force', 'true');
      const url = `/api/box/extract-text${params.toString() ? `?${params.toString()}` : ''}`;
      const res = await fetch(url, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.status === 202) return data;
      if (res.status === 409) return data; // already running — pick up via polling
      if (res.status === 412 && data.error === 'box_not_connected') {
        throw new Error('Box not connected. Click "Connect Box" again.');
      }
      throw new Error(data.message || data.error || `Extract request failed: HTTP ${res.status}`);
    },
    onSuccess: () => {
      void textExtraction.refetch();
    },
  });

  const confirmExtractText = () => {
    setExtractTextModalOpen(false);
    startTextExtraction.mutate({});
  };

  if (connection.isLoading) {
    return <div className="p-8 text-sm text-gray-500">Loading…</div>;
  }

  if (!connection.data?.connected) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Files</h1>
        <p className="mt-1 text-sm text-gray-500">
          Browse <code className="text-xs">Tenants - ChapmanHoeck</code> from Box.
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
    setQuery('');
    router.push(hrefForFolder(row.boxId));
  }

  function navigateToFolder(targetId?: string) {
    setQuery('');
    router.push(hrefForFolder(targetId));
  }

  // Chain is server-truth: index 0 = root, last = current folder.
  // If the chain query failed (e.g., unindexed folder), fall back to a one-entry placeholder.
  const breadcrumb: { boxId?: string; name: string }[] =
    chain.data && chain.data.length > 0
      ? chain.data.map((c, i) => ({
          // Root has parent_box_id NULL — we don't want a ?folder param for it.
          boxId: i === 0 ? undefined : c.box_id,
          name: c.name,
        }))
      : [{ boxId: undefined, name: 'Tenants – ChapmanHoeck' }];

  const isAtRoot = breadcrumb.length <= 1;
  const parentForBack = !isAtRoot ? breadcrumb[breadcrumb.length - 2] : undefined;

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
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-3">
            <LastUpdated query={folders} />
            <BoxRefreshButton
              onClick={() => startSync.mutate({})}
              disabled={startSync.isPending}
              isPending={startSync.isPending || isJobActive}
              progress={
                isJobActive && sync.job
                  ? {
                      foldersWalked: sync.job.progressFoldersWalked,
                      filesIndexed: sync.job.progressFilesIndexed,
                      currentPath: sync.job.currentPath,
                      syncMode: sync.job.syncMode,
                    }
                  : null
              }
            />
          </div>
          {!isJobActive && !startSync.isPending && (
            <button
              type="button"
              onClick={() => setFullWalkModalOpen(true)}
              className="text-[11px] text-gray-500 hover:text-gray-800 hover:underline"
              title="Re-walk all 27k+ folders. Takes ~30 minutes."
            >
              Run full walk →
            </button>
          )}
          {/* Extract PDF text button — appears next to Refresh only when there's
              pending work AND we aren't already running an extraction. */}
          {stats.data && (stats.data.pending > 0 || stats.data.nullStatus > 0) && !isTextExtractionActive && (
            <button
              type="button"
              onClick={() => setExtractTextModalOpen(true)}
              disabled={startTextExtraction.isPending}
              className="text-[11px] text-blue-700 hover:text-blue-900 hover:underline disabled:opacity-50"
              title={`${(stats.data.pending + stats.data.nullStatus).toLocaleString()} PDFs awaiting extraction`}
            >
              Extract PDF text →
            </button>
          )}
        </div>
      </div>

      {/* PDF content-search status banner. Always visible when there are any indexed PDFs;
          hidden when nothing's been indexed yet (cleaner empty state). */}
      {stats.data && stats.data.totalPdfs > 0 && (
        <div
          className="mb-3 flex items-center justify-between gap-2 rounded border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-700"
          title={
            `Extracted: ${stats.data.extracted.toLocaleString()}\n` +
            `Pending:   ${(stats.data.pending + stats.data.nullStatus).toLocaleString()}\n` +
            `Scanned:   ${stats.data.skippedScanned.toLocaleString()} (image-only, OCR in Phase 2.5b)\n` +
            `Too large: ${stats.data.skippedTooLarge.toLocaleString()} (>50 MB)\n` +
            `Failed:    ${stats.data.failed.toLocaleString()}`
          }
        >
          <div>
            <span className="font-medium text-gray-900">
              PDF content search:{' '}
              {stats.data.extracted.toLocaleString()} of {stats.data.totalPdfs.toLocaleString()} files indexed
            </span>
            {isTextExtractionActive && textExtraction.job && (
              <span className="ml-2 text-blue-700">
                · extracting: {textExtraction.job.progressFilesProcessed.toLocaleString()} processed
                ({textExtraction.job.progressFilesSucceeded.toLocaleString()} ok,{' '}
                {textExtraction.job.progressFilesSkipped.toLocaleString()} skipped,{' '}
                {textExtraction.job.progressFilesFailed.toLocaleString()} failed)
              </span>
            )}
          </div>
          <div className="text-gray-500">
            {stats.data.lastRunCompletedAt
              ? `Last run: ${fmtRelativeTime(stats.data.lastRunCompletedAt)}`
              : 'No extraction runs yet'}
          </div>
        </div>
      )}

      {/* Back button + Breadcrumb */}
      <div className="mb-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.back()}
          disabled={isAtRoot}
          className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          title={
            isAtRoot
              ? 'Already at the root folder'
              : parentForBack
                ? `Back to ${parentForBack.name}`
                : 'Back'
          }
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
                onClick={() => navigateToFolder(b.boxId)}
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

      {/* POST /api/box/sync error surface (network / 412 / 5xx — NOT job-status failures) */}
      {startSync.isError && (
        <div className="mb-3 flex items-start justify-between gap-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <div className="min-w-0">
            <div className="font-medium">Couldn&apos;t start sync</div>
            <div className="mt-0.5 text-xs">{(startSync.error as Error).message}</div>
          </div>
          <button
            type="button"
            onClick={() => {
              startSync.reset();
              startSync.mutate({});
            }}
            className="shrink-0 rounded border border-red-300 bg-white px-2 py-1 text-xs font-medium text-red-800 hover:bg-red-100"
          >
            Retry
          </button>
        </div>
      )}

      {/* Job-status banner: shown when latest job is terminal (completed/failed). Auto-dismisses
          after 30s (see useEffect above). User can dismiss earlier with the × button. */}
      {sync.job && !isJobActive && !bannerHidden && sync.job.status === 'completed' && (
        <div className="mb-3 flex items-start justify-between gap-3 rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">
          <div className="min-w-0">
            <div className="font-medium">Sync complete</div>
            <div className="mt-0.5 text-xs">
              {sync.job.totalFoldersInIndex !== null
                ? `${sync.job.totalFoldersInIndex.toLocaleString()} items now indexed`
                : `${sync.job.progressFilesIndexed.toLocaleString()} items processed`}
              {' · '}
              <span className="capitalize">{sync.job.syncMode}</span> walk
              {' · '}
              {sync.job.completedAt && sync.job.startedAt
                ? formatDurationMin(
                    new Date(sync.job.completedAt).getTime() - new Date(sync.job.startedAt).getTime(),
                  )
                : '—'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setBannerHidden(true)}
            className="shrink-0 rounded p-0.5 text-green-900 hover:bg-green-100"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}
      {sync.job && !isJobActive && !bannerHidden && sync.job.status === 'failed' && (
        <div className="mb-3 flex items-start justify-between gap-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <div className="min-w-0">
            <div className="font-medium">Sync failed</div>
            <div className="mt-0.5 text-xs">
              {sync.job.errorMessage ?? 'Unknown error. Check Activity Feed for details.'}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => {
                setBannerHidden(true);
                startSync.mutate({});
              }}
              className="rounded border border-red-300 bg-white px-2 py-1 text-xs font-medium text-red-800 hover:bg-red-100"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => setBannerHidden(true)}
              className="rounded p-0.5 text-red-800 hover:bg-red-100"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        </div>
      )}

      <FullWalkConfirmModal
        open={fullWalkModalOpen}
        onCancel={() => setFullWalkModalOpen(false)}
        onConfirm={startFullWalk}
      />
      <ExtractTextConfirmModal
        open={extractTextModalOpen}
        onCancel={() => setExtractTextModalOpen(false)}
        onConfirm={confirmExtractText}
        pendingCount={(stats.data?.pending ?? 0) + (stats.data?.nullStatus ?? 0)}
      />

      {/* ============ SEARCH MODE: two-section render ============ */}
      {query ? (
        <SearchResultsView
          search={search}
          query={query}
          drillInto={drillInto}
          boxUrl={boxUrl}
        />
      ) : folders.isLoading ? (
        <div className="p-6 text-sm text-gray-500">Loading folders…</div>
      ) : folders.isError ? (
        <div className="p-6 text-sm text-red-700">Failed to load folders.</div>
      ) : (folders.data?.length ?? 0) === 0 ? (
        <div className="p-6 text-sm text-gray-500">
          No items yet. Click &ldquo;Refresh from Box&rdquo; to index.
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

export default function FilesPage() {
  // useSearchParams requires a Suspense boundary for static prerendering. We use a tiny
  // placeholder while the URL is being resolved on first paint — usually instant.
  return (
    <Suspense fallback={<div className="p-8 text-sm text-gray-500">Loading…</div>}>
      <FilesPageInner />
    </Suspense>
  );
}
