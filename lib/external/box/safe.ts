/**
 * Box Safe Wrapper
 *
 * Allow-list — these are the ONLY methods that may exist in this file:
 *
 *   Reads:
 *     - listFolder
 *     - getFolder
 *     - getFile
 *     - getFileVersions
 *     - downloadFile
 *     - searchFolderTree
 *
 *   Creates / writes (PHASE 5+ — not yet implemented):
 *     - createFolder(parentFolderId, name) — parent MUST be within `Tenants – ChapmanHoeck/Clients/*`
 *     - uploadNewFile(folderId, file, name) — never overwrites
 *     - uploadNewVersion(fileId, file) — always uploads as new version, never replaces in-place
 *
 *   Scoped rename (PHASE 6 — not yet implemented):
 *     - renameDealFolder(folderId, newName, oldName, reason)
 *
 * Forbid-list — these methods MUST NEVER exist in this file:
 *
 *   - deleteFile, deleteFolder
 *   - moveFile, moveFolder
 *   - renameFile (no file rename — ever)
 *   - renameFolder (generic; only renameDealFolder is allowed)
 *   - Any same-version overwrite (no "replace file contents in place")
 *
 * Lineage: BUILD_SPEC.md § "Safety Rules → Box"; docs/LESSONS_LEARNED.md
 */

import { boxFetch } from './client';
import type { BoxApiItem, BoxApiFolderListing, BoxItem, BoxFolder, BoxFile, BoxFileVersion } from './types';

// DEAL_FOLDER_PATTERN — used by Phase 6 renameDealFolder validation. Kept here so tests can import it.
// Year (or year–year range) – Lease Acquisition|Disposition (– Address)?
export const DEAL_FOLDER_PATTERN = /^(\d{4}(?:[–-]\d{4})?)\s*[–-]\s*Lease\s+(Acquisition|Disposition)(\s*[–-]\s*.+)?$/;

const BOX_API = 'https://api.box.com/2.0';

// Fields we request from Box for every item — keeps the wire format small + predictable.
const ITEM_FIELDS = 'id,type,name,size,modified_at,parent,item_count,sha1,url,shared_link';

function mapApiItem(api: BoxApiItem): BoxItem {
  return {
    id: api.id,
    type: api.type,
    name: api.name,
    parentId: api.parent?.id,
    modifiedAt: api.modified_at,
    size: api.size,
    url: api.url ?? api.shared_link?.url,
  };
}

/**
 * List items inside a folder.
 * Box paginates at 1000 max per request; we paginate transparently.
 */
export async function listFolder(
  userId: string,
  folderId: string,
  opts: { limit?: number } = {},
): Promise<BoxItem[]> {
  const pageSize = Math.min(opts.limit ?? 1000, 1000);
  const items: BoxItem[] = [];
  let offset = 0;
  for (;;) {
    const url = `${BOX_API}/folders/${encodeURIComponent(folderId)}/items?fields=${ITEM_FIELDS}&limit=${pageSize}&offset=${offset}`;
    const res = await boxFetch(userId, url);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Box listFolder ${folderId} failed: HTTP ${res.status} — ${text}`);
    }
    const data = (await res.json()) as BoxApiFolderListing;
    for (const e of data.entries) items.push(mapApiItem(e));
    offset += data.entries.length;
    if (offset >= data.total_count || data.entries.length === 0) break;
    if (opts.limit && items.length >= opts.limit) break;
  }
  return items;
}

/**
 * Fetch a single folder's metadata.
 * Returns null if Box returns 404 (folder doesn't exist or no access).
 */
export async function getFolder(userId: string, folderId: string): Promise<BoxFolder | null> {
  const res = await boxFetch(
    userId,
    `${BOX_API}/folders/${encodeURIComponent(folderId)}?fields=${ITEM_FIELDS}`,
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Box getFolder ${folderId} failed: HTTP ${res.status} — ${text}`);
  }
  const api = (await res.json()) as BoxApiItem;
  return {
    ...mapApiItem(api),
    type: 'folder',
    itemCount: api.item_count,
  } as BoxFolder;
}

/**
 * Fetch a single file's metadata.
 * Returns null if Box returns 404.
 */
export async function getFile(userId: string, fileId: string): Promise<BoxFile | null> {
  const res = await boxFetch(
    userId,
    `${BOX_API}/files/${encodeURIComponent(fileId)}?fields=${ITEM_FIELDS}`,
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Box getFile ${fileId} failed: HTTP ${res.status} — ${text}`);
  }
  const api = (await res.json()) as BoxApiItem;
  return {
    ...mapApiItem(api),
    type: 'file',
    size: api.size ?? 0,
    modifiedAt: api.modified_at ?? new Date(0).toISOString(),
    sha1: api.sha1,
  } as BoxFile;
}

/**
 * List previous versions of a file (newest first).
 * Box requires the "Enterprise" or "Business+" plan for file versions to be exposed;
 * on lower tiers this may return an empty array.
 */
export async function getFileVersions(userId: string, fileId: string): Promise<BoxFileVersion[]> {
  const res = await boxFetch(
    userId,
    `${BOX_API}/files/${encodeURIComponent(fileId)}/versions`,
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Box getFileVersions ${fileId} failed: HTTP ${res.status} — ${text}`);
  }
  const data = (await res.json()) as {
    entries: { id: string; version_number?: string; modified_at: string; modified_by?: { name?: string } }[];
  };
  return data.entries.map((v) => ({
    id: v.id,
    fileId,
    versionNumber: v.version_number ?? v.id,
    modifiedAt: v.modified_at,
    modifiedBy: v.modified_by?.name,
  }));
}

/**
 * Download a file's content as a Web ReadableStream.
 * Caller is responsible for piping it (e.g. into a Response, a file, or the openpyxl bridge).
 */
export async function downloadFile(userId: string, fileId: string): Promise<ReadableStream<Uint8Array>> {
  // GET /files/{file_id}/content returns a 302 to a signed download URL;
  // fetch() follows by default.
  const res = await boxFetch(userId, `${BOX_API}/files/${encodeURIComponent(fileId)}/content`);
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(`Box downloadFile ${fileId} failed: HTTP ${res.status} — ${text}`);
  }
  return res.body;
}

/**
 * Search for items by name within a folder subtree.
 * Uses Box's /search endpoint with ancestor_folder_ids to scope.
 */
export async function searchFolderTree(
  userId: string,
  rootFolderId: string,
  query: string,
  opts: { type?: 'file' | 'folder'; limit?: number } = {},
): Promise<BoxItem[]> {
  const params = new URLSearchParams({
    query,
    ancestor_folder_ids: rootFolderId,
    fields: ITEM_FIELDS,
    limit: String(Math.min(opts.limit ?? 200, 200)),
  });
  if (opts.type) params.set('type', opts.type);
  const res = await boxFetch(userId, `${BOX_API}/search?${params.toString()}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Box searchFolderTree failed: HTTP ${res.status} — ${text}`);
  }
  const data = (await res.json()) as { entries: BoxApiItem[] };
  return data.entries.map(mapApiItem);
}

export const __SAFE_WRAPPER_VERSION = 'phase-2-reads';
