/**
 * Classify a create-route response into a UX outcome (P3.7/P3.8). Pure — unit-tested. Maps the route
 * contract from app/api/realnex/company|contact/route.ts:
 *   200 → success (even with warnings[])   400 → validation (field-level)   401 → auth (re-auth, safe to retry)
 *   404 → unavailable (feature dark)        503 → not_configured
 *   502 → AMBIGUOUS (RealNex 5xx: the create may or may not have landed — verify before retrying; the
 *         only response where a retry could duplicate, so the UI must NOT offer a one-click retry)
 *   other 4xx (RealNex passthrough) → realnex_error (the create did NOT happen; a corrected retry is safe)
 */

export type CreateOutcome =
  | { kind: 'success'; key: string; warnings: string[] }
  | { kind: 'validation'; field?: string; message: string }
  | { kind: 'auth'; message: string }
  | { kind: 'unavailable'; message: string }
  | { kind: 'not_configured'; message: string }
  | { kind: 'realnex_error'; message: string }
  | { kind: 'ambiguous'; message: string }
  | { kind: 'unknown'; message: string };

/** True when a retry could duplicate the record — the UI must not offer a one-click retry. */
export function retryMayDuplicate(o: CreateOutcome): boolean {
  return o.kind === 'ambiguous';
}

export function classifyCreateResponse(status: number, body: unknown): CreateOutcome {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const problem = (b.problem && typeof b.problem === 'object' ? b.problem : {}) as Record<string, unknown>;
  const detail = (typeof problem.detail === 'string' && problem.detail) || (typeof problem.title === 'string' && problem.title) || (typeof b.message === 'string' && b.message) || '';

  if (status === 200) {
    return { kind: 'success', key: typeof b.key === 'string' ? b.key : '', warnings: Array.isArray(b.warnings) ? (b.warnings as string[]) : [] };
  }
  if (status === 400) {
    return { kind: 'validation', field: typeof b.field === 'string' ? b.field : undefined, message: (typeof b.message === 'string' && b.message) || 'Please fix the highlighted field.' };
  }
  if (status === 401) {
    return { kind: 'auth', message: 'Your session expired. Sign in again, then retry.' };
  }
  if (status === 404) {
    return { kind: 'unavailable', message: 'Adding records isn’t available right now.' };
  }
  if (status === 503) {
    return { kind: 'not_configured', message: 'RealNex isn’t configured — contact the admin.' };
  }
  if (status === 502) {
    return {
      kind: 'ambiguous',
      message: `${detail || 'RealNex had a server error'} — the record MAY have been created. Check RealNex before retrying.`,
    };
  }
  if (status >= 400 && status < 500) {
    return { kind: 'realnex_error', message: detail || `RealNex rejected the request (${status}). Nothing was created — fix and retry.` };
  }
  return { kind: 'unknown', message: (typeof b.message === 'string' && b.message) || `Unexpected error (${status}).` };
}
