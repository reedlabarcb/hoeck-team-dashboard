/**
 * POST /api/realnex/contact — CREATE a new contact in RealNex (P3.8). Auth-gated.
 *
 * Same chain + partial-failure discipline as the company route: RealNex create FIRST (irreversible,
 * non-idempotent, at most once) → optimistic mirror-upsert (best-effort; sets company_key from what we
 * sent) → activity_feed log → respond. A local-write failure surfaces a warning, never a retry.
 *
 * Responses: 200 { key, warnings } | 400 invalid_input | 401 | 4xx passthrough / 502 realnex_write_failed
 * | 503 realnex_not_configured.  DORMANT until the Add-Contact form (P3.8 UI) calls it.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { isRealnexCreateEnabled } from '@/lib/flags';
import { createContact } from '@/lib/external/realnex/safe';
import { validateCreateContactInput } from '@/lib/realnex/create-input';
import { upsertCreatedContact } from '@/lib/realnex/create-mirror';
import { mapCreateError } from '@/lib/realnex/create-error';
import { logActivity } from '@/lib/activity';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  // Feature-dark: with the flag off there is NO reachable write path — 404 BEFORE auth/validation.
  if (!isRealnexCreateEnabled()) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const session = await getSession();
  if (!session.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const v = validateCreateContactInput(body);
  if (!v.ok) {
    return NextResponse.json({ error: 'invalid_input', field: v.field, message: v.error }, { status: 400 });
  }

  const actor = session.user.id;
  const warnings: string[] = [];
  const displayName = v.value.fullName?.trim() || [v.value.firstName?.trim(), v.value.lastName?.trim()].filter(Boolean).join(' ');

  // 1) RealNex create FIRST — irreversible, non-idempotent, AT MOST ONCE.
  let key: string;
  try {
    const created = await createContact(v.value);
    key = created.key;
    warnings.push(...created.warnings);
  } catch (err) {
    return mapCreateError(err);
  }

  // 2) Local writes BEST-EFFORT (never fail the request nor invite a retry).
  try {
    await upsertCreatedContact(key, v.value, actor);
  } catch (e) {
    console.error('[create/contact] created in RealNex but mirror-upsert failed:', e);
    warnings.push('Created in RealNex, but the local copy could not be saved — it will appear after the next sync.');
  }
  await logActivity({
    actorUserId: actor,
    action: 'contact.create',
    entityType: 'realnex_contact',
    entityId: key,
    payload: { name: displayName, companyKey: v.value.companyKey ?? null, source: 'Dashboard', warnings },
    status: warnings.length ? 'warn' : 'ok',
  }).catch((e) => console.error('[create/contact] audit write failed:', e));

  return NextResponse.json({ key, warnings }, { status: 200 });
}
