/**
 * <CompanyRow> — one row of the /companies list. Extracted so the name→detail link is testable.
 * The NAME links to the company's detail page (/companies/[key]).
 */
import Link from 'next/link';
import { formatSqFt, formatLeaseExpiry, formatAddress, normalizeWebsiteUrl } from '@/lib/realnex/format';

export interface CompanyRowData {
  key: string;
  name: string | null;
  city: string | null;
  state: string | null;
  address: Record<string, unknown> | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  leaseExpiry: string | null;
  sqFt: number | null;
  tenant: boolean | null;
  prospect: boolean | null;
}

export function CompanyRow({ company: c }: { company: CompanyRowData }) {
  // Full street address (same helper + formatting as the detail page's CompanyProfile). Degrades
  // gracefully: partial address shows what it has; no address → "—" (formatAddress returns "").
  const location = formatAddress(c.address);
  const website = normalizeWebsiteUrl(c.website);
  return (
    <tr className="hover:bg-gray-50">
      <td className="px-3 py-2">
        <Link
          href={`/companies/${encodeURIComponent(c.key)}`}
          className={c.name ? 'font-medium text-blue-700 hover:underline' : 'italic text-gray-400 hover:underline'}
        >
          {c.name || '(unnamed)'}
        </Link>
        {c.tenant && (
          <span className="ml-2 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-900">Tenant</span>
        )}
        {c.prospect && (
          <span className="ml-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-900">Prospect</span>
        )}
      </td>
      <td className="px-3 py-2 text-gray-600">
        {/* Full address can be long — cap the width and wrap cleanly so it doesn't blow out the table. */}
        <div className="max-w-xs break-words">{location || '—'}</div>
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-gray-600">{formatSqFt(c.sqFt)}</td>
      <td className="px-3 py-2 tabular-nums text-gray-600">{formatLeaseExpiry(c.leaseExpiry)}</td>
      <td className="px-3 py-2 text-gray-600">{c.phone}</td>
      <td className="px-3 py-2 text-gray-600">
        {c.email ? <a href={`mailto:${c.email}`} className="text-blue-700 hover:underline">{c.email}</a> : null}
      </td>
      <td className="px-3 py-2 text-right">
        {website ? (
          <a href={website} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-700 hover:underline">site ↗</a>
        ) : null}
      </td>
    </tr>
  );
}
