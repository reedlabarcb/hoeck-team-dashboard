/**
 * /companies/[key] — company detail (P3.13). Server component: reads the mirror (getCompanyByKey +
 * the company's linked contacts) and renders instantly; the live <RecordHistory> loads separately.
 * Read-only.
 */
import Link from 'next/link';
import { getCompanyByKey, searchContacts } from '@/lib/realnex/queries';
import { CompanyProfile } from '@/components/CompanyProfile';
import { LinkedContacts } from '@/components/LinkedContacts';
import { RecordHistory } from '@/components/RecordHistory';

export const dynamic = 'force-dynamic';

export default async function CompanyDetailPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const company = await getCompanyByKey(key);

  if (!company) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <Link href="/companies" className="text-xs text-blue-700 hover:underline">← Companies</Link>
        <div className="mt-4 rounded-lg border border-gray-200 bg-white p-6">
          <p className="text-sm font-medium text-gray-900">Company not found</p>
          <p className="mt-1 text-sm text-gray-600">
            No company matches this link. It may have been removed, or the mirror hasn&apos;t synced it yet.
          </p>
        </div>
      </div>
    );
  }

  const { contacts } = await searchContacts({ companyKey: key, limit: 100 });
  const qp = new URLSearchParams({ type: 'company', key: company.key, name: company.name ?? '(unnamed company)' });
  const logNoteHref = `/activities?${qp.toString()}`;

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <Link href="/companies" className="text-xs text-blue-700 hover:underline">← Companies</Link>
        <Link
          href={logNoteHref}
          className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700"
        >
          Log Note
        </Link>
      </div>

      <CompanyProfile company={company} />

      <div className="mt-8">
        <LinkedContacts contacts={contacts} />
      </div>

      <div className="mt-8">
        <RecordHistory objectKey={company.key} logNoteHref={logNoteHref} />
      </div>
    </div>
  );
}
