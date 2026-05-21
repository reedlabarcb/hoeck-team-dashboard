/**
 * Box folder-name conventions for the Chapman & Hoeck Tenant Rep team.
 *
 * Documented in docs/Box_Workflow.md § "Naming Conventions & Folder Quirks".
 *
 * Cheat sheet:
 *   - Deal folders: `YEAR – Lease Acquisition – ADDRESS` or `YEAR – Lease Disposition – ADDRESS`
 *     - Year may be a range: `2018–2025 – Lease Acquisition – Lake Oswego`
 *     - Address optional: `2024 – Lease Acquisition` (deal engaged but no lease signed)
 *   - Client folders with `MT` suffix → multi-market client; nested per state/market
 *   - Lease Disposition folders that are shortcuts → master sublease listings folder
 *
 * Two callers:
 *   1. The folder walker, which records year/dealType/address/isMt/etc into box_folder_index
 *   2. Phase 6's renameDealFolder, which validates BOTH old and new names match the pattern
 *      AND that the year + deal type are unchanged.
 */

import { DEAL_FOLDER_PATTERN } from './safe';

export interface ParsedDealFolder {
  yearStart: number;
  yearEnd?: number;
  dealType: 'Acquisition' | 'Disposition';
  address?: string;
}

/**
 * Parse a folder name against DEAL_FOLDER_PATTERN. Returns null if name doesn't match.
 *
 * Examples:
 *   "2026 – Lease Acquisition" → { yearStart: 2026, dealType: 'Acquisition' }
 *   "2026 – Lease Acquisition – 350 10th Ave"
 *       → { yearStart: 2026, dealType: 'Acquisition', address: '350 10th Ave' }
 *   "2018–2025 – Lease Acquisition – Lake Oswego"
 *       → { yearStart: 2018, yearEnd: 2025, dealType: 'Acquisition', address: 'Lake Oswego' }
 */
export function parseDealFolderName(name: string): ParsedDealFolder | null {
  const m = DEAL_FOLDER_PATTERN.exec(name.trim());
  if (!m) return null;

  const yearPart = m[1]; // e.g. "2026" or "2018–2025"
  const dealType = m[2] as 'Acquisition' | 'Disposition';
  const addressPart = m[3]; // e.g. " – 350 10th Ave" or undefined

  // year part may be a range: split on em-dash or hyphen
  const yearTokens = yearPart.split(/[–-]/).map((s) => s.trim());
  const yearStart = parseInt(yearTokens[0], 10);
  const yearEnd = yearTokens[1] ? parseInt(yearTokens[1], 10) : undefined;

  let address: string | undefined;
  if (addressPart) {
    // Strip leading separator and whitespace, then any trailing whitespace
    address = addressPart.replace(/^\s*[–-]\s*/, '').trim();
    if (!address) address = undefined;
  }

  return {
    yearStart,
    yearEnd,
    dealType,
    address,
  };
}

/**
 * Is this client folder a multi-market client?
 * Per spec: name ends with " – MT" (em-dash, space, MT) or "-MT" variants.
 */
export function isMtClient(folderName: string): boolean {
  // case-sensitive MT, optional whitespace around the separator
  return /[\s–-]\s*MT\s*$/.test(folderName.trim());
}

/**
 * Common Address-like markers in raw folder names. Used by the walker to flag rows
 * even when DEAL_FOLDER_PATTERN doesn't match (e.g. typos in the year).
 */
export function isLeaseFolderHint(name: string): boolean {
  return /lease\s+(acquisition|disposition)/i.test(name);
}
