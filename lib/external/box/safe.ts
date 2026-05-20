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
 *   Creates / writes:
 *     - createFolder(parentFolderId, name) — parent MUST be within `Tenants – ChapmanHoeck/Clients/*`
 *     - uploadNewFile(folderId, file, name) — never overwrites
 *     - uploadNewVersion(fileId, file) — always uploads as new version, never replaces in-place
 *
 *   Scoped rename (the ONLY rename allowed):
 *     - renameDealFolder(folderId, newName, oldName, reason)
 *         - Old name MUST match DEAL_FOLDER_PATTERN
 *         - New name MUST match DEAL_FOLDER_PATTERN
 *         - Year prefix UNCHANGED
 *         - Deal type (Acquisition | Disposition) UNCHANGED
 *         - Folder MUST sit directly inside a client folder, or a market subfolder of an MT client
 *         - Folder MUST NOT be a sublease shortcut
 *         - Logs activity_feed entry with status: 'destructive_rename'
 *
 * Forbid-list — these methods MUST NEVER exist in this file:
 *
 *   - deleteFile, deleteFolder
 *   - moveFile, moveFolder
 *   - renameFile (no file rename — ever)
 *   - renameFolder (generic; only renameDealFolder is allowed)
 *   - Any same-version overwrite (no "replace file contents in place")
 *
 * Lineage:
 *   - BUILD_SPEC.md § "Safety Rules → Box"
 *   - docs/LESSONS_LEARNED.md
 *
 * Phase 1: stubs only. Read methods land Phase 2. Write methods land Phase 5+. renameDealFolder lands Phase 6.
 */

// DEAL_FOLDER_PATTERN — used by renameDealFolder validation. Defined here so tests can import it.
// Year (or year–year range) – Lease Acquisition|Disposition (– Address)?
export const DEAL_FOLDER_PATTERN = /^(\d{4}(?:[–-]\d{4})?)\s*[–-]\s*Lease\s+(Acquisition|Disposition)(\s*[–-]\s*.+)?$/;

// TODO(phase-2): listFolder(folderId: string): Promise<BoxItem[]>
// TODO(phase-2): getFolder(folderId: string): Promise<BoxFolder | null>
// TODO(phase-2): getFile(fileId: string): Promise<BoxFile | null>
// TODO(phase-2): getFileVersions(fileId: string): Promise<BoxFileVersion[]>
// TODO(phase-2): downloadFile(fileId: string): Promise<ReadableStream>
// TODO(phase-2): searchFolderTree(rootFolderId: string, query: string): Promise<BoxItem[]>
// TODO(phase-5): createFolder(parentFolderId: string, name: string): Promise<BoxFolder>  // scoped to Clients/*
// TODO(phase-5): uploadNewFile(folderId: string, content: Buffer | ReadableStream, name: string): Promise<BoxFile>
// TODO(phase-5): uploadNewVersion(fileId: string, content: Buffer | ReadableStream): Promise<BoxFileVersion>
// TODO(phase-6): renameDealFolder(folderId: string, newName: string, oldName: string, reason: string): Promise<BoxFolder>

export const __SAFE_WRAPPER_VERSION = 'phase-1-stub';
