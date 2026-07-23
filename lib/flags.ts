/**
 * Runtime feature flags — read SERVER-SIDE only (process.env), never a NEXT_PUBLIC build-time var, so
 * toggling a flag is a runtime env change (Railway var + restart), not a rebuild. The value reaches
 * client components via the (dashboard) layout → FeatureFlagsProvider (server-read → prop → context);
 * the create routes read it directly to 404 when off.
 */

/**
 * P3.7/P3.8 "Add Company / Add Contact". Default OFF — the create UI + routes ship DARK until this is
 * explicitly set (REALNEX_CREATE_ENABLED=true|1|on|yes). With it off: the Add buttons don't render AND
 * the create routes 404 before any auth/validation, so there is no reachable write path.
 */
export function isRealnexCreateEnabled(): boolean {
  const v = (process.env.REALNEX_CREATE_ENABLED ?? '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'on' || v === 'yes';
}
