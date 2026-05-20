/**
 * GET /api/export/all
 *
 * Streams a ZIP of all dashboard-native state. Phase 1 ships:
 *   - metadata.json
 *   - activity_feed.json  (full history)
 *
 * Phase 2+ adds: companies_mirror, contacts_mirror, activities_mirror,
 *                box_folder_index, notes, tags.
 *
 * Why this exists: lessons-learned manual-export safety net.
 *   - inbound-tracker users wanted a snapshot they controlled.
 *   - Railway Hobby tier has NO Postgres backups → this is our ONLY safety net until
 *     Phase 2 wires the weekly `pg_dump` → Box cron.
 */

import { NextResponse } from 'next/server';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';

// archiver is published as CommonJS (`export =`); load via createRequire so Turbopack
// doesn't trip over the missing default export.
const archiver = createRequire(import.meta.url)('archiver') as typeof import('archiver');
import { db } from '@/lib/db';
import { activityFeed } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

const APP_VERSION = '0.1.0';
const SCHEMA_VERSION = 1;

export async function GET() {
  const archive = archiver('zip', { zlib: { level: 9 } });
  const chunks: Buffer[] = [];
  archive.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<void>((resolve, reject) => {
    archive.on('end', () => resolve());
    archive.on('error', (err) => reject(err));
  });

  // metadata.json
  const exportedAt = new Date().toISOString();
  archive.append(
    JSON.stringify(
      {
        exported_at: exportedAt,
        app_version: APP_VERSION,
        schema_version: SCHEMA_VERSION,
        contents: ['metadata.json', 'activity_feed.json'],
        not_yet_implemented: [
          'companies_mirror.xlsx (Phase 3)',
          'contacts_mirror.xlsx (Phase 3)',
          'activities_mirror.xlsx (Phase 3)',
          'box_folder_index.xlsx (Phase 2)',
          'notes.json (Phase 7)',
          'tags.json (Phase 7)',
        ],
      },
      null,
      2,
    ),
    { name: 'metadata.json' },
  );

  // activity_feed.json — full history (Phase 1 backup is small enough to be one file)
  const feed = await db.select().from(activityFeed);
  archive.append(JSON.stringify(feed, null, 2), { name: 'activity_feed.json' });

  await archive.finalize();
  await done;

  const buf = Buffer.concat(chunks);
  // Build a filename like hoeck-dashboard-backup-2026-05-19_143208.zip
  const stamp = exportedAt.replace(/[:T-]/g, '').replace(/\..*Z$/, '');
  const filename = `hoeck-dashboard-backup-${stamp.slice(0, 8)}_${stamp.slice(8, 14)}.zip`;

  return new NextResponse(Readable.toWeb(Readable.from(buf)) as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buf.length),
    },
  });
}
