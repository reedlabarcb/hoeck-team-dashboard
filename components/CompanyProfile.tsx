/**
 * <CompanyProfile> — the mirror-sourced profile card for /companies/[key] (P3.13). Presentational
 * (no hooks / no fetch) so it's server-rendered by the detail page AND unit-testable. Linked
 * contacts + the live notes feed render separately in the page.
 */
import type { CompanyDetail } from '@/lib/realnex/queries';
import { formatSqFt, formatLeaseExpiry, formatAddress, normalizeWebsiteUrl } from '@/lib/realnex/format';

const DASH = <span className="text-gray-400">—</span>;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-gray-900">{children}</dd>
    </div>
  );
}

export function CompanyProfile({ company }: { company: CompanyDetail }) {
  const flags = (
    [
      ['Tenant', company.tenant],
      ['Prospect', company.prospect],
      ['Investor', company.investor],
      ['Agent', company.agent],
      ['Vendor', company.vendor],
      ['Personal', company.personal],
    ] as const
  )
    .filter(([, v]) => v)
    .map(([l]) => l);
  const website = normalizeWebsiteUrl(company.website);
  const address = formatAddress(company.address);
  const groups = Array.isArray(company.objectGroups)
    ? (company.objectGroups as Array<Record<string, unknown>>).map((g) => (typeof g?.Name === 'string' ? g.Name : null)).filter(Boolean)
    : [];

  return (
    <div>
      <h1 className={`text-2xl font-semibold ${company.name ? 'text-gray-900' : 'italic text-gray-400'}`}>
        {company.name || '(unnamed)'}
      </h1>
      {flags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {flags.map((f) => (
            <span key={f} className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-900">
              {f}
            </span>
          ))}
        </div>
      )}

      <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
        <Field label="Phone">{company.phone || DASH}</Field>
        <Field label="Email">
          {company.email ? (
            <a href={`mailto:${company.email}`} className="text-blue-700 hover:underline">{company.email}</a>
          ) : (
            DASH
          )}
        </Field>
        <Field label="Website">
          {website ? (
            <a href={website} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline">
              {company.website}
            </a>
          ) : (
            DASH
          )}
        </Field>
        <Field label="Lease expiration">{formatLeaseExpiry(company.leaseExpiry)}</Field>
        <Field label="Square footage">{formatSqFt(company.sqFt)}</Field>
        <Field label="Address">{address || DASH}</Field>
        <Field label="Groups">{groups.length ? groups.join(', ') : DASH}</Field>
      </dl>
    </div>
  );
}
