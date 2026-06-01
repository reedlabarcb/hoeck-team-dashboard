'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { label: 'Home', href: '/' },
  { label: 'Companies', href: '/companies', soon: true },
  { label: 'Contacts', href: '/contacts', soon: true },
  { label: 'Activities', href: '/activities', soon: true },
  { label: 'Files', href: '/files' },
  { label: 'Master Excel', href: '/master-excel' },
  { label: 'Activity Feed', href: '/activity-feed', soon: true },
  { label: 'System Status', href: '/health' },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-gray-200 bg-white">
      <div className="px-4 py-5">
        <div className="text-sm font-semibold text-gray-900">Hoeck Team</div>
        <div className="text-xs text-gray-500">Tenant Rep Dashboard</div>
      </div>
      <nav className="flex-1 px-2">
        <ul className="space-y-0.5">
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`flex items-center justify-between rounded px-3 py-2 text-sm ${
                    active
                      ? 'bg-gray-900 text-white'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <span>{item.label}</span>
                  {item.soon && (
                    <span className="rounded bg-gray-100 px-1 text-[10px] font-medium uppercase tracking-wide text-gray-500">
                      soon
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="border-t border-gray-200 px-4 py-3 text-xs text-gray-400">
        Phase 1 · foundation
      </div>
    </aside>
  );
}
