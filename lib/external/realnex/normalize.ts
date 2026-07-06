/**
 * normalizeCompanyName — the SHARED normalization that builds the
 * `company_name_normalized` join key on BOTH sides of the future Master-Excel join
 * (the RealNex mirror here, and the Excel client list in Workflow 4). It MUST be used
 * identically on both sides, or the (already best-effort) join drifts further apart.
 *
 * Rules — deliberately simple + deterministic:
 *   - lowercase
 *   - trim, and collapse internal whitespace runs to a single space
 *   - null for empty/blank input (null-name companies stay null; they don't join)
 *
 * Intentionally does NOT strip punctuation / legal suffixes (Inc, LLC, "&") — that's a
 * fuzzier normalization we may add for Workflow 4, but it must then change on BOTH sides
 * together. Keeping v1 conservative avoids false-positive joins.
 */
export function normalizeCompanyName(name: string | null | undefined): string | null {
  if (!name) return null;
  const n = name.trim().toLowerCase().replace(/\s+/g, ' ');
  return n.length > 0 ? n : null;
}
