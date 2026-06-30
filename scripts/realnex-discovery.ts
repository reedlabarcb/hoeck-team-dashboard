/**
 * scripts/realnex-discovery.ts — read-only RealNex API enumeration.
 *
 * Goal: figure out which base URL the JWT in REALNEX_API_KEY belongs to,
 * which endpoints respond, and what their response shapes look like — without
 * making any mutating request, and without echoing the JWT itself anywhere.
 *
 * Safety rules baked in:
 *   - GET only. No POST/PUT/PATCH/DELETE. Verified by the allow-list `ALLOWED_METHOD`
 *     constant — there is no function that accepts a different method.
 *   - Per-endpoint result cap: limit=1 in the query string + a 50-record JSON guard
 *     after parsing. If a response contains >50 items in any array field, we
 *     truncate before saving.
 *   - Hard request ceiling: MAX_REQUESTS_TOTAL (50). Exceeding it aborts the script.
 *   - JWT only reaches outbound fetch headers. It is never logged, never written
 *     to a saved file, never included in error messages.
 *   - All response bodies write under docs/RealNex_API_Responses/ which is
 *     gitignored (see .gitignore — "RealNex API discovery" block).
 *   - Re-runnable: each run writes a timestamped subdirectory; nothing is overwritten.
 *
 * Usage:
 *   tsx scripts/realnex-discovery.ts
 *
 * Reads:
 *   REALNEX_API_KEY (from .env.local) — the JWT
 * Writes:
 *   docs/RealNex_API_Responses/<run-ts>/<host>/<endpoint>.json
 *   docs/RealNex_API_Responses/<run-ts>/INDEX.md   — human-readable summary
 *
 * Lineage: BUILD_SPEC.md § Phase 3 "RealNex Sync + 4 Workflows".
 */

// CBRE corp proxy: Node's built-in fetch does NOT honor HTTP_PROXY / HTTPS_PROXY
// the way curl does. When on the CBRE corp network we MUST route through the
// local Zscaler proxy or every outbound request fails. When OFF-corp (hotspot,
// home network), the proxy variables are still set in the user env from Zscaler's
// installer but the listener at 127.0.0.1:8081 isn't actually reachable —
// reading them blindly would cause ECONNREFUSED.
//
// Explicit opt-in via HOECK_USE_PROXY:
//   HOECK_USE_PROXY=1                → apply ProxyAgent from HTTPS_PROXY/HTTP_PROXY
//   unset / "0" / "false" / anything → direct connection (use this OFF-corp)
//
// NOTE: as of 2026-06-16 the CBRE Zscaler proxy blocks *.realnex.com with HTTP 500
// on CONNECT, so the proxy path won't actually enumerate successfully until IT
// whitelists the domain. Off-corp + direct is the working path today.
import { ProxyAgent, setGlobalDispatcher } from 'undici';
const wantProxy = ['1', 'true', 'yes'].includes(
  (process.env.HOECK_USE_PROXY ?? '').toLowerCase(),
);
const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
if (wantProxy && proxy) {
  setGlobalDispatcher(new ProxyAgent(proxy));
  console.log(`[proxy] HOECK_USE_PROXY=1 — routing through ${proxy}`);
} else if (wantProxy && !proxy) {
  console.log(
    '[proxy] HOECK_USE_PROXY=1 set but HTTP_PROXY/HTTPS_PROXY env vars empty — falling back to direct.',
  );
} else {
  console.log(
    '[proxy] Direct connection (HOECK_USE_PROXY not set). Use this off-corp. ' +
      'On CBRE corp network, set HOECK_USE_PROXY=1 first.',
  );
}

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// ----- Tunables -----

const ALLOWED_METHOD = 'GET' as const;
const MAX_REQUESTS_TOTAL = 50;
const PER_ENDPOINT_RECORD_CAP = 50;

const CANDIDATE_BASES: string[] = [
  'https://api.realnex.com/v1',
  'https://api.realnex.com/api/v1',
  'https://app.realnex.com/api/v1',
  'https://app.realnex.com/api',
  'https://core.realnex.com/api',
];

// "Likely-harmless" pings — used to detect which base URL accepts the JWT.
// Order matters: cheapest first. Each tested with limit=1.
const SANITY_PINGS: string[] = [
  '/me',
  '/users/me',
  '/account',
  '/companies?limit=1',
];

// Once a base responds 200, enumerate these. Each gets limit=1.
const FULL_ENUMERATION: string[] = [
  '/me',
  '/users/me',
  '/account',
  '/companies?limit=1',
  '/contacts?limit=1',
  '/activities?limit=1',
  '/history?limit=1',
  '/groups?limit=1',
  '/users?limit=1',
  '/properties?limit=1',
  '/listings?limit=1',
  '/deals?limit=1',
];

// ----- Helpers -----

function nowIso(): string {
  return new Date().toISOString();
}

function safePathSegment(s: string): string {
  // Convert a URL path into a filesystem-safe filename segment.
  return s.replace(/^\//, '').replace(/[^a-z0-9_-]/gi, '_') || 'root';
}

function describeShape(value: unknown, depth = 0): unknown {
  // Returns a structural description (keys + types) WITHOUT including values.
  // Used so we can log shape evidence without exposing PII.
  if (value === null) return 'null';
  if (depth > 4) return '…(truncated depth)';
  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    return [describeShape(value[0], depth + 1), `…+${value.length - 1} items`];
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = describeShape(v, depth + 1);
    }
    return out;
  }
  return typeof value;
}

function truncateArrays(value: unknown, cap: number): unknown {
  // Defensive: even though we pass limit=1, if any endpoint ignores the param
  // and returns a huge array, we clamp here BEFORE writing to disk.
  if (Array.isArray(value)) {
    return value.slice(0, cap).map((v) => truncateArrays(v, cap));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = truncateArrays(v, cap);
    }
    return out;
  }
  return value;
}

interface ProbeResult {
  base: string;
  path: string;
  url: string;
  status: number;
  durationMs: number;
  ok: boolean;
  contentType: string | null;
  bodyHead: string;
  parsedShape?: unknown;
  // Path to saved JSON sample on disk (only set if status===200 and body parsed as JSON).
  savedAt?: string;
  error?: string;
}

let requestCount = 0;

async function probe(
  base: string,
  path: string,
  jwt: string,
  runDir: string,
): Promise<ProbeResult> {
  if (requestCount >= MAX_REQUESTS_TOTAL) {
    return {
      base,
      path,
      url: `${base}${path}`,
      status: 0,
      durationMs: 0,
      ok: false,
      contentType: null,
      bodyHead: '',
      error: `MAX_REQUESTS_TOTAL (${MAX_REQUESTS_TOTAL}) reached — aborting further probes`,
    };
  }

  const url = `${base}${path}`;
  const startedAt = Date.now();
  let status = 0;
  let contentType: string | null = null;
  let textBody = '';
  let parsed: unknown = undefined;
  let parseError: string | undefined;

  requestCount++;
  try {
    const res = await fetch(url, {
      method: ALLOWED_METHOD,
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/json',
        // RealNex-specific User-Agent so they can recognize this as discovery
        // traffic in their logs.
        'User-Agent': 'hoeck-team-dashboard/realnex-discovery (Reed LaBar, CBRE)',
      },
      // 15s timeout — RealNex APIs should be sub-second normally.
      signal: AbortSignal.timeout(15_000),
    });
    status = res.status;
    contentType = res.headers.get('content-type');
    textBody = await res.text();
    if (contentType && contentType.includes('json')) {
      try {
        parsed = JSON.parse(textBody);
      } catch (e) {
        parseError = e instanceof Error ? e.message : String(e);
      }
    }
  } catch (e) {
    return {
      base,
      path,
      url,
      status: 0,
      durationMs: Date.now() - startedAt,
      ok: false,
      contentType: null,
      bodyHead: '',
      error: e instanceof Error ? e.message : String(e),
    };
  }

  const durationMs = Date.now() - startedAt;
  const ok = status >= 200 && status < 300;

  const result: ProbeResult = {
    base,
    path,
    url,
    status,
    durationMs,
    ok,
    contentType,
    bodyHead: textBody.slice(0, 500),
    error: parseError,
  };

  if (ok && parsed !== undefined) {
    const truncated = truncateArrays(parsed, PER_ENDPOINT_RECORD_CAP);
    result.parsedShape = describeShape(truncated);

    // Save the (truncated) JSON for human inspection later.
    const baseHostDir = resolve(runDir, safePathSegment(new URL(base).host + new URL(base).pathname));
    await mkdir(baseHostDir, { recursive: true });
    const filename = `${safePathSegment(path)}.json`;
    const fullPath = resolve(baseHostDir, filename);
    await writeFile(fullPath, JSON.stringify(truncated, null, 2), 'utf8');
    result.savedAt = fullPath;
  }

  return result;
}

function logResult(r: ProbeResult): void {
  // Single-line console log. JWT is NEVER printed.
  const head = r.bodyHead.replace(/\s+/g, ' ').slice(0, 120);
  console.log(
    `[${nowIso()}] ${ALLOWED_METHOD} ${r.url}  → HTTP ${r.status}` +
      (r.durationMs ? ` (${r.durationMs}ms)` : '') +
      (r.contentType ? `  ct=${r.contentType.split(';')[0]}` : '') +
      (r.error ? `  ERR=${r.error}` : '') +
      `  head=${JSON.stringify(head)}`,
  );
}

async function main(): Promise<void> {
  const jwt = process.env.REALNEX_API_KEY;
  if (!jwt || jwt.trim().length < 10) {
    console.error(
      '[realnex-discovery] REALNEX_API_KEY missing or too short in .env.local. Aborting before any network call.',
    );
    process.exit(2);
  }

  const runTs = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = resolve(process.cwd(), 'docs', 'RealNex_API_Responses', runTs);
  await mkdir(runDir, { recursive: true });
  console.log(`[realnex-discovery] run directory: ${runDir}`);
  console.log(
    `[realnex-discovery] safety: ${ALLOWED_METHOD}-only, max ${MAX_REQUESTS_TOTAL} requests, per-endpoint cap ${PER_ENDPOINT_RECORD_CAP} records`,
  );
  console.log('');

  const allResults: ProbeResult[] = [];

  // Phase 1: find a base URL that accepts the JWT.
  let workingBase: string | null = null;
  for (const base of CANDIDATE_BASES) {
    if (workingBase) break;
    if (requestCount >= MAX_REQUESTS_TOTAL) break;

    for (const path of SANITY_PINGS) {
      const r = await probe(base, path, jwt, runDir);
      allResults.push(r);
      logResult(r);
      if (r.error?.includes('MAX_REQUESTS_TOTAL')) break;
      if (r.status === 429) {
        console.error(`[realnex-discovery] HTTP 429 from ${r.url} — rate limited. Aborting.`);
        break;
      }
      if (r.ok) {
        workingBase = base;
        console.log(`[realnex-discovery] ✓ working base detected: ${base} (via ${path})`);
        break;
      }
    }
  }

  // Phase 2: if we found a working base, enumerate endpoints.
  if (workingBase) {
    console.log('');
    console.log(`[realnex-discovery] enumerating endpoints under ${workingBase}…`);
    for (const path of FULL_ENUMERATION) {
      if (requestCount >= MAX_REQUESTS_TOTAL) break;
      const r = await probe(workingBase, path, jwt, runDir);
      allResults.push(r);
      logResult(r);
      if (r.status === 429) {
        console.error(`[realnex-discovery] HTTP 429 — rate limited. Aborting enumeration.`);
        break;
      }
    }
  } else {
    console.log('');
    console.log('[realnex-discovery] no base URL accepted the JWT — see results above.');
  }

  // Phase 3: write the index (human-readable summary).
  const indexLines: string[] = [];
  indexLines.push('# RealNex Discovery — Run Index');
  indexLines.push('');
  indexLines.push(`- Timestamp: ${runTs}`);
  indexLines.push(`- Total HTTP requests: ${requestCount} / ${MAX_REQUESTS_TOTAL}`);
  indexLines.push(`- Working base URL: ${workingBase ?? '(none detected)'}`);
  indexLines.push('');
  indexLines.push('## Per-request results');
  indexLines.push('');
  indexLines.push('| Status | Base | Path | ms | Content-Type | Saved? |');
  indexLines.push('|-------:|------|------|---:|--------------|--------|');
  for (const r of allResults) {
    indexLines.push(
      `| ${r.status} | ${r.base} | ${r.path} | ${r.durationMs} | ${r.contentType ?? '—'} | ${r.savedAt ? '✓' : '—'} |`,
    );
  }
  indexLines.push('');
  indexLines.push('## Shapes (200 responses only)');
  indexLines.push('');
  for (const r of allResults) {
    if (!r.ok || !r.parsedShape) continue;
    indexLines.push(`### ${r.path}`);
    indexLines.push('```json');
    indexLines.push(JSON.stringify(r.parsedShape, null, 2));
    indexLines.push('```');
    indexLines.push('');
  }
  const indexPath = resolve(runDir, 'INDEX.md');
  await writeFile(indexPath, indexLines.join('\n'), 'utf8');
  console.log('');
  console.log(`[realnex-discovery] wrote ${indexPath}`);
  console.log(`[realnex-discovery] total requests: ${requestCount}`);
  console.log('[realnex-discovery] done.');
}

main().catch((err) => {
  // Never include the JWT in error output, even on uncaught throws.
  console.error('[realnex-discovery] failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
