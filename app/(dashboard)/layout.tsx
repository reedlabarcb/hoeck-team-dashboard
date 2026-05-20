/**
 * Dashboard route group layout — sidebar + header + content area.
 * Auth is enforced by middleware.ts at the edge; this layout assumes a session exists.
 */

import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/Sidebar';
import { Header } from '@/components/Header';
import { DashboardClientShell } from './_shell';
import { getSession } from '@/lib/auth/session';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session.user) {
    // Middleware should have caught this, but belt-and-suspenders.
    redirect('/login');
  }

  return (
    <DashboardClientShell>
      <div className="flex min-h-screen w-full bg-gray-50">
        <Sidebar />
        <div className="flex flex-1 flex-col">
          <Header userName={session.user.name} userEmail={session.user.email} />
          <main className="flex-1 overflow-auto">{children}</main>
        </div>
      </div>
    </DashboardClientShell>
  );
}
