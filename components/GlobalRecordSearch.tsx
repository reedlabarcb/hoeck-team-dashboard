'use client';

/**
 * <GlobalRecordSearch> — the Header's app-wide record lookup (P3.13 Step 5). Reuses the
 * battle-tested <RealNexEntitySearch> (type="both", debounced, keyboard-navigable), but instead
 * of filtering a list it NAVIGATES to the picked record's detail page: contact → /contacts/[key],
 * company → /companies/[key]. "Look up any record from anywhere → land on it."
 *
 * onSelect hands back the exact resolved entity (key untouched), so the URL key is the same
 * RealNex object key the detail page reads by — no drift.
 */

import { useRouter } from 'next/navigation';
import { RealNexEntitySearch } from './RealNexEntitySearch';
import { detailPath } from '@/lib/realnex/format';

export function GlobalRecordSearch({ className }: { className?: string }) {
  const router = useRouter();
  return (
    <RealNexEntitySearch
      type="both"
      placeholder="Jump to a contact or company…"
      onSelect={(entity) => router.push(detailPath(entity))}
      className={className}
    />
  );
}
