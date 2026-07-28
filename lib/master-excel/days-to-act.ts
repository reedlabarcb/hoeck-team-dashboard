/**
 * "Days to Act" — whole calendar days from TODAY until a lease's renewal window CLOSES
 * (renewalWindowEnd ← the CLIENTS sheet's "OPTION DATES CLOSE" column).
 *
 * Client-safe + pure (no DB, no network, no date library) so it unit-tests without jsdom and can be
 * computed at RENDER time. Render-time matters: the parsed xlsx is cached (Box etag TTL), so a value
 * baked in at parse time would go stale — "today" has to be read when the card paints.
 *
 * Why date-ONLY math: both sides are normalized to LOCAL MIDNIGHT before the diff, so the answer is
 * whole calendar days and can't drift by one across a timezone offset or a DST boundary. The date part
 * is taken from the ISO string verbatim (same lesson as lib/external/realnex/details.ts parseLeaseExpiry:
 * `new Date("2026-08-28")` is UTC midnight and can render as the 27th west of Greenwich).
 *
 * A PAST window is never hidden or clamped to 0 — an already-closed renewal window is the most urgent
 * thing on a critical-date tool, so negatives are first-class and are INCLUDED in the "under N days"
 * buckets (a closed window outranks one with 60 days left).
 */

/** Local-midnight Date from an ISO-ish string ("2026-08-28" / "2026-08-28T00:00:00"), or null. */
function toLocalMidnight(s: string): Date | null {
  const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])); // Y-M-D verbatim → local
  const d = new Date(s); // tolerate other shapes (e.g. "8/28/2026")
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Whole calendar days from `now` until `iso`. Positive = still open, 0 = closes today,
 * NEGATIVE = window already closed. null when there's no parseable date (caller renders "—").
 */
export function daysToAct(iso: string | null | undefined, now: Date = new Date()): number | null {
  if (!iso) return null;
  const target = toLocalMidnight(iso);
  if (!target) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // Math.round (not floor/ceil): after midnight-normalization the quotient is a whole number except
  // for the ±1h DST wobble, which rounding absorbs.
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/** Human label. Past stays VISIBLE and explicit; null reads as "none", never blank. */
export function formatDaysToAct(days: number | null): string {
  if (days === null) return '—';
  if (days === 0) return 'due today';
  if (days > 0) return days === 1 ? '1 day' : `${days} days`;
  const ago = -days;
  return ago === 1 ? 'window closed (1 day ago)' : `window closed (${ago} days ago)`;
}

/** Urgency band, for styling. `closed` is the loudest — the window is already gone. */
export type DaysUrgency = 'none' | 'closed' | 'urgent' | 'soon' | 'ok';

export function daysUrgency(days: number | null): DaysUrgency {
  if (days === null) return 'none';
  if (days < 0) return 'closed';
  if (days <= 30) return 'urgent';
  if (days <= 90) return 'soon';
  return 'ok';
}

/** Filter buckets for the dropdown. '' = Any (the default, the only bucket that keeps null dates). */
export const DAYS_BUCKETS = [
  { value: '', label: 'Any days to act' },
  { value: 'past', label: 'Past due' },
  { value: '30', label: 'Under 30 days' },
  { value: '60', label: 'Under 60 days' },
  { value: '90', label: 'Under 90 days' },
] as const;

export type DaysBucket = (typeof DAYS_BUCKETS)[number]['value'];

/**
 * Does this row's days-to-act fall in the bucket?
 *   ''     → everything (including rows with no renewal-window date)
 *   'past' → ONLY already-closed windows (days < 0)
 *   'N'    → days < N, which DELIBERATELY INCLUDES past-due and due-today. A closed window is more
 *            urgent than one with 60 days left, so excluding negatives would hide exactly the leases
 *            a broker most needs to see.
 * Rows with no renewal-window date (days === null) fall out of every bucket except ''.
 */
export function matchesDaysBucket(days: number | null, bucket: DaysBucket): boolean {
  if (!bucket) return true;
  if (days === null) return false;
  if (bucket === 'past') return days < 0;
  return days < Number(bucket);
}
