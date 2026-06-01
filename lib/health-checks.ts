/**
 * Health-check primitives — shared by /api/health AND scripts/health-check.ts.
 *
 * Lessons applied:
 *   - inbound-tracker commit `a91bc7f` retrofitted /api/debug to diagnose volume mount
 *     issues IN PRODUCTION, after the fact. We ship the equivalent diagnostics on day 1
 *     so we never have to debug blind.
 *   - Postgres connectivity gracefully degrades to "yellow" when run from a dev host that
 *     can't reach the public DB proxy (CBRE corp firewall blocks TCP 51241). On Railway
 *     itself, the same check is "hard red" if it fails. The `RAILWAY_ENVIRONMENT` env var
 *     distinguishes the two contexts.
 *
 * Each check returns one Result; the aggregate is healthy iff all checks are 'ok' or 'warn'.
 */

import { execSync } from 'node:child_process';
import { sql } from 'drizzle-orm';
import { db } from './db';

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'not_configured';

export interface CheckResult {
  name: string;
  status: CheckStatus;
  detail?: string;
  metadata?: Record<string, unknown>;
}

const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'SESSION_PASSWORD',
] as const;

const OPTIONAL_ENV_VARS = [
  'REALNEX_API_KEY',
  'REALNEX_API_BASE_URL',
  'BOX_CLIENT_ID',
  'BOX_CLIENT_SECRET',
  'BOX_ACCESS_TOKEN',
  'BOX_REFRESH_TOKEN',
  'BOX_TENANTS_CHAPMANHOECK_FOLDER_ID',
  'BOX_MASTER_EXCEL_FILE_ID',
  'ANTHROPIC_API_KEY',
] as const;

export async function checkEnvVars(): Promise<CheckResult> {
  const missing = REQUIRED_ENV_VARS.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    return {
      name: 'env_vars',
      status: 'fail',
      detail: `missing required: ${missing.join(', ')}`,
    };
  }
  const optionalMissing = OPTIONAL_ENV_VARS.filter((k) => !process.env[k]);
  return {
    name: 'env_vars',
    status: optionalMissing.length > 0 ? 'warn' : 'ok',
    detail:
      optionalMissing.length > 0
        ? `optional missing: ${optionalMissing.join(', ')} (expected during Phases 2-5)`
        : 'all env vars set',
    metadata: { required_present: REQUIRED_ENV_VARS.length, optional_missing: optionalMissing.length },
  };
}

export async function checkPostgres(): Promise<CheckResult> {
  if (!process.env.DATABASE_URL) {
    return { name: 'postgres', status: 'fail', detail: 'DATABASE_URL not set' };
  }

  const isProductionRailway = process.env.RAILWAY_ENVIRONMENT === 'production';

  // IMPORTANT: Reuse the shared singleton pool from lib/db. Do NOT create a new Pool here.
  // The original implementation created a new Pool on every call, and TanStack Query polls
  // /api/health every ~15 s, leaking one connection per call. Within ~5 min Postgres
  // rejected new connections with error code 53300 ("sorry, too many clients already"),
  // which then masked unrelated query failures (e.g. the Box walker insert) as the same
  // "too many clients" error.
  // See docs/LESSONS_LEARNED.md "Phase 2 — Postgres connection pool leak".

  try {
    const verResult = await db.execute(sql`SELECT version()`);
    const verRow = (verResult.rows[0] ?? {}) as { version?: string };
    const sizeResult = await db.execute(sql`SELECT pg_database_size(current_database()) AS size`);
    const sizeRow = (sizeResult.rows[0] ?? {}) as { size?: string | number };

    return {
      name: 'postgres',
      status: 'ok',
      detail: 'reachable',
      metadata: {
        version: verRow.version ? verRow.version.split(/\s+/, 2).join(' ') : '(unknown)',
        database_size_bytes: sizeRow.size !== undefined ? Number(sizeRow.size) : null,
        project: process.env.RAILWAY_PROJECT_NAME ?? '(local)',
        environment: process.env.RAILWAY_ENVIRONMENT ?? '(local)',
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // On dev hosts where the public proxy is firewall-blocked (CBRE corp), this is expected
    // and not a real failure. On Railway, same error = real outage.
    if (!isProductionRailway && /ETIMEDOUT|ECONNREFUSED|ENETUNREACH|timeout/i.test(msg)) {
      return {
        name: 'postgres',
        status: 'warn',
        detail: 'unreachable from dev host (expected on CBRE corp network; deploys still migrate via Railway)',
        metadata: { error: msg, environment: process.env.RAILWAY_ENVIRONMENT ?? '(local)' },
      };
    }
    return { name: 'postgres', status: 'fail', detail: msg };
  }
}

export async function checkRealNex(): Promise<CheckResult> {
  if (!process.env.REALNEX_API_KEY) {
    return {
      name: 'realnex',
      status: 'not_configured',
      detail: 'REALNEX_API_KEY not set — wired in Phase 3',
    };
  }
  // Phase 3: real ping. For now, presence of the key is enough.
  return {
    name: 'realnex',
    status: 'warn',
    detail: 'key present but live ping not implemented until Phase 3',
  };
}

export async function checkBox(): Promise<CheckResult> {
  if (!process.env.BOX_ACCESS_TOKEN) {
    return {
      name: 'box',
      status: 'not_configured',
      detail: 'BOX_ACCESS_TOKEN not set — wired in Phase 2',
    };
  }
  return {
    name: 'box',
    status: 'warn',
    detail: 'token present but live ping not implemented until Phase 2',
  };
}

export async function checkBoxRootFolder(): Promise<CheckResult> {
  if (!process.env.BOX_TENANTS_CHAPMANHOECK_FOLDER_ID) {
    return {
      name: 'box_root_folder',
      status: 'not_configured',
      detail: 'BOX_TENANTS_CHAPMANHOECK_FOLDER_ID not set — wired in Phase 2',
    };
  }
  return { name: 'box_root_folder', status: 'warn', detail: 'live check pending Phase 2' };
}

export async function checkMasterExcelFile(): Promise<CheckResult> {
  if (!process.env.BOX_MASTER_EXCEL_FILE_ID) {
    return {
      name: 'master_excel',
      status: 'not_configured',
      detail: 'BOX_MASTER_EXCEL_FILE_ID not set — wired in Phase 4',
    };
  }

  // Live probe: pick the most-recently-refreshed user_box_tokens row and call
  // runSmoke as that user. Same pattern the sync cron uses for the walker —
  // we don't bake in a "service identity," we use a real user's Box token.
  // If nobody has connected Box yet, fall back to a warn-not-an-error.
  let userId: string;
  try {
    const { and, desc, isNull } = await import('drizzle-orm');
    const { userBoxTokens } = await import('./db/schema');
    const candidates = await db
      .select({ userId: userBoxTokens.userId })
      .from(userBoxTokens)
      .where(and(isNull(userBoxTokens.deletedAt)))
      .orderBy(desc(userBoxTokens.updatedAt))
      .limit(1);
    if (candidates.length === 0) {
      return {
        name: 'master_excel',
        status: 'warn',
        detail: 'No Box-connected user — live probe skipped. Click Connect Box on /files to enable.',
      };
    }
    userId = candidates[0].userId;
  } catch (err) {
    return {
      name: 'master_excel',
      status: 'warn',
      detail: `Couldn't query user_box_tokens for live probe: ${err instanceof Error ? err.message : 'unknown'}`,
    };
  }

  try {
    const { runSmoke } = await import('./external/master-excel/safe');
    const result = await runSmoke(userId);
    return {
      name: 'master_excel',
      status: 'ok',
      detail: 'reachable — file opens cleanly',
      metadata: {
        box_file_id: result.source.boxFileId,
        file_name: result.source.fileName,
        etag: result.source.etag,
        box_modified_at: result.source.boxModifiedAt,
        sheet_count: result.sheetCount,
        sheet_names: result.sheetNames,
        primary_sheet: result.primarySheet,
        primary_row_count: result.primaryRowCount,
        cache_hit: result.source.cacheHit,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name: 'master_excel',
      status: 'warn',
      detail: `Live probe failed: ${msg.slice(0, 200)}`,
      metadata: { box_file_id: process.env.BOX_MASTER_EXCEL_FILE_ID, error: msg.slice(0, 500) },
    };
  }
}

export async function checkAnthropic(): Promise<CheckResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      name: 'anthropic',
      status: 'not_configured',
      detail: 'ANTHROPIC_API_KEY not set — wired in Phase 3',
    };
  }
  return { name: 'anthropic', status: 'warn', detail: 'live check pending Phase 3' };
}

export async function checkPythonBridge(): Promise<CheckResult> {
  try {
    const py = execSync('python --version', { encoding: 'utf-8', timeout: 5_000 }).trim();
    let openpyxl = 'missing';
    try {
      openpyxl = execSync('python -c "import openpyxl; print(openpyxl.__version__)"', {
        encoding: 'utf-8',
        timeout: 5_000,
      }).trim();
    } catch {
      return {
        name: 'python_bridge',
        status: 'warn',
        detail: 'python OK but openpyxl missing — `pip install openpyxl` (used in Phase 4)',
        metadata: { python: py },
      };
    }
    return {
      name: 'python_bridge',
      status: 'ok',
      detail: 'python + openpyxl present',
      metadata: { python: py, openpyxl },
    };
  } catch {
    return {
      name: 'python_bridge',
      status: 'warn',
      detail: 'python not on PATH — required in Phase 4 for Master Excel reads/appends',
    };
  }
}

export async function runAllChecks(): Promise<CheckResult[]> {
  return Promise.all([
    checkEnvVars(),
    checkPostgres(),
    checkRealNex(),
    checkBox(),
    checkBoxRootFolder(),
    checkMasterExcelFile(),
    checkAnthropic(),
    checkPythonBridge(),
  ]);
}

export function aggregateStatus(checks: CheckResult[]): {
  status: 'healthy' | 'degraded' | 'unhealthy';
  failed: number;
  warned: number;
  ok: number;
} {
  const ok = checks.filter((c) => c.status === 'ok').length;
  const warned = checks.filter((c) => c.status === 'warn' || c.status === 'not_configured').length;
  const failed = checks.filter((c) => c.status === 'fail').length;
  return {
    status: failed > 0 ? 'unhealthy' : warned > 0 ? 'degraded' : 'healthy',
    failed,
    warned,
    ok,
  };
}
