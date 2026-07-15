/**
 * Master Query export bridge (P3.11). `buildExportRows` flattens mirror rows into a clean, xlsx-ready
 * shape — the per-entity casing extraction (company city/state columns vs contact address->>'City'/'State'
 * PascalCase, group Names, one-line address) lives HERE, where the casing discipline belongs, so the
 * Python script stays a dumb formatter. `generateQueryWorkbook` spawns scripts/python/query_export.py
 * (openpyxl) via a temp JSON file (never argv). READ-ONLY.
 */

import { spawn } from 'node:child_process';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { contactDisplayName, formatAddress } from './format';
import { QUERY_FLAG_KEYS, type QueryEntity, type QueryFlag } from './query-filters';

type Row = Record<string, unknown>;

export interface ExportRecord {
  name: string;
  company: string;
  title: string;
  leaseExpiry: string | null; // 'YYYY-MM-DD' → a real Excel date cell
  sqFt: number | null; // → a real Excel integer cell
  city: string;
  state: string;
  address: string;
  groups: string[];
  flags: Record<QueryFlag, boolean>;
}

const s = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

/** Flatten mirror rows → export records. Pure; the one place the per-entity casing asymmetry is applied. */
export function buildExportRows(rows: Row[], entity: QueryEntity): ExportRecord[] {
  return rows.map((r) => {
    const addr = (r.address ?? {}) as Record<string, unknown>;
    return {
      name: entity === 'companies' ? s(r.name) || '(unnamed)' : contactDisplayName(r as never),
      company: entity === 'contacts' ? s(r.companyName) : '',
      title: entity === 'contacts' ? s(r.title) : '',
      leaseExpiry: r.leaseExpiry ? s(r.leaseExpiry).slice(0, 10) : null,
      sqFt: typeof r.sqFt === 'number' ? r.sqFt : null,
      city: entity === 'companies' ? s(r.city) : s(addr.City), // contacts: PascalCase jsonb key
      state: entity === 'companies' ? s(r.state) : s(addr.State),
      address: formatAddress(r.address),
      groups: Array.isArray(r.objectGroups)
        ? (r.objectGroups as Array<Record<string, unknown>>).map((g) => (typeof g?.Name === 'string' ? g.Name : null)).filter((x): x is string => !!x)
        : [],
      flags: Object.fromEntries(QUERY_FLAG_KEYS.map((k) => [k, !!r[k]])) as Record<QueryFlag, boolean>,
    };
  });
}

export interface ExportPayload {
  entity: QueryEntity;
  generatedDate: string;
  records: ExportRecord[];
}

const PY_SCRIPT = resolve(process.cwd(), 'scripts/python/query_export.py');
const PYTHON_BIN = process.env.PYTHON_BIN || 'python';

/** Spawn the openpyxl script with the payload via a temp file; return the .xlsx bytes. */
export async function generateQueryWorkbook(payload: ExportPayload): Promise<Buffer> {
  const uniq = `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const dataPath = join(tmpdir(), `mq-export-${uniq}.json`);
  const outPath = join(tmpdir(), `mq-export-${uniq}.xlsx`);
  await writeFile(dataPath, JSON.stringify(payload), 'utf8');
  try {
    await runScript([PY_SCRIPT, '--data-path', dataPath, '--out-path', outPath]);
    return await readFile(outPath);
  } finally {
    await Promise.all([unlink(dataPath).catch(() => {}), unlink(outPath).catch(() => {})]);
  }
}

function runScript(args: string[]): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(PYTHON_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString('utf8')));
    child.on('error', rejectPromise);
    child.on('close', (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`query_export.py exited ${code}. stderr: ${stderr.slice(0, 500)}`));
    });
  });
}
