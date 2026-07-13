/**
 * POST /api/realnex/activity — log a History note onto an EXISTING RealNex company/contact
 * (P3.6 note-logging Step 2). The Log Note UI (Step 3) calls this.
 *
 * This is the ONE write path to RealNex, and it's an ADD-ONLY child-History append via the safe
 * wrapper's appendActivity (POST /Crm/object/{key}/history) — it never edits/deletes/moves the
 * parent. Every attempt (success AND failure) is recorded in the dashboard's own activity_feed via
 * logActivity, so "did my note land?" is always answerable from our logs.
 *
 * Body: { objectKey, objectType: 'contact'|'company', eventTypeKey, subject?, notes }.
 * eventTypeKey must be one of the 6 note-logging types (validated); subject auto-derives if empty.
 *
 * Auth-required. Responses: 200 {ok} | 400 invalid_input | 401 | 502 realnex_write_failed
 * | 503 realnex_not_configured | 500 append_failed.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { appendActivity } from '@/lib/external/realnex/safe';
import { RealNexApiError, RealNexNotConfiguredError } from '@/lib/external/realnex/client';
import { logActivity } from '@/lib/activity';
import { validateActivityInput } from '@/lib/realnex/activity-input';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const v = validateActivityInput(body);
  if (!v.ok) {
    return NextResponse.json({ error: 'invalid_input', field: v.field, message: v.error }, { status: 400 });
  }
  const { objectKey, objectType, eventTypeKey, subject, notes } = v.value;
  const auditBase = {
    actorUserId: session.user.id,
    action: 'realnex.activity.append',
    entityType: `realnex_${objectType}` as const,
    entityId: objectKey,
  };

  try {
    await appendActivity(objectKey, { eventTypeKey, subject, notes });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    // Audit the FAILED attempt so the trail captures attempts, not just successes.
    await logActivity({
      ...auditBase,
      payload: { eventTypeKey, subject, notesLength: notes.length, source: 'Dashboard', error: message.slice(0, 500) },
      status: 'error',
    }).catch((e) => console.error('[activity] failed to audit a failed append:', e));

    if (err instanceof RealNexNotConfiguredError) {
      return NextResponse.json({ error: 'realnex_not_configured', message }, { status: 503 });
    }
    if (err instanceof RealNexApiError) {
      return NextResponse.json({ error: 'realnex_write_failed', status: err.status, message }, { status: 502 });
    }
    return NextResponse.json({ error: 'append_failed', message }, { status: 500 });
  }

  // Write succeeded — audit best-effort (a logging blip must NOT report a landed note as failed).
  await logActivity({
    ...auditBase,
    payload: { eventTypeKey, subject, notesLength: notes.length, source: 'Dashboard' },
    status: 'ok',
  }).catch((e) => console.error('[activity] append succeeded but audit write failed:', e));

  return NextResponse.json({ ok: true });
}
