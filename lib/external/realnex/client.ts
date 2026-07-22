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
 * This module exposes exactly FOUR functions:
 *   • realnexGet                 - any read (GET).
 *   • realnexAppendObjectHistory - append a NEW History child onto an EXISTING object. Its URL is
 *                                  BUILT HERE from objectKey (no caller-supplied path).
 *   • postCompany / postContact  - CREATE a NEW top-level company / contact (P3.7/P3.8). Each POSTs
 *                                  to a HARDCODED path literal (/api/v1/Crm/company | /contact) — no
 *                                  path composed from input — and only ADDS a new record: neither
 *                                  reads back, edits, moves, re-parents, nor deletes anything.
 * A single PRIVATE postJson(path, body) shares the POST boilerplate; it is NOT exported, so nothing
 * outside this file can supply a path or reach a general write. There is deliberately NO generic
 * verb-taking request function and NO PUT / PATCH / DELETE primitive — so editing, deleting, moving,
 * or re-parenting any RealNex record is UNEXPRESSIBLE here, not merely policy-forbidden. A
 * PUT/PATCH/DELETE helper, a generic exported POST, or a caller-supplied-path POST must NEVER be added.
 * See docs/PHASE3_BUILD_PLAN.md "RealNex Write Safety - Enforced in Code".
 */

import type { CreateCompany, CreateContact, RealNexProblemDetails } from './types';

const REALNEX_BASE = 'https://sync.realnex.com';

/** Thrown when REALNEX_API_KEY is absent - surfaces as a clear "not connected" state. */
export class RealNexNotConfiguredError extends Error {
  constructor() {
    super('REALNEX_API_KEY is not set. Set it in .env.local (local) or Railway (prod).');
    this.name = 'RealNexNotConfiguredError';
  }
}

/**
 * Thrown on a non-2xx RealNex response. Carries status + a (truncated) body for diagnostics, and —
 * for the create POSTs — the parsed RFC-7807 `problem` (ProblemDetails) when the body was JSON, so
 * the route/UI can surface title/detail instead of a raw blob.
 */
export class RealNexApiError extends Error {
  constructor(
    public status: number,
    public bodyHead: string,
    public path: string,
    public problem?: RealNexProblemDetails,
  ) {
    super(`RealNex ${path} -> HTTP ${status}: ${(problem?.title ?? bodyHead).slice(0, 300)}`);
    this.name = 'RealNexApiError';
  }
}

/**
 * Thrown by the create WRAPPERS (safe.ts createCompany/createContact) when a business/shape guard
 * fails — empty organization, missing name, useCompanyAddress without companyKey. Distinct from
 * RealNexApiError (an actual RealNex HTTP failure) so routes map guard failures → 400 and RealNex
 * failures → 4xx-passthrough/502. Carries an optional `field` for a clean field-level 400 body.
 */
export class RealNexValidationError extends Error {
  constructor(
    message: string,
    public field?: string,
  ) {
    super(message);
    this.name = 'RealNexValidationError';
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
    throw new RealNexApiError(res.status, text, `GET ${path}`);
  }
  if (!text) return undefined as unknown as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new RealNexApiError(res.status, `non-JSON body: ${text.slice(0, 200)}`, `GET ${path}`);
  }
}

interface PostOpts {
  /** ms; default 20s. */
  timeoutMs?: number;
}

/**
 * The ONE AND ONLY write. Appends a NEW History child to an EXISTING object:
 *   POST /api/v1/Crm/object/{objectKey}/history
 *
 * The path is built HERE from objectKey — the caller supplies only the objectKey and the body,
 * never a path — so this function can create a history append and NOTHING else. It physically
 * cannot POST to /company, /contact, /group/{key}/members, /history/{key}/object, or any other
 * endpoint. Combined with the absence of any PUT/PATCH/DELETE primitive, that makes editing,
 * deleting, moving, or re-parenting a RealNex record UNEXPRESSIBLE here — see the module header.
 *
 * `objectKey` is the EXISTING parent (company or contact) to attach the History to; the parent's
 * own fields are never sent and never change. Returns the raw response text (POST .../history is
 * documented "(no schema)" and may return an empty or non-JSON body on success).
 */
export async function realnexAppendObjectHistory<T>(objectKey: string, body: unknown, opts: PostOpts = {}): Promise<T> {
  const key = requireKey();
  const path = `/api/v1/Crm/object/${encodeURIComponent(objectKey)}/history`;
  const res = await fetch(buildUrl(path), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'hoeck-team-dashboard/realnex (CBRE)',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new RealNexApiError(res.status, text, `POST ${path}`);
  }
  if (!text) return undefined as unknown as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

/**
 * PRIVATE shared POST helper — auth + a JSON body + ProblemDetails-aware errors. NOT exported: the
 * only POSTs that exist in this module are realnexAppendObjectHistory + the two create primitives
 * below, and EACH hardcodes its own path. This helper takes a path, but nothing outside this file can
 * reach it, so a caller-supplied path or a general write remains impossible. The body is passed
 * through verbatim (the wrapper builds it camelCase); this helper never reshapes keys.
 */
async function postJson<T>(path: string, body: unknown, opts: PostOpts = {}): Promise<T> {
  const key = requireKey();
  const res = await fetch(buildUrl(path), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'hoeck-team-dashboard/realnex (CBRE)',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
  });
  const text = await res.text();
  if (!res.ok) {
    let problem: RealNexProblemDetails | undefined;
    try {
      const p = JSON.parse(text);
      if (p && typeof p === 'object') problem = p as RealNexProblemDetails;
    } catch {
      /* non-JSON error body — leave problem undefined, bodyHead still carries the raw text */
    }
    throw new RealNexApiError(res.status, text, `POST ${path}`, problem);
  }
  if (!text) return undefined as unknown as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

function requireCreatedKey(created: { key?: string } | undefined, kind: string): string {
  const k = created?.key;
  if (typeof k !== 'string' || !k) {
    throw new Error(`RealNex create ${kind}: 2xx response carried no record key — cannot confirm the create`);
  }
  return k;
}

/**
 * CREATE a new Company — POST /api/v1/Crm/company (operationId PostCompanyAsync). The path is a FIXED
 * string literal (never composed from input); the body is the camelCase `CreateCompany` model built
 * by the safe wrapper. RealNex responds 202 + the created Company (incl. its new `key`); we return
 * just the key. This is a create — it adds a NEW top-level record and touches no existing record.
 */
export async function postCompany(body: CreateCompany): Promise<{ key: string }> {
  const created = await postJson<{ key?: string }>('/api/v1/Crm/company', body); // PostCompanyAsync
  return { key: requireCreatedKey(created, 'company') };
}

/**
 * CREATE a new Contact — POST /api/v1/Crm/contact (operationId PostContactAsync). Fixed path literal;
 * camelCase `CreateContact` body (with `companyKey` set INLINE for the parent link). Returns the new
 * contact key from the 202 response. A create — adds a NEW record, edits nothing.
 */
export async function postContact(body: CreateContact): Promise<{ key: string }> {
  const created = await postJson<{ key?: string }>('/api/v1/Crm/contact', body); // PostContactAsync
  return { key: requireCreatedKey(created, 'contact') };
}
