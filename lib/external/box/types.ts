/**
 * Box types — Phase 1 placeholders.
 * Real shapes will be derived from the Box API SDK in Phase 2.
 */

export interface BoxItem {
  id: string;
  type: 'file' | 'folder' | 'web_link';
  name: string;
  parentId?: string;
}

export interface BoxFolder extends BoxItem {
  type: 'folder';
  itemCount?: number;
  size?: number;
  modifiedAt?: string; // ISO datetime
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

// Folder convention parsing — used by Phase 2 folder walker.
export interface ParsedDealFolderName {
  yearStart: number;
  yearEnd?: number;
  dealType: 'Acquisition' | 'Disposition';
  address?: string;
}
