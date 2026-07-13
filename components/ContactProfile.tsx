/**
 * <ContactProfile> — the mirror-sourced profile card for /contacts/[key] (P3.13). Presentational
 * (no hooks, no data fetching) so it's server-rendered by the detail page AND unit-testable in
 * isolation. Notes are NOT here — the live <RecordHistory> panel renders below it.
 */
import Link from 'next/link';
import type { ContactDetail } from '@/lib/realnex/queries';
import { contactDisplayName, formatSqFt, formatLeaseExpiry, formatAddress } from '@/lib/realnex/format';

const DASH = <span className="text-gray-400">—</span>;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-gray-900">{children}</dd>
    </div>
  );
}

export function ContactProfile({ contact }: { contact: ContactDetail }) {
  const name = contactDisplayName(contact);
  const flags = (
    [
      ['Tenant', contact.tenant],
      ['Prospect', contact.prospect],
      ['Investor', contact.investor],
      ['Agent', contact.agent],
      ['Vendor', contact.vendor],
      ['Personal', contact.personal],
    ] as const
  )
    .filter(([, v]) => v)
    .map(([l]) => l);
  const address = formatAddress(contact.address);
  const groups = Array.isArray(contact.objectGroups)
    ? (contact.objectGroups as Array<Record<string, unknown>>).map((g) => (typeof g?.Name === 'string' ? g.Name : null)).filter(Boolean)
    : [];

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900">{name}</h1>
      {contact.title && <p className="mt-0.5 text-sm text-gray-600">{contact.title}</p>}
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
        <Field label="Company">
          {contact.companyKey && contact.companyName ? (
            <Link href={`/companies/${encodeURIComponent(contact.companyKey)}`} className="text-blue-700 hover:underline">
              {contact.companyName}
            </Link>
          ) : (
            DASH
          )}
        </Field>
        <Field label="Email">
          {contact.email ? (
            <a href={`mailto:${contact.email}`} className="text-blue-700 hover:underline">{contact.email}</a>
          ) : (
            DASH
          )}
        </Field>
        <Field label="Work phone">{contact.work || DASH}</Field>
        <Field label="Mobile">{contact.mobile || DASH}</Field>
        <Field label="Lease expiration">{formatLeaseExpiry(contact.leaseExpiry)}</Field>
        <Field label="Square footage">{formatSqFt(contact.sqFt)}</Field>
        <Field label="Address">{address || DASH}</Field>
        <Field label="Groups">{groups.length ? groups.join(', ') : DASH}</Field>
      </dl>
    </div>
  );
}
