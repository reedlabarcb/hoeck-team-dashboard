/**
 * Next.js instrumentation hook.
 *
 * Runs `register()` exactly once per server-process boot — before any route handler
 * is invoked. Perfect place for boot-time housekeeping that must NOT run per-request.
 *
 * What we do here:
 *   1. Mark orphaned box_sync_jobs as failed (status='running' AND stale updated_at).
 *      Lineage: the in-process walker doesn't survive Railway redeploys.
 *      docs/LESSONS_LEARNED.md will pick this up if a redeploy ever interrupts work.
 *      Phase 2.5a: this also covers `job_type='text_extraction'` jobs — the
 *      recovery query is intentionally type-agnostic so both worker kinds
 *      get the same crash safety. The log line reports per-type counts.
 *
 * Constraints:
 *   - Failure here must NOT crash the server. Log loudly and continue.
 *   - This file is run by both `next dev` and `next start` — keep it safe for both.
 *   - `nodejs` runtime only (not edge), so we can import server-side modules freely.
 */

export async function register() {
  // Avoid importing server-side modules at the top level — that runs on every code-path,
  // including the edge runtime. Importing inline keeps this hook nodejs-only.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  try {
    const { markOrphanedJobsAsFailed } = await import('@/lib/external/box/orphan-recovery');
    const result = await markOrphanedJobsAsFailed();
    if (result.marked > 0) {
      const breakdown = Object.entries(result.byType)
        .map(([t, n]) => `${t}=${n}`)
        .join(' ');
      console.log(
        `[boot] Marked ${result.marked} orphaned sync jobs as failed (${breakdown}): ${result.jobIds.join(', ')}`,
      );
    } else {
      console.log('[boot] No orphaned sync jobs to recover.');
    }
  } catch (err) {
    // Never crash the server on startup hook failures. Log and continue.
    console.error('[boot] orphan-recovery failed (continuing anyway):', err);
  }
}
