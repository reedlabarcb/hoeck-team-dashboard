/**
 * Box types — Phase 1 placeholders.
 * Real shapes will be derived from the Box API SDK in Phase 2.
 */

export interface BoxItem {
  id: string;
  type: 'file' | 'folder' | 'web_link';
  name: string;
  parentId?: string;
  modifiedAt?: string;
  size?: number;
  // For web_link items (Box's shortcut/alias type), the resolved URL.
  url?: string;
  // Box's per-resource etag; bumps every time the file changes. We use it as the
  // cache key for the Master Excel reader (5-min etag-bound cache).
  etag?: string;
}

export interface BoxFolder extends BoxItem {
  type: 'folder';
  itemCount?: number;
}

export interface BoxFile extends BoxItem {
  type: 'file';
  size: number;
  modifiedAt: string;
  versionNumber?: string;
  sha1?: string;
}

export interface BoxFileVersion {
  id: string;
  fileId: string;
  versionNumber: string;
  modifiedAt: string;
  modifiedBy?: string;
}

// Raw shapes from Box API — used inside the wrapper, not exposed.
export interface BoxApiItem {
  type: 'file' | 'folder' | 'web_link';
  id: string;
  name: string;
  size?: number;
  modified_at?: string;
  parent?: { id: string; type: 'folder' };
  item_count?: number;
  sha1?: string;
  url?: string;
  shared_link?: { url?: string };
  etag?: string;
}

export interface BoxApiFolderListing {
  total_count: number;
  entries: BoxApiItem[];
  offset: number;
  limit: number;
}

// Folder convention parsing — used by Phase 2 folder walker.
export interface ParsedDealFolderName {
  yearStart: number;
  yearEnd?: number;
  dealType: 'Acquisition' | 'Disposition';
  address?: string;
}
