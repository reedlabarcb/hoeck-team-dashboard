/**
 * <LinkedContacts> — the contacts linked to a company (via the mirror's materialized company_key),
 * each linking to its own /contacts/[key] detail page. Presentational + unit-testable.
 */
import Link from 'next/link';
import { contactDisplayName } from '@/lib/realnex/format';

export interface LinkedContactItem {
  key: string;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  email: string | null;
}

export function LinkedContacts({ contacts }: { contacts: LinkedContactItem[] }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
        Contacts ({contacts.length})
      </h2>
      {contacts.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">No linked contacts.</p>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white">
          {contacts.map((c) => (
            <li key={c.key} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0">
                <Link href={`/contacts/${encodeURIComponent(c.key)}`} className="font-medium text-blue-700 hover:underline">
                  {contactDisplayName(c)}
                </Link>
                {c.title && <span className="ml-2 text-xs text-gray-500">{c.title}</span>}
              </span>
              {c.email && (
                <a href={`mailto:${c.email}`} className="shrink-0 text-xs text-blue-700 hover:underline">{c.email}</a>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
