/**
 * Map a create-wrapper failure to an HTTP response (shared by the company + contact create routes).
 *   • RealNexValidationError (business guard) → 400 field-level
 *   • RealNexNotConfiguredError               → 503
 *   • RealNexApiError 4xx                      → passthrough that status (surfacing .problem)
 *   • RealNexApiError 5xx / ambiguous no-key   → 502 (surfacing .problem)
 * Never a bare 500 for a RealNex / validation failure.
 */
import { NextResponse } from 'next/server';
import { RealNexApiError, RealNexNotConfiguredError, RealNexValidationError } from '@/lib/external/realnex/client';

export function mapCreateError(err: unknown): NextResponse {
  if (err instanceof RealNexValidationError) {
    return NextResponse.json({ error: 'invalid_input', field: err.field, message: err.message }, { status: 400 });
  }
  if (err instanceof RealNexNotConfiguredError) {
    return NextResponse.json({ error: 'realnex_not_configured', message: err.message }, { status: 503 });
  }
  if (err instanceof RealNexApiError) {
    const status = err.status >= 400 && err.status < 500 ? err.status : 502; // 4xx passthrough, 5xx → 502
    return NextResponse.json({ error: 'realnex_write_failed', status: err.status, problem: err.problem ?? null, message: err.message }, { status });
  }
  // Ambiguous (e.g. a 2xx with no key) or unexpected upstream issue — 502, never a bare 500.
  console.error('[realnex-create] unexpected create failure:', err);
  return NextResponse.json({ error: 'create_failed', message: err instanceof Error ? err.message : 'unknown' }, { status: 502 });
}
