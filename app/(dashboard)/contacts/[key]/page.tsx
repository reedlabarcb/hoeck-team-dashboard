/**
 * /contacts/[key] — contact detail (P3.13). Server component: reads the mirror (getContactByKey)
 * and renders the profile instantly; the live notes feed (<RecordHistory>) loads separately, so a
 * slow/erroring RealNex never blocks the profile. Read-only.
 */
import Link from 'next/link';
import { getContactByKey } from '@/lib/realnex/queries';
import { contactDisplayName } from '@/lib/realnex/format';
import { ContactProfile } from '@/components/ContactProfile';
import { RecordHistory } from '@/components/RecordHistory';

export const dynamic = 'force-dynamic';

export default async function ContactDetailPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const contact = await getContactByKey(key);

  if (!contact) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <Link href="/contacts" className="text-xs text-blue-700 hover:underline">← Contacts</Link>
        <div className="mt-4 rounded-lg border border-gray-200 bg-white p-6">
          <p className="text-sm font-medium text-gray-900">Contact not found</p>
          <p className="mt-1 text-sm text-gray-600">
            No contact matches this link. It may have been removed, or the mirror hasn&apos;t synced it yet.
          </p>
        </div>
      </div>
    );
  }

  const name = contactDisplayName(contact);
  const qp = new URLSearchParams({ type: 'contact', key: contact.key, name });
  if (contact.companyName) qp.set('company', contact.companyName);
  const logNoteHref = `/activities?${qp.toString()}`;

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <Link href="/contacts" className="text-xs text-blue-700 hover:underline">← Contacts</Link>
        <Link
          href={logNoteHref}
          className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700"
        >
          Log Note
        </Link>
      </div>

      <ContactProfile contact={contact} />

      <div className="mt-8">
        <RecordHistory objectKey={contact.key} logNoteHref={logNoteHref} />
      </div>
    </div>
  );
}
