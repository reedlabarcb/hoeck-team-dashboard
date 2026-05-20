'use client';

import { BackupButton } from './BackupButton';

interface Props {
  userName?: string;
  userEmail?: string;
}

export function Header({ userName, userEmail }: Props) {
  async function onLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.assign('/login');
  }

  return (
    <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
      <div className="text-sm text-gray-500">{/* breadcrumb area — wired per page later */}</div>
      <div className="flex items-center gap-4">
        <BackupButton />
        <div className="flex flex-col text-right">
          <span className="text-sm font-medium text-gray-900">{userName ?? 'Signed in'}</span>
          <span className="text-xs text-gray-500">{userEmail}</span>
        </div>
        <button
          type="button"
          onClick={onLogout}
          className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
        >
          Log out
        </button>
      </div>
    </header>
  );
}
