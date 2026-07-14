/** Pure UI formatters + client-safe shared types for RealNex UI (P3.5). No DB/DOM — unit-testable. */

/**
 * Shared autocomplete/resolver result shape. `key` is the RealNex OBJECT KEY (realnex_key) —
 * the exact key P3.6 appendActivity POSTs to (/Crm/object/{key}/history). Lives here (not in
 * the server-only queries module) so the <RealNexEntitySearch> client component and the server
 * resolver share ONE definition — the key field must never drift between them.
 */
export interface EntityResult {
  type: 'contact' | 'company';
  key: string;
  displayName: string;
  companyName: string | null;
  email: string | null;
}

/**
 * The detail-page URL for a record: contact → /contacts/[key], company → /companies/[key].
 * The canonical entity→URL mapping — used by the Header global search and the Log Note success
 * link — so a record link resolves to the record, never drifting back to the list. Pure.
 */
export function detailPath(entity: { type: 'contact' | 'company'; key: string }): string {
  const base = entity.type === 'company' ? '/companies' : '/contacts';
  return `${base}/${encodeURIComponent(entity.key)}`;
}

/** Human "5 min ago" style relative time from an ISO string. */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'never';
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const min = Math.round(diffSec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.round(hr / 24);
  return `${day} day${day === 1 ? '' : 's'} ago`;
}

export interface SyncJobLike {
  status: 'queued' | 'running' | 'completed' | 'failed';
  completedAt: string | null;
  triggeredBy: string;
}

/**
 * Badge label for the latest RealNex sync job (or null when none has run).
 * `cron` is shown as "auto" so the user reads it as the nightly job, not a person.
 */
export function syncStatusLabel(job: SyncJobLike | null): string {
  if (!job) return 'Never synced';
  if (job.status === 'queued' || job.status === 'running') return 'Syncing…';
  if (job.status === 'failed') return `Last sync failed (${relativeTime(job.completedAt)})`;
  const who = job.triggeredBy === 'cron' ? 'auto' : job.triggeredBy;
  return `Synced ${relativeTime(job.completedAt)}${who ? ` · ${who}` : ''}`;
}

/** Normalize a website value to an href (prepends https:// when missing). null when blank. */
export function normalizeWebsiteUrl(url: string | null | undefined): string | null {
  const u = (url ?? '').trim();
  if (!u) return null;
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

/** Format a RealNex address jsonb ({address1,address2,city,state,zipCode}) to one line. "" if empty. */
export function formatAddress(addr: unknown): string {
  if (!addr || typeof addr !== 'object') return '';
  const a = addr as Record<string, unknown>;
  const g = (k: string) => (typeof a[k] === 'string' ? (a[k] as string).trim() : '');
  const stateZip = [g('state'), g('zipCode')].filter(Boolean).join(' ');
  return [g('address1'), g('address2'), g('city'), stateZip].filter(Boolean).join(', ');
}

/** Square footage with thousands separators, e.g. 21347 → "21,347". Blank/≤0 → "—". */
export function formatSqFt(sqFt: number | null | undefined): string {
  return typeof sqFt === 'number' && sqFt > 0 ? sqFt.toLocaleString('en-US') : '—';
}

/**
 * Lease expiration 'YYYY-MM-DD' → "MM/DD/YYYY". Blank/invalid → "—". Parsed by string match (NOT
 * `new Date`) so a date-only value never shifts a day across timezones.
 */
export function formatLeaseExpiry(iso: string | null | undefined): string {
  if (!iso) return '—';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : '—';
}

/**
 * A contact's best display name: full_name, else "first last", else a placeholder.
 * Pure + client-safe (no DB import) — used by both the server queries and the /contacts
 * client page, so the "never show a raw key" fallback lives in exactly one place.
 */
export function contactDisplayName(row: { fullName?: string | null; firstName?: string | null; lastName?: string | null }): string {
  if (row.fullName && row.fullName.trim()) return row.fullName.trim();
  const joined = [row.firstName, row.lastName].filter((s) => s && s.trim()).join(' ').trim();
  return joined || '(no name)';
}
