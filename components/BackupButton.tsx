'use client';

/**
 * Header button: "Download Backup".
 * Calls /api/export/all and triggers browser download of the ZIP.
 *
 * Phase 1 is the ONLY safety net before Phase 2 wires the weekly pg_dump → Box cron.
 * If you click this and get a 503, escalate immediately — that means the export endpoint
 * crashed and you currently have NO data-loss recourse on Railway Hobby tier.
 */

import { useState } from 'react';

export function BackupButton() {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setDownloading(true);
    setError(null);
    try {
      const res = await fetch('/api/export/all', { cache: 'no-store' });
      if (!res.ok) {
        setError(`Backup failed: HTTP ${res.status}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Prefer server-provided filename.
      const cd = res.headers.get('content-disposition') ?? '';
      const m = cd.match(/filename="([^"]+)"/);
      a.download = m ? m[1] : `hoeck-dashboard-backup-${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backup failed');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex flex-col items-end">
      <button
        type="button"
        onClick={onClick}
        disabled={downloading}
        className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        title="Download a ZIP of all dashboard-native state"
      >
        {downloading ? 'Preparing…' : 'Download Backup'}
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
