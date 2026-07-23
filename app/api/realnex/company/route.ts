/**
 * POST /api/realnex/company — CREATE a new company in RealNex (P3.7). Auth-gated.
 *
 * Chain: auth-gate → HTTP-shape validate → RealNex create (via the safe wrapper) → optimistic
 * mirror-upsert → activity_feed log → respond. The RealNex create is IRREVERSIBLE and NON-IDEMPOTENT,
 * so it runs FIRST and AT MOST ONCE; local writes (mirror, audit) are best-effort AFTER it — a local
 * failure surfaces a warning and lets the next sync heal, but never reports the create as failed and
 * never triggers a retry (a retry would duplicate the CRM record).
 *
 * Responses: 200 { key, warnings } | 400 invalid_input | 401 | 4xx passthrough / 502 realnex_write_failed
 * | 503 realnex_not_configured.  DORMANT until the Add-Company form (P3.7 UI) calls it.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { isRealnexCreateEnabled } from '@/lib/flags';
import { createCompany } from '@/lib/external/realnex/safe';
import { validateCreateCompanyInput } from '@/lib/realnex/create-input';
import { upsertCreatedCompany } from '@/lib/realnex/create-mirror';
import { mapCreateError } from '@/lib/realnex/create-error';
import { logActivity } from '@/lib/activity';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  // Feature-dark: with the flag off there is NO reachable write path — 404 BEFORE auth/validation
  // (a direct authenticated POST is rejected too).
  if (!isRealnexCreateEnabled()) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const session = await getSession();
  if (!session.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const v = validateCreateCompanyInput(body);
  if (!v.ok) {
    return NextResponse.json({ error: 'invalid_input', field: v.field, message: v.error }, { status: 400 });
  }

  const actor = session.user.id;
  const warnings: string[] = [];

  // 1) RealNex create FIRST — irreversible, non-idempotent, AT MOST ONCE. On failure: return, no DB, no retry.
  let key: string;
  try {
    const created = await createCompany(v.value);
    key = created.key;
    warnings.push(...created.warnings);
  } catch (err) {
    return mapCreateError(err);
  }

  // 2) Local writes BEST-EFFORT. A DB failure here must NOT report the create as failed nor invite a
  //    retry — surface a warning; the next RealNex→local sync reconciles the mirror.
  try {
    await upsertCreatedCompany(key, v.value, actor);
  } catch (e) {
    console.error('[create/company] created in RealNex but mirror-upsert failed:', e);
    warnings.push('Created in RealNex, but the local copy could not be saved — it will appear after the next sync.');
  }
  await logActivity({
    actorUserId: actor,
    action: 'company.create',
    entityType: 'realnex_company',
    entityId: key,
    payload: { organization: v.value.organization, source: 'Dashboard', warnings },
    status: warnings.length ? 'warn' : 'ok',
  }).catch((e) => console.error('[create/company] audit write failed:', e));

  return NextResponse.json({ key, warnings }, { status: 200 });
}
