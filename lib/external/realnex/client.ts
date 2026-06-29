/**
 * RealNex HTTP client - Phase 3.
 *
 * Base URL: https://sync.realnex.com (the documented SyncAPI host; reachable through
 * CBRE Zscaler - api/app.realnex.com are NOT. See docs/RealNex_API_Discovery.md section 2).
 *
 * Auth: static Bearer JWT from REALNEX_API_KEY (Mike Hoeck's token - ALL reads/writes
 * are attributed to Mike in RealNex's audit log; single-identity is an approved v1
 * tradeoff, see docs/PHASE3_BUILD_PLAN.md). No OAuth/refresh dance (unlike Box) - the
 * token's exp is ~year 2038.
 *
 * WRITE-SAFETY AT THE HTTP LAYER
 * ------------------------------
 * This module exposes ONLY `realnexGet`. There is deliberately NO generic verb-taking
 * request function - so no caller can issue PUT / PATCH / DELETE to RealNex, by accident
 * or otherwise. `realnexPost` (create-only) is added in P3.6 when Company/Contact/Activity
 * creation lands. A PUT/PATCH/DELETE helper must NEVER be added here.
 * See docs/PHASE3_BUILD_PLAN.md "RealNex Write Safety - Enforced in Code".
 */

const REALNEX_BASE = 'https://sync.realnex.com';

/** Thrown when REALNEX_API_KEY is absent - surfaces as a clear "not connected" state. */
export class RealNexNotConfiguredError extends Error {
  constructor() {
    super('REALNEX_API_KEY is not set. Set it in .env.local (local) or Railway (prod).');
    this.name = 'RealNexNotConfiguredError';
  }
}

/** Thrown on a non-2xx RealNex response. Carries status + a (truncated) body for diagnostics. */
export class RealNexApiError extends Error {
  constructor(
    public status: number,
    public bodyHead: string,
    public path: string,
  ) {
    super(`RealNex GET ${path} -> HTTP ${status}: ${bodyHead.slice(0, 300)}`);
    this.name = 'RealNexApiError';
  }
}

function requireKey(): string {
  const raw = process.env.REALNEX_API_KEY;
  if (!raw) throw new RealNexNotConfiguredError();
  // Strip a leading UTF-8 BOM (U+FEFF) + surrounding whitespace. Env values can pick
  // up a BOM depending on how they were written (e.g. a PowerShell pipe) - and a BOM
  // in an HTTP header value throws "Cannot convert argument to a ByteString ... value of
  // 65279". Defensive: a JWT is ASCII, so trimming is always safe.
  const k = raw.charCodeAt(0) === 0xfeff ? raw.slice(1).trim() : raw.trim();
  if (k.length < 10) throw new RealNexNotConfiguredError();
  return k;
}

function buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
  const url = new URL(path.startsWith('/') ? path : `/${path}`, REALNEX_BASE);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

interface GetOpts {
  query?: Record<string, string | number | undefined>;
  /** ms; default 20s. RealNex reads should be sub-second. */
  timeoutMs?: number;
}

/**
 * Authenticated GET against RealNex. The ONLY HTTP primitive this module exposes in P3.1.
 * Returns parsed JSON (typed by the caller). Throws RealNexNotConfiguredError /
 * RealNexApiError. Never follows a path into a mutating verb - it is GET, full stop.
 */
export async function realnexGet<T>(path: string, opts: GetOpts = {}): Promise<T> {
  const key = requireKey();
  const url = buildUrl(path, opts.query);
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      'User-Agent': 'hoeck-team-dashboard/realnex (CBRE)',
    },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new RealNexApiError(res.status, text, path);
  }
  if (!text) return undefined as unknown as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new RealNexApiError(res.status, `non-JSON body: ${text.slice(0, 200)}`, path);
  }
}
