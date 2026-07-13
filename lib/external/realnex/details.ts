/**
 * Pure extractors for the P3.6 DETAILS WALK — pull Square Footage + Lease Expiration out of the
 * per-record /full reads. No DB, no network — unit-tested in details.test.ts.
 *
 * Field locations confirmed against the live API (see reference_realnex_lxd_sf_custom_fields):
 *   company /full:  details.currentSf                     -> sqFt
 *                   details.userDataFields.userDate1      -> leaseExpiry  (VERIFIED = LXD)
 *   contact /full:  tenantData.space.sqFt                 -> sqFt
 *                   tenantData.space.leaseExpiry          -> leaseExpiry
 * These come from the camelCase /Crm company + contact full reads.
 */

export interface RealnexDetail {
  /** Positive integer square footage, or null when absent/zero/unparseable. */
  sqFt: number | null;
  /** Lease expiration as a 'YYYY-MM-DD' string, or null. */
  leaseExpiry: string | null;
}

/**
 * Parse a RealNex lease-expiration value to 'YYYY-MM-DD'. RealNex stores a naive datetime string
 * ("2027-04-30T00:00:00"); we take the DATE PART directly (string slice) rather than via `new
 * Date`, so a timezone offset can never shift it a day. Falls back to Date parsing for other
 * shapes. Returns null for empty/unparseable input.
 */
export function parseLeaseExpiry(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); // ISO / ISO-naive → take Y-M-D verbatim
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    const d = new Date(s); // tolerate other formats (e.g. "4/30/2027")
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return null;
  }
  return null;
}

/** Parse square footage to a positive integer, or null. Strips commas/spaces from strings. */
export function parseSqFt(v: unknown): number | null {
  let n: number;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string') n = parseInt(v.replace(/[, ]/g, ''), 10);
  else return null;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** Extract SF + LXD from a company /full read (details.currentSf + details.userDataFields.userDate1). */
export function extractCompanyDetail(full: unknown): RealnexDetail {
  const details = (full as { details?: Record<string, unknown> } | null)?.details;
  const udf = (details as { userDataFields?: Record<string, unknown> } | undefined)?.userDataFields;
  return {
    sqFt: parseSqFt((details as { currentSf?: unknown } | undefined)?.currentSf),
    leaseExpiry: parseLeaseExpiry((udf as { userDate1?: unknown } | undefined)?.userDate1),
  };
}

/** Extract SF + LXD from a contact /full read (tenantData.space.sqFt + .leaseExpiry). */
export function extractContactDetail(full: unknown): RealnexDetail {
  const space = (full as { tenantData?: { space?: Record<string, unknown> } } | null)?.tenantData?.space;
  return {
    sqFt: parseSqFt((space as { sqFt?: unknown } | undefined)?.sqFt),
    leaseExpiry: parseLeaseExpiry((space as { leaseExpiry?: unknown } | undefined)?.leaseExpiry),
  };
}
