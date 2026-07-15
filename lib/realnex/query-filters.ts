/**
 * Master Query (P3.11) — client-safe, PURE filter helpers. NO DB imports, so this is shared by the
 * /query page (client), the /api/realnex/query route (server param parse), and unit tests. The
 * SERVER query layer (queries.ts) imports the filter type + flag list from HERE (one-way dependency),
 * so the flag list is a single source usable on both sides without dragging the db into the bundle.
 */

import { formatLeaseExpiry } from './format';

export type QueryEntity = 'companies' | 'contacts';

/** The 6 RealNex classification booleans (identical columns on companies + contacts). */
export const QUERY_FLAG_KEYS = ['tenant', 'prospect', 'investor', 'agent', 'vendor', 'personal'] as const;
export type QueryFlag = (typeof QUERY_FLAG_KEYS)[number];
/** Labeled list for rendering the checkboxes. */
export const QUERY_FLAGS: { key: QueryFlag; label: string }[] = QUERY_FLAG_KEYS.map((k) => ({
  key: k,
  label: k.charAt(0).toUpperCase() + k.slice(1),
}));

export interface QueryFilters {
  entity: QueryEntity;
  q?: string;
  lxdFrom?: string; // 'YYYY-MM-DD'
  lxdTo?: string;
  sfMin?: number;
  sfMax?: number;
  city?: string;
  state?: string;
  address?: string;
  flags?: QueryFlag[];
  group?: string;
}

export function emptyFilters(entity: QueryEntity = 'companies'): QueryFilters {
  return { entity };
}

/** Rolling lease window from `today`: [today, today + N months], as 'YYYY-MM-DD' (local, no TZ drift). */
export function leaseWindow(months: number, today: Date): { lxdFrom: string; lxdTo: string } {
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const to = new Date(today.getFullYear(), today.getMonth() + months, today.getDate());
  return { lxdFrom: iso(today), lxdTo: iso(to) };
}

/** Filters → query string (for the fetch URL). Only non-empty values are serialized. */
export function filtersToParams(f: QueryFilters): URLSearchParams {
  const p = new URLSearchParams();
  p.set('entity', f.entity);
  if (f.q?.trim()) p.set('q', f.q.trim());
  if (f.lxdFrom) p.set('lxdFrom', f.lxdFrom);
  if (f.lxdTo) p.set('lxdTo', f.lxdTo);
  if (f.sfMin != null) p.set('sfMin', String(f.sfMin));
  if (f.sfMax != null) p.set('sfMax', String(f.sfMax));
  if (f.city?.trim()) p.set('city', f.city.trim());
  if (f.state?.trim()) p.set('state', f.state.trim());
  if (f.address?.trim()) p.set('address', f.address.trim());
  if (f.flags?.length) p.set('flags', f.flags.join(','));
  if (f.group?.trim()) p.set('group', f.group.trim());
  return p;
}

/**
 * Query string → filters. The single place the route turns params into a QueryFilters — parsing EVERY
 * dimension here (and forwarding the whole object to runQuery) is what prevents the param-drift bug
 * that killed the /companies group filter. Unknown flags are dropped; bad numbers become undefined.
 */
export function parseQueryFilters(sp: URLSearchParams): QueryFilters {
  const str = (v: string | null) => {
    const s = (v ?? '').trim();
    return s || undefined;
  };
  const num = (v: string | null) => {
    const s = (v ?? '').trim();
    if (!s) return undefined;
    const n = Number(s);
    return Number.isFinite(n) ? n : undefined;
  };
  const flags = (sp.get('flags') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is QueryFlag => (QUERY_FLAG_KEYS as readonly string[]).includes(s));
  return {
    entity: sp.get('entity') === 'contacts' ? 'contacts' : 'companies',
    q: str(sp.get('q')),
    lxdFrom: str(sp.get('lxdFrom')),
    lxdTo: str(sp.get('lxdTo')),
    sfMin: num(sp.get('sfMin')),
    sfMax: num(sp.get('sfMax')),
    city: str(sp.get('city')),
    state: str(sp.get('state')),
    address: str(sp.get('address')),
    flags: flags.length ? flags : undefined,
    group: str(sp.get('group')),
  };
}

export interface FilterChip {
  key: string; // which filter this chip clears
  label: string;
}

/** The applied filters as removable chips — the single source of truth for "what's applied". */
export function filtersToChips(f: QueryFilters): FilterChip[] {
  const chips: FilterChip[] = [];
  if (f.q?.trim()) chips.push({ key: 'q', label: `“${f.q.trim()}”` });
  if (f.flags?.length) {
    const labels = f.flags.map((k) => QUERY_FLAGS.find((x) => x.key === k)?.label ?? k);
    chips.push({ key: 'flags', label: labels.join('/') });
  }
  if (f.lxdFrom || f.lxdTo) {
    const fmt = (iso?: string) => formatLeaseExpiry(iso);
    const label = f.lxdFrom && f.lxdTo ? `LXD ${fmt(f.lxdFrom)}–${fmt(f.lxdTo)}` : f.lxdTo ? `LXD ≤ ${fmt(f.lxdTo)}` : `LXD ≥ ${fmt(f.lxdFrom)}`;
    chips.push({ key: 'lease', label });
  }
  if (f.sfMin != null || f.sfMax != null) {
    const n = (x: number) => x.toLocaleString('en-US');
    const label =
      f.sfMin != null && f.sfMax != null ? `SF ${n(f.sfMin)}–${n(f.sfMax)}` : f.sfMax != null ? `SF ≤ ${n(f.sfMax)}` : `SF ≥ ${n(f.sfMin as number)}`;
    chips.push({ key: 'sf', label });
  }
  if (f.city?.trim()) chips.push({ key: 'city', label: f.city.trim() });
  if (f.state?.trim()) chips.push({ key: 'state', label: f.state.trim() });
  if (f.address?.trim()) chips.push({ key: 'address', label: `addr: ${f.address.trim()}` });
  if (f.group?.trim()) chips.push({ key: 'group', label: f.group.trim() });
  return chips;
}

/** Remove the filter(s) a chip represents, returning a new filters object (entity preserved). */
export function clearChip(f: QueryFilters, key: string): QueryFilters {
  const n: QueryFilters = { ...f };
  switch (key) {
    case 'q': delete n.q; break;
    case 'flags': delete n.flags; break;
    case 'lease': delete n.lxdFrom; delete n.lxdTo; break;
    case 'sf': delete n.sfMin; delete n.sfMax; break;
    case 'city': delete n.city; break;
    case 'state': delete n.state; break;
    case 'address': delete n.address; break;
    case 'group': delete n.group; break;
  }
  return n;
}
