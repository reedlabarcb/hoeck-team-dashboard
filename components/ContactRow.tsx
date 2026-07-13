/**
 * <ContactRow> — one row of the /contacts list. Extracted from the list page so the name→detail
 * link is unit-testable. The NAME links to the contact's detail page (/contacts/[key]); the
 * COMPANY cell links to the company's detail page (/companies/[companyKey]) when the contact is
 * linked to a mirrored company. A denormalized company name with no key (unlinked) renders as
 * plain text, never a broken link.
 */
import Link from 'next/link';
import { contactDisplayName, formatSqFt, formatLeaseExpiry } from '@/lib/realnex/format';

export interface ContactRowData {
  key: string;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  email: string | null;
  work: string | null;
  mobile: string | null;
  companyKey: string | null;
  companyName: string | null;
  leaseExpiry: string | null;
  sqFt: number | null;
  tenant: boolean | null;
  prospect: boolean | null;
}

export function ContactRow({ contact: c }: { contact: ContactRowData }) {
  return (
    <tr className="hover:bg-gray-50">
      <td className="px-3 py-2">
        <Link href={`/contacts/${encodeURIComponent(c.key)}`} className="font-medium text-blue-700 hover:underline">
          {contactDisplayName(c)}
        </Link>
        {c.tenant && (
          <span className="ml-2 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-900">Tenant</span>
        )}
        {c.prospect && (
          <span className="ml-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-900">Prospect</span>
        )}
      </td>
      <td className="px-3 py-2 text-gray-600">{c.title}</td>
      <td className="px-3 py-2">
        {c.companyKey ? (
          <Link href={`/companies/${encodeURIComponent(c.companyKey)}`} className="text-blue-700 hover:underline">
            {c.companyName || '(unnamed company)'}
          </Link>
        ) : c.companyName ? (
          <span className="text-gray-600">{c.companyName}</span>
        ) : (
          <span className="italic text-gray-400">(no company)</span>
        )}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-gray-600">{formatSqFt(c.sqFt)}</td>
      <td className="px-3 py-2 tabular-nums text-gray-600">{formatLeaseExpiry(c.leaseExpiry)}</td>
      <td className="px-3 py-2 text-gray-600">
        {c.email ? <a href={`mailto:${c.email}`} className="text-blue-700 hover:underline">{c.email}</a> : null}
      </td>
      <td className="px-3 py-2 text-gray-600">{c.work || c.mobile}</td>
    </tr>
  );
}
