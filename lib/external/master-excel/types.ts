/**
 * Master Excel TS-side types. Mirror the JSON shapes emitted by
 * scripts/python/master_excel_read.py — keep these in sync if you edit either side.
 */

/** One row from the TT Rep Master Client List, post-normalization. */
export interface MasterExcelRow {
  client: string | null;
  market: string | null;
  address: string | null;
  spaceSf: number | null;
  leaseExpiration: string | null; // ISO-8601 date string
  renewalWindowStart: string | null;
  renewalWindowEnd: string | null;
  renewalDeadline: string | null;
  terminationDeadline: string | null;
  notes: string | null;
  /** 1-indexed row number in the underlying xlsx — useful for cross-checking + audit. */
  sourceRow: number | null;
}

/** GET-side: where the data came from. UI surfaces this so users know the cache state. */
export interface MasterExcelSource {
  boxFileId: string;
  etag: string | null;
  fetchedAt: string;       // ISO-8601 datetime
  cacheHit: boolean;
  /** Box file name (e.g., "TT Rep Master Client List 5.20.26.xlsx"). */
  fileName: string | null;
  /** Box modified_at, from getFile metadata. */
  boxModifiedAt: string | null;
}

export interface MasterExcelLookupResult {
  rows: MasterExcelRow[];
  matchCount: number;
  multipleMatches: boolean;
  query: { client: string; market?: string };
  source: MasterExcelSource;
  warnings: string[];
  /**
   * Field-name → 0-indexed column position as detected by the Python header parser.
   * Surfaces the parser's column-detection result so we (and the UI later) can show
   * which fields the parser found in the actual file. Missing fields = parser couldn't
   * match the column name; user sees a parser warning + `null` data.
   */
  headers?: Record<string, number>;
}

export interface MasterExcelAllRowsResult {
  rows: MasterExcelRow[];
  rowCount: number;
  source: MasterExcelSource;
  warnings: string[];
  headers?: Record<string, number>;
}

export interface MasterExcelSmokeResult {
  ok: true;
  sheetCount: number;
  sheetNames: string[];
  primarySheet: string;
  primaryRowCount: number;
  source: MasterExcelSource;
}

// ---- Raw shapes coming back from the Python subprocess ----
// Lowercase + snake_case here mirrors what master_excel_read.py emits.
// We translate to camelCase in safe.ts before exposing externally.

export interface PythonRowDict {
  client: string | null;
  market: string | null;
  address: string | null;
  space_sf: number | null;
  lease_expiration: string | null;
  renewal_window_start: string | null;
  renewal_window_end: string | null;
  renewal_deadline: string | null;
  termination_deadline: string | null;
  notes: string | null;
  source_row: number | null;
}

export interface PythonLookupResponse {
  status: 'ok' | 'error';
  action: 'lookup';
  sheet_name?: string;
  query?: { client: string; market: string | null };
  match_count?: number;
  multiple_matches?: boolean;
  rows?: PythonRowDict[];
  headers?: Record<string, number>;
  warnings?: string[];
  error?: string;
}

export interface PythonAllResponse {
  status: 'ok' | 'error';
  action: 'all';
  sheet_name?: string;
  row_count?: number;
  rows?: PythonRowDict[];
  headers?: Record<string, number>;
  warnings?: string[];
  error?: string;
}

export interface PythonSmokeResponse {
  status: 'ok' | 'error';
  action: 'smoke';
  sheet_count?: number;
  sheet_names?: string[];
  primary_sheet?: string;
  primary_row_count?: number;
  warnings?: string[];
  error?: string;
}
