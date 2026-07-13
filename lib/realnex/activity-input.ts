/**
 * Validation for POST /api/realnex/activity (P3.6 note-logging Step 2). Pure — no DB, no network
 * — so the allowlist + input rules are unit-tested without mocking the route.
 *
 * The eventTypeKey allowlist is the SIX note-logging types only (REALNEX_EVENT_TYPE) — the route
 * must not be able to write arbitrary RealNex event types.
 */
import { REALNEX_EVENT_TYPE } from '@/lib/external/realnex/types';

/** {18,1,101,15,2,11} — Note / Phone Call / Cold Call / Email / Meeting / Other. */
export const ALLOWED_EVENT_TYPE_KEYS: ReadonlySet<number> = new Set(Object.values(REALNEX_EVENT_TYPE));

export interface ActivityInput {
  objectKey: string;
  objectType: 'contact' | 'company';
  eventTypeKey: number;
  subject: string;
  notes: string;
}

export type ValidationResult =
  | { ok: true; value: ActivityInput }
  | { ok: false; field: string; error: string };

/** Coerce a JSON eventTypeKey to a number ONLY from a number or a numeric string (not booleans). */
function toEventTypeKey(raw: unknown): number {
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string' && raw.trim() !== '') return Number(raw);
  return NaN;
}

/**
 * Derive a subject when none is supplied: the note's first line, trimmed, capped ~80 chars.
 * Step 3 (the Log Note UI) finalizes subject handling; this is a safe server-side fallback so the
 * History always has a headline.
 */
export function deriveSubject(notes: string): string {
  const firstLine = notes.split(/\r?\n/)[0].trim();
  if (!firstLine) return 'Note';
  return firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine;
}

/** Validate + normalize the request body. Returns the clean ActivityInput or the first error. */
export function validateActivityInput(raw: unknown): ValidationResult {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const objectKey = typeof b.objectKey === 'string' ? b.objectKey.trim() : '';
  if (!objectKey) return { ok: false, field: 'objectKey', error: 'objectKey is required' };

  if (b.objectType !== 'contact' && b.objectType !== 'company') {
    return { ok: false, field: 'objectType', error: "objectType must be 'contact' or 'company'" };
  }

  const eventTypeKey = toEventTypeKey(b.eventTypeKey);
  if (!ALLOWED_EVENT_TYPE_KEYS.has(eventTypeKey)) {
    return {
      ok: false,
      field: 'eventTypeKey',
      error: `eventTypeKey must be one of the note-logging types: ${[...ALLOWED_EVENT_TYPE_KEYS].join(', ')}`,
    };
  }

  const notes = typeof b.notes === 'string' ? b.notes.trim() : '';
  if (!notes) return { ok: false, field: 'notes', error: 'notes is required' };

  const subjectRaw = typeof b.subject === 'string' ? b.subject.trim() : '';
  const subject = subjectRaw || deriveSubject(notes);

  return { ok: true, value: { objectKey, objectType: b.objectType, eventTypeKey, subject, notes } };
}
